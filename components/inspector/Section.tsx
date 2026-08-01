"use client";

// Collapsible inspector section — shared by the Character and Core Memory
// tabs so long-form content can fold away instead of flooding the panel.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white hover:bg-[var(--muted)] transition-colors cursor-pointer"
      >
        <span className="text-[11px] font-semibold text-[var(--foreground)]">{title}</span>
        {open
          ? <ChevronUp className="h-3 w-3 text-[var(--muted-fg)]" />
          : <ChevronDown className="h-3 w-3 text-[var(--muted-fg)]" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-1.5 bg-white">{children}</div>}
    </div>
  );
}
