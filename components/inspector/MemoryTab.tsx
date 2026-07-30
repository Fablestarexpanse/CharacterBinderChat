"use client";

import { useFableStore } from "@/lib/store";
import { Pin, Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { FactsView }         from "./memory/FactsView";
import { RelationshipsView } from "./memory/RelationshipsView";
import { EntitiesView }      from "./memory/EntitiesView";

type KGTab = "facts" | "relationships" | "entities";

const KG_TABS: { id: KGTab; label: string }[] = [
  { id: "facts",         label: "Facts" },
  { id: "relationships", label: "Relationships" },
  { id: "entities",      label: "Entities" },
];

interface PinnedMemory {
  id:      string;
  content: string;
  type:    string;
}

export function MemoryTab() {
  const { activeChatId, chats, characters, extractionVersion, isExtracting, memories, lastExtractionError } =
    useFableStore();

  const chat      = chats.find((c) => c.id === activeChatId);
  const character = characters.find((c) => c.id === chat?.characterId);

  const [kgTab, setKgTab] = useState<KGTab>("facts");

  const pinned: PinnedMemory[] = memories
    .filter((m) => m.chatId === activeChatId && m.pinned)
    .map((m) => ({ id: m.id, content: m.content, type: m.type }));

  if (!character) {
    return (
      <div className="p-4 text-center text-sm text-[var(--muted-fg)]">
        No character assigned to this chat.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">

      {/* Pinned memories (legacy / manual) */}
      {pinned.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Pin className="h-3 w-3 text-[var(--muted-fg)]" />
            <span className="text-[10px] font-semibold text-[var(--muted-fg)] uppercase tracking-wider">
              Pinned
            </span>
          </div>
          <div className="space-y-2">
            {pinned.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--purple-light)] p-2.5"
              >
                <p className="text-[11px] text-[var(--foreground)] leading-relaxed">{m.content}</p>
                <div className="mt-1.5">
                  <Badge variant="purple">{m.type}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge graph section */}
      <div>
        {/* Section header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Brain className="h-3 w-3 text-[var(--muted-fg)]" />
            <span className="text-[10px] font-semibold text-[var(--muted-fg)] uppercase tracking-wider">
              Knowledge Graph
            </span>
            {isExtracting && (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--purple)] animate-pulse" />
            )}
          </div>
        </div>

        {/* Last extraction failure — otherwise a broken pipeline is invisible */}
        {lastExtractionError && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] text-red-600">
            Last memory update failed — {lastExtractionError}
          </div>
        )}

        {/* Segmented control */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden mb-3 bg-[var(--muted)]">
          {KG_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setKgTab(tab.id)}
              className={`flex-1 py-1 text-[10px] font-medium transition-colors ${
                kgTab === tab.id
                  ? "bg-white text-[var(--purple-fg)] shadow-sm"
                  : "text-[var(--muted-fg)] hover:text-[var(--foreground)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sub-views — all scoped to this chat's memory */}
        {kgTab === "facts" && chat && (
          <FactsView
            chatId={chat.id}
            characterId={character.id}
            extractionVersion={extractionVersion}
            isExtracting={isExtracting}
          />
        )}
        {kgTab === "relationships" && chat && (
          <RelationshipsView
            chatId={chat.id}
            characterId={character.id}
            extractionVersion={extractionVersion}
          />
        )}
        {kgTab === "entities" && chat && (
          <EntitiesView
            chatId={chat.id}
            extractionVersion={extractionVersion}
          />
        )}
      </div>

      {/* Summary shortcut */}
      <div>
        <div className="text-[10px] font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
          Summary
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
          <p className="text-[11px] text-[var(--muted-fg)] italic">
            Switch to the Summary tab for a full character overview.
          </p>
          <Button
            variant="subtle"
            size="sm"
            className="mt-2 w-full text-xs"
            onClick={() => useFableStore.getState().setInspectorTab("summary")}
          >
            Open Summary
          </Button>
        </div>
      </div>
    </div>
  );
}
