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

  // 把 Error / PostgrestError / 普通 object 都壓成有意義的訊息
  let message = "Unknown error";
  let details: unknown = undefined;
  if (err instanceof Error) {
    message = err.message;
  } else if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) {
      message = o.message;
      if (typeof o.details === "string" && o.details) {
        details = o.details;
      } else if (o.hint) {
        details = o.hint;
      }
      if (typeof o.code === "string" && o.code) {
        message = `[${o.code}] ${message}`;
      }
    } else {
      try { message = JSON.stringify(err); } catch { /* noop */ }
    }
  } else if (typeof err === "string") {
    message = err;
  }

  return fail("INTERNAL_ERROR", message, 500, details);
}
