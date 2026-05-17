import { redirect } from "next/navigation";

export default function Root() {
  // 由 middleware 處理是否登入；登入後一律進 dashboard
  redirect("/dashboard");
}
