"use client";

import { useFableStore, type InspectorTab } from "@/lib/store";
import { useInspectedCharacter } from "@/lib/hooks/useInspectedCharacter";
import { CharacterTab } from "./CharacterTab";
import { MemoryTab } from "./MemoryTab";
import { GraphTab } from "./GraphTab";
import { LoreTab } from "./LoreTab";
import { ImageStudioTab } from "@/components/image/ImageStudioTab";
import { CoreMemoryTab } from "./CoreMemoryTab";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/lib/store/ui";
import { useNarrow } from "@/lib/hooks/useNarrow";
import { X } from "lucide-react";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "character",    label: "Character" },
  { id: "core-memory",  label: "Core Mem" },
  { id: "memory",       label: "Memory" },
  { id: "lore",         label: "Lore" },
  { id: "graph",        label: "Web" },
  { id: "image-studio", label: "Image Studio" },
];

export function InspectorPanel() {
  const { characters } = useFableStore();
  const { inspectorTab, setInspectorTab, inspectorOpen, setInspectorMemberId, inspectorSheetOpen, setInspectorSheetOpen } = useUiStore();
  const { chat, character, isGroup } = useInspectedCharacter();
  // On a phone the panel is a sheet over the chat, opened from the header
  const narrow = useNarrow();

  if (narrow ? !inspectorSheetOpen : !inspectorOpen) return null;

  const panel = (
    <aside
      aria-label="Inspector"
      className={narrow
        ? "fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col rounded-t-2xl border-t border-[var(--border)] bg-[var(--sidebar-bg)] shadow-2xl"
        : "flex flex-col h-full w-[280px] flex-shrink-0 border-l border-[var(--border)] bg-[var(--sidebar-bg)]"}
    >
      {narrow && (
        <div className="flex items-center justify-between px-3 pt-2 flex-shrink-0">
          <span className="text-xs font-semibold text-[var(--foreground)]">Inspector</span>
          <button onClick={() => setInspectorSheetOpen(false)} aria-label="Close inspector" className="rounded-lg p-1.5 cursor-pointer text-[var(--muted-fg)] hover:bg-[var(--muted)]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {/* Group chats: whose memory is the panel showing? */}
      {isGroup && chat && (
        <div className="flex items-center gap-1.5 px-2 pt-2 flex-shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)]">
            Viewing
          </span>
          {(chat.memberIds ?? []).map((id) => {
            const m = characters.find((c) => c.id === id);
            if (!m) return null;
            const active = character?.id === id;
            return (
              <button
                key={id}
                onClick={() => setInspectorMemberId(id)}
                title={`Inspect ${m.name}'s memory`}
                className={`rounded-full px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                  active
                    ? "bg-[var(--purple)] text-white"
                    : "bg-[var(--muted)] text-[var(--muted-fg)] hover:text-[var(--foreground)]"
                }`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-[var(--border)] bg-[var(--card)] px-2 pt-2 gap-0.5 flex-shrink-0 overflow-x-auto">
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
        {inspectorTab === "lore"         && <LoreTab />}
        {inspectorTab === "image-studio" && <ImageStudioTab />}
      </div>
    </aside>
  );

  if (!narrow) return panel;
  return (
    <>
      <button aria-label="Close inspector" onClick={() => setInspectorSheetOpen(false)} className="fixed inset-0 z-40 bg-black/40 cursor-default" />
      {panel}
    </>
  );
}
