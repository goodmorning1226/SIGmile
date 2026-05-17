import { NextResponse } from "next/server";
import { ApiAuthError } from "@/lib/auth/server-auth";

export interface ApiOk<T> { ok: true; data: T; }
export interface ApiErr     { ok: false; error: { code: string; message: string; details?: unknown }; }
export type ApiResult<T>    = ApiOk<T> | ApiErr;

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, init);
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json<ApiErr>(
    { ok: false, error: { code, message, details } },
    { status }
  );
}

/** 統一的錯誤包裝：把 auth error 轉 401/403，其餘轉 500。 */
export function handleApiError(err: unknown) {
  if (err instanceof ApiAuthError) {
    return fail(err.code, err.message, err.code === "UNAUTHENTICATED" ? 401 : 403);
  }
  console.error("[api] unhandled error", err);
  const message = err instanceof Error ? err.message : "Unknown error";
  return fail("INTERNAL_ERROR", message, 500);
}
