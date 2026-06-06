import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm placeholder:text-[var(--muted-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--purple)] focus:border-transparent disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
