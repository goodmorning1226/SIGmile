import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "success";
export type ButtonSize    = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:   "bg-brand-600 hover:bg-brand-700 text-white shadow-soft",
  secondary: "bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-200",
  ghost:     "hover:bg-slate-100 text-slate-700",
  outline:   "border border-slate-300 bg-white hover:bg-slate-50 text-slate-800",
  danger:    "bg-red-600 hover:bg-red-700 text-white shadow-soft",
  success:   "bg-accent-600 hover:bg-accent-700 text-white shadow-soft"
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md font-medium",
          "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          VARIANT[variant], SIZE[size], className
        )}
        {...props}
      >
        {loading && <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
