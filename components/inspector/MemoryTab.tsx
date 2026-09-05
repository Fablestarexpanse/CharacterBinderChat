"use client";

import { useFableStore } from "@/lib/store";
import { useInspectedCharacter } from "@/lib/hooks/useInspectedCharacter";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { FactsView }         from "./memory/FactsView";
import { RelationshipsView } from "./memory/RelationshipsView";
import { EntitiesView }      from "./memory/EntitiesView";
import { saveBlob } from "@/lib/utils";

type KGTab = "facts" | "relationships" | "entities";

const KG_TABS: { id: KGTab; label: string }[] = [
  { id: "relationships", label: "Relationships" },
  { id: "facts",         label: "Facts" },
  { id: "entities",      label: "Entities" },
];

export function MemoryTab() {
  const { extractionVersion, isExtracting, lastExtractionError } = useFableStore();
  const { chat, character } = useInspectedCharacter();

  const [kgTab, setKgTab] = useState<KGTab>("relationships");

  if (!character) {
    return (
      <div className="p-4 text-center text-sm text-[var(--muted-fg)]">
        No character assigned to this chat.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">

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

      {/* Export the whole graph for this chat */}
      {chat && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => {
            fetch(`/api/drawer/entities?chat=${encodeURIComponent(chat.id)}`)
              .then((r) => r.json())
              .then((d) => saveBlob(
                new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
                "fablestore-export.json"
              ))
              .catch(console.error);
          }}
        >
          Export Graph JSON
        </Button>
      )}
    </div>
  );
}
