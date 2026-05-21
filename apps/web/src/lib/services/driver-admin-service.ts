import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ShiftType, TemperatureType } from "@/types/domain";

/**
 * 主管端「物流士管理」服務：建立 auth user + profile + 工程屬性（容量/溫層/班別）。
 *
 * 為什麼用 admin（service_role）：
 *   `supabase.auth.admin.createUser` 只能 service_role 呼叫。
 *   建完 auth user 後 trigger 通常不會自動建 profile（看 schema 設計），這裡顯式 upsert。
 */

export interface CreateDriverInput {
  email: string;
  password?: string;        // 沒給就自動生
  full_name: string;
  phone?: string | null;
  employee_code?: string | null;
  shift?: ShiftType | null;
  max_work_minutes?: number | null;
  vehicle_id?: string | null;
  vehicle_type?: string | null;
  vehicle_capacity?: number | null;
  temperature_capability?: TemperatureType | null;
  distribution_center_id?: string | null;
  service_area_id?: string | null;
}

export interface CreateDriverResult {
  driver_id: string;
  email: string;
  /** 自動生成的密碼，主管要記下來給司機。input 有給 password 就回它。 */
  password: string;
  /** true = auth user 本來就存在，這次只 upsert 了 profile */
  reused_existing: boolean;
}

function randomPassword(len = 10): string {
  // 不含易混淆字（0/O、1/l/I）
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * 建立單一物流士：
 *   1. auth.admin.createUser（auto-confirm email）
 *   2. profile upsert（FK to auth.users.id）
 *
 * idempotent：如果 email 已存在的話，沿用既有 auth user 並只 upsert profile。
 */
export async function createDriver(input: CreateDriverInput): Promise<CreateDriverResult> {
  const admin = createSupabaseAdminClient();
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`不合法的 email: "${email}"`);
  }
  const password = input.password?.trim() || randomPassword();
  const fullName = input.full_name.trim();
  if (!fullName) throw new Error("full_name 不能空白");

  // ---- 1. 找或建 auth user ----
  let userId: string | null = null;
  let reusedExisting = false;

  // Supabase 沒有「getUserByEmail」直接 API；用 listUsers 找
  // 注意 listUsers 預設 page=1,perPage=50；如果你的 user 量大改用 filter
  const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({
    page: 1, perPage: 200
  });
  if (listErr) throw new Error(`listUsers 失敗：${listErr.message}`);
  const found = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (found) {
    userId = found.id;
    reusedExisting = true;
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,                 // 跳過 magic-link 確認
      user_metadata: { full_name: fullName }
    });
    if (createErr || !created.user) {
      throw new Error(`createUser 失敗：${createErr?.message ?? "未知錯誤"}`);
    }
    userId = created.user.id;
  }

  // ---- 2. upsert profile ----
  const profile: Record<string, unknown> = {
    id: userId,
    role: "driver",
    full_name: fullName,
    phone: input.phone ?? null,
    employee_code: input.employee_code ?? null,
    shift: input.shift ?? null,
    max_work_minutes: input.max_work_minutes ?? null,
    vehicle_id: input.vehicle_id ?? null,
    vehicle_type: input.vehicle_type ?? null,
    vehicle_capacity: input.vehicle_capacity ?? null,
    temperature_capability: input.temperature_capability ?? null,
    distribution_center_id: input.distribution_center_id ?? null,
    service_area_id: input.service_area_id ?? null
  };
  const { error: upErr } = await admin
    .from("profiles")
    .upsert(profile, { onConflict: "id" });
  if (upErr) {
    throw new Error(`profile upsert 失敗：${upErr.message}`);
  }

  return {
    driver_id: userId!,
    email,
    password,
    reused_existing: reusedExisting
  };
}
