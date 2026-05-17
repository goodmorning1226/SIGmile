import { NextResponse } from "next/server";
import { ApiAuthError } from "@/lib/auth/server-auth";

export interface DriverSuccess<T> { success: true;  data: T; }
export interface DriverFailure    { success: false; error: string; }

export function success<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<DriverSuccess<T>>({ success: true, data }, init);
}

export function failure(error: string, status = 400) {
  return NextResponse.json<DriverFailure>({ success: false, error }, { status });
}

export function handleDriverError(err: unknown) {
  if (err instanceof ApiAuthError) {
    return failure(err.message, err.code === "UNAUTHENTICATED" ? 401 : 403);
  }
  if (err instanceof Error && err.message === "NOT_FOUND") {
    return failure("找不到資料或沒有權限", 404);
  }
  console.error("[driver-api] unhandled", err);
  return failure(err instanceof Error ? err.message : "Internal error", 500);
}
