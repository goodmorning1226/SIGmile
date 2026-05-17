import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiAuthError } from "@/lib/auth/server-auth";

export interface BearerAuthContext {
  userId: string;
  role: "manager" | "driver";
  fullName: string;
  email: string | null;
  /**
   * 已綁定使用者 JWT 的 Supabase client。
   * 用它查 / 寫資料時 RLS 會以 auth.uid() 為基準，driver 自動只能改自己的資料。
   */
  supabase: SupabaseClient;
  /** dev fallback 為 true，正式登入為 false。日誌與 metric 可分開計算。 */
  isDevFallback?: boolean;
}

function readBearerToken(request: Request): string | null {
  const h =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * 用 user 的 access_token 建一個帶 Authorization header 的 Supabase client。
 * postgrest 看到該 header 就會以該使用者身份套用 RLS。
 */
export function createSupabaseFromBearer(jwt: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } }
    }
  );
}

export async function getBearerAuthContext(
  request: Request
): Promise<BearerAuthContext | null> {
  const token = readBearerToken(request);
  if (!token) return null;

  const supabase = createSupabaseFromBearer(token);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) return null;

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", userData.user.id)
    .single();
  if (pErr || !profile) return null;

  return {
    userId: userData.user.id,
    role: profile.role as "manager" | "driver",
    fullName: profile.full_name as string,
    email: userData.user.email ?? null,
    supabase
  };
}

/**
 * Dev fallback：當以下條件**全部**成立時，回傳一個指定 driver 的 context，
 * 不需要前端送 Bearer。**僅限本機開發 / demo 使用**。
 *   - NODE_ENV !== 'production'
 *   - ALLOW_DEV_DRIVER === 'true'
 *   - DEV_DRIVER_EMAIL 對應的 auth.users 與 profile 存在
 *
 * 內部用 service_role client 模擬該使用者，**RLS 失效**（service_role 預設繞過 RLS）。
 * 因此一定要嚴格限定觸發條件。
 */
async function tryDevDriverFallback(): Promise<BearerAuthContext | null> {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.ALLOW_DEV_DRIVER !== "true") return null;

  const email = process.env.DEV_DRIVER_EMAIL;
  if (!email) return null;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // 用 admin API 找 user
  const { data: users, error: lErr } = await admin.auth.admin.listUsers();
  if (lErr) return null;
  const user = users?.users.find((u) => u.email === email);
  if (!user) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  if ((profile as any).role !== "driver") return null;

  // ⚠️ 用 service_role 當 supabase client，RLS 不會以 auth.uid() 過濾。
  //   demo 場景可接受；正式環境絕對不要走這條。
  console.warn(
    `[bearer-auth] DEV FALLBACK ACTIVATED for ${email} — RLS bypassed. ` +
      `Do NOT set ALLOW_DEV_DRIVER=true in production.`
  );

  return {
    userId: user.id,
    role: "driver",
    fullName: (profile as any).full_name as string,
    email: user.email ?? null,
    supabase: admin,
    isDevFallback: true
  };
}

export async function requireDriver(request: Request): Promise<BearerAuthContext> {
  const ctx = await getBearerAuthContext(request);
  if (ctx) {
    if (ctx.role !== "driver") {
      throw new ApiAuthError("FORBIDDEN", "需要 driver 角色");
    }
    return ctx;
  }

  // 沒有 token 或 token 無效時，試 dev fallback
  const devCtx = await tryDevDriverFallback();
  if (devCtx) return devCtx;

  throw new ApiAuthError("UNAUTHENTICATED", "需要登入");
}
