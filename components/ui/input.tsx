import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm placeholder:text-[var(--muted-fg)] focus:outline-none focus:border-[var(--purple)] focus:ring-2 focus:ring-[var(--purple-light)] transition-colors disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
