"use client";

// ─── First messages ───────────────────────────────────────────────────────────
// Saved openers: the line that greets you when a chat starts, kept apart from
// any one character so it can open a chat with anyone. Picked in the start-chat
// dialog instead of the character's own greeting. "Copy from a character" saves
// a character's greeting (or one of its alternate greetings) here.

import { useEffect, useState } from "react";
import { MessageSquareQuote, Plus, Trash2 } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Every greeting a character carries, labelled for the copy menu */
export function greetingsOf(c: { name: string; firstMessage?: string; alternateGreetings?: string[] }) {
  const out: Array<{ label: string; text: string }> = [];
  if (c.firstMessage?.trim()) out.push({ label: `${c.name}: greeting`, text: c.firstMessage });
  (c.alternateGreetings ?? []).forEach((g, i) => {
    if (g.trim()) out.push({ label: `${c.name}: alternate greeting ${i + 1}`, text: g });
  });
  return out;
}

export function OpenersView() {
  const focusCardId = useUiStore((st) => st.focusCardId);
  useEffect(() => {
    if (!focusCardId) return;
    document.getElementById(`card-${focusCardId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    useUiStore.getState().setFocusCardId(null);
  }, [focusCardId]);
  const { openers, characters, addOpener, updateOpener, deleteOpener } = useFableStore();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const copyable = characters.flatMap((c) => greetingsOf(c));

  const copyFrom = (value: string) => {
    const g = copyable[Number(value)];
    if (!g) return;
    addOpener({ name: g.label, text: g.text });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--card)]">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[var(--foreground)]">First messages</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {openers.length} saved opener{openers.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button variant="purple" size="md" onClick={() => addOpener({ name: `First message ${openers.length + 1}`, text: "" })}>
            <Plus className="h-4 w-4 mr-1.5" />
            New
          </Button>
        </div>

        <p className="text-xs text-[var(--muted-fg)] mb-3">
          A first message greets you when a chat starts. Save the ones you like here and pick one
          when you start a chat with any character, instead of that character&apos;s own greeting.
          {" "}<code>{"{{char}}"}</code> and <code>{"{{user}}"}</code> are filled in for whoever is in the chat.
        </p>

        {copyable.length > 0 && (
          <select value="" onChange={(e) => copyFrom(e.target.value)} aria-label="Copy a greeting from a character"
            className="mb-6 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm">
            <option value="">Copy a greeting from a character…</option>
            {copyable.map((g, i) => <option key={i} value={i}>{g.label}</option>)}
          </select>
        )}

        {openers.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <MessageSquareQuote className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              No saved first messages yet: write one, or copy a character&apos;s greeting.
            </div>
          </div>
        )}

        <div className="space-y-6">
          {openers.map((o) => (
            <Card key={o.id} id={`card-${o.id}`}>
              <CardHeader className="flex items-center gap-3">
                <MessageSquareQuote className="h-4 w-4 flex-shrink-0 text-[var(--purple-fg)]" />
                <Input value={o.name} onChange={(e) => updateOpener(o.id, { name: e.target.value })}
                  placeholder="Name" aria-label="Name" className="flex-1 font-medium" />
                <Button
                  variant="ghost" size="icon"
                  className={`h-8 w-8 ${confirmDelete === o.id ? "text-red-500 bg-red-50" : "text-[var(--muted-fg)]"}`}
                  title={confirmDelete === o.id ? "Click again to delete this first message" : "Delete first message"}
                  onClick={() => {
                    if (confirmDelete === o.id) { deleteOpener(o.id); setConfirmDelete(null); }
                    else {
                      setConfirmDelete(o.id);
                      setTimeout(() => setConfirmDelete((v) => (v === o.id ? null : v)), 3000);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardBody>
                <Textarea value={o.text} onChange={(e) => updateOpener(o.id, { text: e.target.value })}
                  placeholder={'*{{char}} looks up as you come in.* "There you are."'} rows={5} aria-label="First message" />
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
