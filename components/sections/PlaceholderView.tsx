import { type ElementType } from "react";

interface PlaceholderViewProps {
  icon: ElementType;
  title: string;
  description?: string;
}

export function PlaceholderView({ icon: Icon, title, description }: PlaceholderViewProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-white">
      <div className="text-center space-y-3">
        <div className="h-16 w-16 rounded-2xl bg-[var(--purple-light)] flex items-center justify-center mx-auto">
          <Icon className="h-8 w-8 text-[var(--purple-fg)]" />
        </div>
        <div className="text-sm font-semibold text-[var(--foreground)]">{title}</div>
        {description && (
          <div className="text-xs text-[var(--muted-fg)] max-w-xs">{description}</div>
        )}
        <div className="text-[10px] text-[var(--muted-fg)] bg-[var(--muted)] px-3 py-1 rounded-full inline-block">
          Coming soon
        </div>
      </div>
    </div>
  );
}
