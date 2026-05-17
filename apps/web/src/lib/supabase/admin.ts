import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client：**繞過 RLS**。
 * 只在系統級操作使用（例如 cron job、後台批次處理、跨 user 修補資料）。
 * 一般 manager API 請使用 `createSupabaseServerClient()` 以保留 RLS 防線。
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
