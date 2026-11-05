"use client";

// ─── Unsaved-changes guard ────────────────────────────────────────────────────
// Closing an editor with edits in it used to throw them away without a word:
// Escape, a click outside the dialog, or Cancel. Now it asks, and closing the
// browser tab warns too.
//
// The dialog shell owns open/close but the form owns the edits, so the shell asks
// the form to close through `closeRef`: a ref the form fills with its own close attempt.
// Filled in an effect, not during render, per the React Compiler rules.

import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";

export type CloseRelay = RefObject<(() => void) | null>;

export function useDiscardGuard(dirty: boolean, close: () => void, closeRef?: CloseRelay) {
  const [confirming, setConfirming] = useState(false);
  const attemptClose = () => { if (dirty) setConfirming(true); else close(); };

  useEffect(() => {
    if (closeRef) closeRef.current = attemptClose;
  });

  // A tab closed or reloaded with edits open gets the browser's own "leave site?" prompt
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return { confirming, attemptClose, keepEditing: () => setConfirming(false), discard: () => { setConfirming(false); close(); } };
}

/** The question itself, shown in the editor's footer in place of its buttons. */
export function DiscardBar({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-wrap items-center gap-2">
      <span className="text-xs text-amber-700">Unsaved changes. Discard them?</span>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50" onClick={onDiscard}>Discard</Button>
        <Button variant="purple" size="sm" onClick={onKeep} autoFocus>Keep editing</Button>
      </div>
    </div>
  );
}
