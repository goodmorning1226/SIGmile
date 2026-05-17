import * as React from "react";
import { cn } from "@/lib/utils/cn";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[120px] w-full rounded-md border border-slate-300 bg-white px-3 py-2",
        "font-mono text-xs leading-relaxed",
        "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
