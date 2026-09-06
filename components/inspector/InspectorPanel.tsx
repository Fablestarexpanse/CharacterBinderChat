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
  const { inspectorTab, setInspectorTab, inspectorOpen, setInspectorMemberId } = useUiStore();
  const { chat, character, isGroup } = useInspectedCharacter();

  if (!inspectorOpen) return null;

  // Persisted selections may reference removed tabs
  const activeTab = inspectorTab;

  return (
    <aside className="flex flex-col h-full w-[280px] flex-shrink-0 border-l border-[var(--border)] bg-[var(--sidebar-bg)]">
      {/* Group chats: whose memory is the panel showing? */}
      {isGroup && chat && (
        <div className="flex items-center gap-1.5 px-2 pt-2 flex-shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)]">
            Viewing
          </span>
          {chat.memberIds!.map((id) => {
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
      <div className="flex border-b border-[var(--border)] bg-white px-2 pt-2 gap-0.5 flex-shrink-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setInspectorTab(tab.id)}
            className={cn(
              "px-2.5 py-1.5 text-xs rounded-t-lg transition-colors cursor-pointer whitespace-nowrap",
              activeTab === tab.id
                ? "bg-[var(--purple-light)] text-[var(--purple-fg)] font-semibold"
                : "text-[var(--muted-fg)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — the graph manages its own height, others scroll */}
      <div className={cn("flex-1", activeTab === "graph" ? "min-h-0" : "overflow-y-auto")}>
        {activeTab === "character"    && <CharacterTab />}
        {activeTab === "core-memory"  && <CoreMemoryTab />}
        {activeTab === "memory"       && <MemoryTab />}
        {activeTab === "graph"        && <GraphTab />}
        {activeTab === "lore"         && <LoreTab />}
        {activeTab === "image-studio" && <ImageStudioTab />}
      </div>
    </aside>
  );
}
