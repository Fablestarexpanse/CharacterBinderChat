import { type ElementType } from "react";
import { cn } from "@/lib/utils";

interface NavItemProps {
  icon: ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}

export function NavItem({ icon: Icon, label, active, onClick, badge }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left text-[13px] font-medium transition-colors cursor-pointer",
        active
          ? "bg-[var(--purple-light)] text-[var(--purple-fg)] font-semibold"
          : "text-[var(--nav-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      )}
    >
      <Icon className={cn("h-4 w-4 flex-shrink-0", active ? "text-[var(--purple)]" : "text-[var(--icon-fg)]")} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="text-[10px] bg-[var(--purple)] text-white rounded-full px-1.5 py-0.5 leading-none">
          {badge}
        </span>
      )}
    </button>
  );
}
