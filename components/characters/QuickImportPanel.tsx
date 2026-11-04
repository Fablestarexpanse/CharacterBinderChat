"use client";

// ─── Quick Import ─────────────────────────────────────────────────────────────
// Paste a character written any way — a JanitorAI dump, headed sections, W++, a
// JSON export — and see how it would be split into fields before anything is
// applied. The parser never drops text (what it cannot place lands in
// Description with its label); this adds a checkbox per field so a wrong guess
// can be left out rather than fixed afterwards.

import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CHARACTER_FIELD_LABELS, CHARACTER_FIELD_ORDER, parseCardText, toCharacterFields, type CardField,
} from "@/lib/cards/textParser";

export interface QuickImportResult {
  fields: Partial<Record<CardField, string>>;
  tags: string[];
}

export function QuickImportPanel({ onApply }: { onApply: (result: QuickImportResult) => void }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ fields: Partial<Record<CardField, string>>; tags: string[]; notes: string[] } | null>(null);
  const [skip, setSkip] = useState<Set<CardField>>(new Set());

  const sort = () => {
    const result = parseCardText(text);
    setParsed({ fields: toCharacterFields(result), tags: result.tags, notes: result.notes });
    setSkip(new Set());
  };

  const entries = parsed ? CHARACTER_FIELD_ORDER.filter((f) => parsed.fields[f]) : [];
  const chosen = entries.filter((f) => !skip.has(f));

  const apply = () => {
    if (!parsed) return;
    onApply({
      fields: Object.fromEntries(chosen.map((f) => [f, parsed.fields[f]!])),
      tags: parsed.tags,
    });
    setText("");
    setParsed(null);
  };

  return (
    <details className="rounded-lg border border-[var(--border)] px-3 py-2">
      <summary className="cursor-pointer select-none text-xs font-medium text-[var(--foreground)]">
        <ClipboardPaste className="inline h-3 w-3 mr-1 -mt-0.5" />
        Quick import <span className="font-normal text-[var(--muted-fg)]">— paste a character and sort it into fields</span>
      </summary>
      <div className="mt-3 space-y-2">
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setParsed(null); }}
          rows={5}
          placeholder={"Paste anything: headed sections (Personality: …), W++, a JSON card, or plain paragraphs."}
        />
        <Button size="sm" variant="outline" onClick={sort} disabled={!text.trim()}>Sort into fields</Button>

        {parsed && entries.length === 0 && (
          <p className="text-[11px] text-[var(--muted-fg)]">Nothing could be sorted from that text.</p>
        )}
        {parsed && entries.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-[var(--muted-fg)]">
              {parsed.notes[0] ?? "Sorted."} Untick anything it got wrong. Fields you have already filled in
              are added to, not replaced.
            </p>
            {entries.map((f) => (
              <label key={f} className="flex items-start gap-2 rounded-md bg-[var(--muted)] px-2 py-1.5 cursor-pointer">
                <input
                  type="checkbox" checked={!skip.has(f)}
                  onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; })}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--purple)]"
                />
                <span className="min-w-0 text-[11px]">
                  <span className="font-medium text-[var(--foreground)]">{CHARACTER_FIELD_LABELS[f]}</span>
                  <span className="block text-[var(--muted-fg)] truncate">{parsed.fields[f]!.replace(/\s+/g, " ").slice(0, 110)}</span>
                </span>
              </label>
            ))}
            {parsed.tags.length > 0 && (
              <p className="text-[11px] text-[var(--muted-fg)]">Tags found: {parsed.tags.join(", ")}</p>
            )}
            <Button size="sm" variant="purple" onClick={apply} disabled={chosen.length === 0}>
              Apply {chosen.length} field{chosen.length === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
