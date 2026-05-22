import { redirect } from "next/navigation";

/** AI 深度分析已整合進 /dashboard，舊網址直接導向。 */
export default function InsightsPageRedirect() {
  redirect("/dashboard");
}
