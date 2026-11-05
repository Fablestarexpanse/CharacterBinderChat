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
import { X, User, Brain, Database, BookOpen, Network, Image as ImageIcon, type LucideIcon } from "lucide-react";

// Every tab visible at once: a 3×2 grid instead of a strip that scrolled
// sideways, which hid Memory, Lore, Web and Image Studio behind a scrollbar
// most people never noticed.
const TABS: { id: InspectorTab; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "character",    label: "Character",   icon: User,      hint: "Who they are, how they feel about you" },
  { id: "core-memory",  label: "Core Mem",    icon: Brain,     hint: "Mood, relationship, thoughts and summary: always in the prompt" },
  { id: "memory",       label: "Memory",      icon: Database,  hint: "Facts (pin, lock, edit, history), relationships and entities" },
  { id: "lore",         label: "Lore",        icon: BookOpen,  hint: "Lorebooks active in this chat" },
  { id: "graph",        label: "Web",         icon: Network,   hint: "The story as a mind map" },
  { id: "image-studio", label: "Images",      icon: ImageIcon, hint: "Generate an image of this scene" },
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
      <div role="tablist" aria-label="Inspector sections" className="grid grid-cols-3 gap-1 border-b border-[var(--border)] bg-[var(--card)] p-2 flex-shrink-0">
        {TABS.map(({ id, label, icon: Icon, hint }) => (
          <button
            key={id}
            role="tab"
            aria-selected={inspectorTab === id}
            title={hint}
            onClick={() => setInspectorTab(id)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-1.5 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap",
              inspectorTab === id
                ? "bg-[var(--purple-light)] text-[var(--purple-fg)] font-semibold"
                : "text-[var(--muted-fg)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]"
            )}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0" />
            {label}
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
