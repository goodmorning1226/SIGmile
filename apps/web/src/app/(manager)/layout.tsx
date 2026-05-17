import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/server-auth";
import { Sidebar } from "@/components/layout/Sidebar";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "manager") {
    redirect("/login?error=not-manager");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar userName={ctx.fullName} />
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-[1400px] px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
