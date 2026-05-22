import { redirect } from "next/navigation";

/**
 * 季度分析已整合進 /dashboard，舊網址直接導向。
 * 保留 query string（q=YYYYQ\d）。
 */
interface PageProps {
  searchParams: Promise<{ q?: string }>;
}
export default async function QuarterlyPageRedirect({ searchParams }: PageProps) {
  const sp = await searchParams;
  const qs = sp.q ? `?q=${encodeURIComponent(sp.q)}` : "";
  redirect(`/dashboard${qs}`);
}
