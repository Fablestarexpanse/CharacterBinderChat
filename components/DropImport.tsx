"use client";

// ─── Drag-and-drop card import ────────────────────────────────────────────────
// Drop a CharacterBinder PNG (or a bare JSON card) anywhere in the app and it
// lands in the right section by embedded type: characters open the editor for
// review, lorebooks/personas/scenarios import directly. One overlay for the
// whole window — the payload's type decides the destination, not the drop
// position, since the data is self-describing.

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { importCardFiles, type ImportResult } from "@/lib/import/applyCards";
import { FileDown, Check, AlertTriangle } from "lucide-react";

export function DropImport() {
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  // dragenter/dragleave fire for every child element crossed — count the depth
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // required, or the browser navigates to the file
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        void importCardFiles(files).then(setResults);
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <>
      {dragging && (
        <div className="fixed inset-0 z-50 bg-[var(--purple)]/10 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
          <div className="rounded-2xl border-2 border-dashed border-[var(--purple)] bg-white px-10 py-8 text-center shadow-lg">
            <FileDown className="h-8 w-8 text-[var(--purple-fg)] mx-auto mb-3" />
            <div className="text-sm font-semibold text-[var(--foreground)]">Drop cards to import</div>
            <div className="text-xs text-[var(--muted-fg)] mt-1">
              CharacterBinder PNGs or JSON — characters, lorebooks, personas, scenarios
            </div>
          </div>
        </div>
      )}

      <Dialog open={results !== null} onOpenChange={(open) => !open && setResults(null)}>
        <DialogContent className="max-w-md p-5">
          <DialogTitle>Import results</DialogTitle>
          <div className="space-y-2 mt-3">
            {(results ?? []).map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {r.ok ? (
                  <Check className="h-3.5 w-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <span className="font-medium text-[var(--foreground)]">{r.file}</span>{" "}
                  <span className="text-[var(--muted-fg)]">— {r.message}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button variant="purple" size="sm" onClick={() => setResults(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
