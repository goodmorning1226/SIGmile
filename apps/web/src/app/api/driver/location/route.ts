import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, failure, handleDriverError } from "@/lib/api/driver-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/driver/location
 * body: { lat, lng, accuracy_meters?, delivery_task_id? }
 * 寫入 driver_locations，source 一律 'app'。
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireDriver(request);

    const body = (await request.json().catch(() => ({}))) as {
      lat?: number;
      lng?: number;
      accuracy_meters?: number;
      delivery_task_id?: string;
    };
    if (
      typeof body.lat !== "number" ||
      typeof body.lng !== "number" ||
      Number.isNaN(body.lat) ||
      Number.isNaN(body.lng)
    ) {
      return failure("lat / lng 為必填 number", 400);
    }

    const { data, error } = await ctx.supabase
      .from("driver_locations")
      .insert({
        driver_id: ctx.userId,
        lat: body.lat,
        lng: body.lng,
        accuracy_meters: body.accuracy_meters ?? null,
        delivery_task_id: body.delivery_task_id ?? null,
        source: "app"
      })
      .select("id, recorded_at")
      .single();
    if (error || !data) throw error ?? new Error("INSERT_FAILED");

    return success({ location: data });
  } catch (e) {
    return handleDriverError(e);
  }
}
