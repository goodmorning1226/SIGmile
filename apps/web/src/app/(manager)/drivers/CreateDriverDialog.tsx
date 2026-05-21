"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup } from "@/components/form/Field";
import { NumberInput } from "@/components/form/NumberInput";
import { SelectInput } from "@/components/form/SelectInput";

interface CreatedResult {
  driver_id: string;
  email: string;
  password: string;
  reused_existing: boolean;
}

interface FormState {
  email: string;
  full_name: string;
  phone: string;
  employee_code: string;
  shift: "" | "day" | "night";
  max_work_minutes: number;
  vehicle_id: string;
  vehicle_type: string;
  vehicle_capacity: number;
  temperature_capability: "" | "frozen" | "chilled" | "mixed" | "ambient";
}

const EMPTY: FormState = {
  email: "",
  full_name: "",
  phone: "",
  employee_code: "",
  shift: "day",
  max_work_minutes: 480,
  vehicle_id: "",
  vehicle_type: "3.5T 冷藏車",
  vehicle_capacity: 40,
  temperature_capability: "chilled"
};

export function CreateDriverDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<CreatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    setError(null);
    if (!form.email.trim() || !form.full_name.trim()) {
      setError("Email 與 姓名 為必填");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/manager/drivers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: form.email.trim(),
            full_name: form.full_name.trim(),
            phone: form.phone.trim() || null,
            employee_code: form.employee_code.trim() || null,
            shift: form.shift || null,
            max_work_minutes: form.max_work_minutes || null,
            vehicle_id: form.vehicle_id.trim() || null,
            vehicle_type: form.vehicle_type.trim() || null,
            vehicle_capacity: form.vehicle_capacity || null,
            temperature_capability: form.temperature_capability || null
          })
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error?.message ?? "建立失敗");
        setCreated(j.data as CreatedResult);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知錯誤");
      }
    });
  };

  const close = () => {
    setOpen(false);
    setForm(EMPTY);
    setCreated(null);
    setError(null);
    setCopied(false);
  };

  const copyPassword = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        新增物流士
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
          <Card className="mx-auto mt-12 w-full max-w-2xl">
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle>
                  {created ? "建立完成 🎉" : "新增物流士"}
                </CardTitle>
                <button onClick={close} className="text-slate-400 hover:text-slate-700">
                  <X className="size-5" />
                </button>
              </div>
            </CardHeader>

            {created ? (
              <CardContent className="space-y-4">
                <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
                  <div className="text-sm font-semibold text-amber-900">
                    {created.reused_existing
                      ? "此 email 已是 auth 用戶，已更新 profile（密碼未變）"
                      : "首次登入用以下帳號／密碼。離開此視窗後就看不到密碼了，請立刻記下或傳給司機。"}
                  </div>
                  <div className="mt-3 grid grid-cols-[80px_1fr] gap-2 text-sm">
                    <div className="font-medium text-slate-600">Email</div>
                    <div className="font-mono text-slate-900">{created.email}</div>
                    {!created.reused_existing && (
                      <>
                        <div className="font-medium text-slate-600">密碼</div>
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-white px-2 py-1 font-mono text-slate-900">
                            {created.password}
                          </code>
                          <button
                            onClick={copyPassword}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                            {copied ? "已複製" : "複製"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <Button variant="outline" onClick={() => { setCreated(null); setForm(EMPTY); }}>
                    再新增一位
                  </Button>
                  <Button onClick={close}>完成</Button>
                </div>
              </CardContent>
            ) : (
              <CardContent className="space-y-4">
                <FieldGroup title="基本資料">
                  <Field label="Email" required>
                    <TextInput
                      type="email"
                      value={form.email}
                      onChange={(v) => set("email", v)}
                      placeholder="driver7@example.com"
                    />
                  </Field>
                  <Field label="姓名" required>
                    <TextInput
                      value={form.full_name}
                      onChange={(v) => set("full_name", v)}
                      placeholder="陳大明"
                    />
                  </Field>
                  <Field label="員編">
                    <TextInput
                      value={form.employee_code}
                      onChange={(v) => set("employee_code", v)}
                      placeholder="D-0007"
                    />
                  </Field>
                  <Field label="電話">
                    <TextInput
                      value={form.phone}
                      onChange={(v) => set("phone", v)}
                      placeholder="0912-345-678"
                    />
                  </Field>
                </FieldGroup>

                <FieldGroup title="班別與工時">
                  <Field label="班別">
                    <SelectInput
                      value={form.shift}
                      onChange={(v) => set("shift", v as FormState["shift"])}
                      options={[
                        { value: "day",   label: "日班" },
                        { value: "night", label: "夜班" }
                      ]}
                    />
                  </Field>
                  <Field label="工時上限" suffix="分鐘">
                    <NumberInput
                      value={form.max_work_minutes}
                      onChange={(n) => set("max_work_minutes", n)}
                      min={60} step={30}
                    />
                  </Field>
                </FieldGroup>

                <FieldGroup title="車輛">
                  <Field label="車輛代號">
                    <TextInput
                      value={form.vehicle_id}
                      onChange={(v) => set("vehicle_id", v)}
                      placeholder="TPE-007"
                    />
                  </Field>
                  <Field label="車輛類型">
                    <TextInput
                      value={form.vehicle_type}
                      onChange={(v) => set("vehicle_type", v)}
                      placeholder="3.5T 冷藏車"
                    />
                  </Field>
                  <Field label="容量" suffix="箱">
                    <NumberInput
                      value={form.vehicle_capacity}
                      onChange={(n) => set("vehicle_capacity", n)}
                      min={1}
                    />
                  </Field>
                  <Field label="溫層能力">
                    <SelectInput
                      value={form.temperature_capability}
                      onChange={(v) => set("temperature_capability", v as FormState["temperature_capability"])}
                      options={[
                        { value: "frozen",  label: "冷凍" },
                        { value: "chilled", label: "冷藏" },
                        { value: "mixed",   label: "多溫層" },
                        { value: "ambient", label: "常溫" }
                      ]}
                    />
                  </Field>
                </FieldGroup>

                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <Button variant="outline" onClick={close}>取消</Button>
                  <Button onClick={submit} loading={pending}>建立</Button>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

// 簡單 TextInput（form/ 下沒有現成的）
function TextInput({
  type = "text", value, onChange, placeholder
}: {
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
    />
  );
}
