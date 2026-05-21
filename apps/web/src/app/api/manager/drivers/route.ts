import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createDriver, type CreateDriverInput } from "@/lib/services/driver-admin-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/drivers
 *   建立單一物流士（auth user + profile）。回傳生成密碼（input 沒給時）。
 *   主管要記下密碼或請司機自行重設。
 */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = (await request.json().catch(() => null)) as Partial<CreateDriverInput> | null;
    if (!body || !body.email || !body.full_name) {
      return fail("BAD_REQUEST", "email 與 full_name 為必填", 400);
    }
    const result = await createDriver(body as CreateDriverInput);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
