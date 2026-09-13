"use client";

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { useInspectedCharacter } from "@/lib/hooks/useInspectedCharacter";
import { MemoryGraph } from "@/components/inspector/graph/MemoryGraph";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Maximize2, Network } from "lucide-react";

export function GraphTab() {
  const { extractionVersion } = useFableStore();
  const { chat, character } = useInspectedCharacter();
  const [expanded, setExpanded] = useState(false);

  if (!chat) {
    return (
      <div className="p-4 text-center text-sm text-[var(--muted-fg)]">
        No chat selected.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Network className="h-3 w-3 text-[var(--muted-fg)]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)]">
            Story Web
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Expand to full screen"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <MemoryGraph
          chatId={chat.id}
          characterId={character?.id}
          extractionVersion={extractionVersion}
        />
      </div>

      <div className="border-t border-[var(--border)] px-3 py-1.5">
        <p className="text-[9px] leading-snug text-[var(--muted-fg)]">
          Drag nodes · scroll to zoom · click to focus a node&apos;s web
        </p>
      </div>

      {/* Full-screen view */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          aria-describedby={undefined}
          className="h-[92vh] max-h-[92vh] w-[94vw] max-w-[94vw]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3">
            <Network className="h-4 w-4 text-[var(--purple-fg)]" />
            <DialogTitle>
              Story web — {chat.name}
            </DialogTitle>
          </div>
          <div className="min-h-0 flex-1">
            {expanded && (
              <MemoryGraph
                chatId={chat.id}
                characterId={character?.id}
                extractionVersion={extractionVersion}
                full
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
