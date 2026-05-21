import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export interface AuthContext {
  userId: string;
  role: UserRole;
  fullName: string;
  email: string | null;
}

/**
 * 從 cookie session 取得登入者 + profile 的 role / full_name。
 *
 * ★ 用 React.cache 包：同一個 server render 內多次呼叫只打 1 次 Supabase。
 *   過去 layout + 個別 service 各自 await，造成同一 render 內 2-3 次 auth round-trip。
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
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
});

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
