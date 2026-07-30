"use client";

import { useFableStore, type InspectorTab } from "@/lib/store";
import { CharacterTab } from "./CharacterTab";
import { MemoryTab } from "./MemoryTab";
import { GraphTab } from "./GraphTab";
import { SummaryTab } from "./SummaryTab";
import { LoreTab } from "./LoreTab";
import { ImageStudioTab } from "./ImageStudioTab";
import { CoreMemoryTab } from "./CoreMemoryTab";
import { cn } from "@/lib/utils";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "character",    label: "Character" },
  { id: "core-memory",  label: "Core Mem" },
  { id: "memory",       label: "Memory" },
  { id: "graph",        label: "Web" },
  { id: "summary",      label: "Summary" },
  { id: "lore",         label: "Lore" },
  { id: "image-studio", label: "Image Studio" },
];

export function InspectorPanel() {
  const { inspectorTab, setInspectorTab, inspectorOpen } = useFableStore();

  if (!inspectorOpen) return null;

  return (
    <aside className="flex flex-col h-full w-[280px] flex-shrink-0 border-l border-[var(--border)] bg-[var(--sidebar-bg)]">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--border)] bg-white px-2 pt-2 gap-0.5 flex-shrink-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setInspectorTab(tab.id)}
            className={cn(
              "px-2.5 py-1.5 text-xs rounded-t-lg transition-colors cursor-pointer whitespace-nowrap",
              inspectorTab === tab.id
                ? "bg-[var(--purple-light)] text-[var(--purple-fg)] font-semibold"
                : "text-[var(--muted-fg)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — the graph manages its own height, others scroll */}
      <div className={cn("flex-1", inspectorTab === "graph" ? "min-h-0" : "overflow-y-auto")}>
        {inspectorTab === "character"    && <CharacterTab />}
        {inspectorTab === "core-memory"  && <CoreMemoryTab />}
        {inspectorTab === "memory"       && <MemoryTab />}
        {inspectorTab === "graph"        && <GraphTab />}
        {inspectorTab === "summary"      && <SummaryTab />}
        {inspectorTab === "lore"         && <LoreTab />}
        {inspectorTab === "image-studio" && <ImageStudioTab />}
      </div>
    </aside>
  );
}
