import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { executeAction } from "@/lib/services/ai-assistant-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/ai-assistant/execute  body: { action_type, payload? } */
export async function POST(request: Request) {
  try {
    const ctx = await requireManager();
    const body = await request.json().catch(() => ({}));
    const action_type = body?.action_type as string | undefined;
    if (!action_type) return fail("BAD_REQUEST", "action_type 必填", 400);
    const result = await executeAction(
      { action_type: action_type as any, payload: body?.payload ?? {} },
      { user_id: ctx.userId }
    );
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
