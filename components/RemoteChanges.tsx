"use client";

import { Bot, TriangleAlert, Undo2, X } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { sendJson } from "@/lib/api/client";
import { useState } from "react";

// Announces changes made outside this tab — an agent editing a character, another
// device — with an Undo wherever the change can be reversed. Undo is a server
// write like any other: the tab sees the result on its next poll, so nothing here
// edits the local store directly.

export function RemoteChanges() {
  const notices = useUiStore((s) => s.remoteNotices);
  const dismiss = useUiStore((s) => s.dismissRemoteNotice);
  const [undoError, setUndoError] = useState<string | null>(null);

  if (notices.length === 0 && !undoError) return null;

  const undo = async (key: number, historyId: number) => {
    setUndoError(null);
    try {
      await sendJson("POST", "/api/cards/undo", { historyId });
      dismiss(key);
    } catch (e) {
      setUndoError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {notices.map((n) => (
        <div
          key={n.key}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-md ${
            n.kind === "lost"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
          }`}
        >
          {n.kind === "lost"
            ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            : <Bot className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--purple-fg)]" />}
          <span className="flex-1 leading-snug">{n.text}</span>
          {n.historyId !== null && (
            <button
              onClick={() => undo(n.key, n.historyId!)}
              className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[var(--purple-fg)] hover:bg-[var(--purple-light)] cursor-pointer"
            >
              <Undo2 className="h-3 w-3" />Undo
            </button>
          )}
          <button onClick={() => dismiss(n.key)} aria-label="Dismiss" className="flex-shrink-0 cursor-pointer text-[var(--muted-fg)] hover:text-[var(--foreground)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {undoError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">Undo failed — {undoError}</div>
      )}
    </div>
  );
}
