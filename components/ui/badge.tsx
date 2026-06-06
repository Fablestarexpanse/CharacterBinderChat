import { cn } from "@/lib/utils";
import { type HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "purple" | "green" | "red" | "yellow";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        {
          "bg-[var(--muted)] text-[var(--muted-fg)]": variant === "default",
          "bg-[var(--muted)] text-[var(--foreground)]": variant === "secondary",
          "bg-[var(--purple-light)] text-[var(--purple-fg)]": variant === "purple",
          "bg-green-50 text-green-700": variant === "green",
          "bg-red-50 text-red-600": variant === "red",
          "bg-yellow-50 text-yellow-700": variant === "yellow",
        },
        className
      )}
      {...props}
    />
  );
}
