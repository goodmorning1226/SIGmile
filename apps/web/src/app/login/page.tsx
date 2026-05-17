import { LoginForm } from "./LoginForm";

export const metadata = { title: "登入 · SIGmile" };

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-br from-brand-50 via-white to-accent-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="SIGmile"
            className="size-16 object-contain drop-shadow-sm"
          />
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">SIGmile</h1>
          <p className="mt-1 text-sm text-slate-500">物流配送管理 · Manager Console</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
