import { Construction } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export interface ComingSoonProps {
  title: string;
  description?: string;
  phase: string;
  features: string[];
}

export function ComingSoon({ title, description, phase, features }: ComingSoonProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <Construction className="h-10 w-10 text-amber-500" />
          <div>
            <div className="text-base font-semibold text-slate-800">即將完成</div>
            <div className="mt-1 text-sm text-slate-500">{phase}</div>
          </div>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-slate-300" />
                {f}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
