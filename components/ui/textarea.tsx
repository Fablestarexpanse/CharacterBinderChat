import { cn } from "@/lib/utils";
import { type TextareaHTMLAttributes, forwardRef } from "react";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm placeholder:text-[var(--muted-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--purple)] focus:border-transparent resize-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
