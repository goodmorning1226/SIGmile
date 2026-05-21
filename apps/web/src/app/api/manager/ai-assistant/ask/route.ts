import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { askAssistant } from "@/lib/services/ai-assistant-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/ai-assistant/ask  body: { message } */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    const message = String(body?.message ?? "").trim();
    if (!message) return fail("BAD_REQUEST", "message 必填", 400);
    if (message.length > 1000) return fail("BAD_REQUEST", "message 過長（> 1000 字元）", 400);
    const reply = await askAssistant(message);
    return ok({ reply });
  } catch (e) {
    return handleApiError(e);
  }
}
