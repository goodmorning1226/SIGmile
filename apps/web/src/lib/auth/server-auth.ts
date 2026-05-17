import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export interface AuthContext {
  userId: string;
  role: UserRole;
  fullName: string;
  email: string | null;
}

/**
 * 從 cookie session 取得登入者，並一併讀出 profiles.role。
 * 找不到時回傳 null（路由端應自行回 401）。
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    userId: user.id,
    role: profile.role as UserRole,
    fullName: profile.full_name,
    email: user.email ?? null
  };
}

export async function requireManager(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new ApiAuthError("UNAUTHENTICATED", "需要登入");
  if (ctx.role !== "manager") throw new ApiAuthError("FORBIDDEN", "需要 manager 角色");
  return ctx;
}

export class ApiAuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN", message: string) {
    super(message);
  }
}
