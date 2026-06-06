import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "purple" | "subtle";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
          {
            "bg-[var(--foreground)] text-white hover:bg-[#2a2a3e]": variant === "default",
            "hover:bg-[var(--muted)] text-[var(--foreground)]": variant === "ghost",
            "border border-[var(--border)] hover:bg-[var(--muted)] text-[var(--foreground)]": variant === "outline",
            "bg-[var(--purple)] text-white hover:bg-[var(--purple-fg)]": variant === "purple",
            "bg-[var(--purple-light)] text-[var(--purple-fg)] hover:bg-purple-100": variant === "subtle",
          },
          {
            "h-7 px-2.5 text-xs gap-1": size === "sm",
            "h-9 px-4 text-sm gap-1.5": size === "md",
            "h-10 px-5 text-sm gap-2": size === "lg",
            "h-8 w-8 p-0": size === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
