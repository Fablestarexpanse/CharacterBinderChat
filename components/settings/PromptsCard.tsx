"use client";

// ─── Settings → Prompts ───────────────────────────────────────────────────────
// Every prompt the app sends that is not already a card field or a preset:
// read the shipped text, edit an override, check it, preview it, see what
// changed, reset, and move edits between installs as a JSON file.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileText, RotateCcw, Upload } from "lucide-react";
import { getJson, sendJson } from "@/lib/api/client";
import type { PromptDef, PromptId } from "@/lib/prompts/defaults";
import { checkTemplate, renderTemplate } from "@/lib/prompts/render";
import { diffHunks, lineDiff } from "@/lib/prompts/diff";
import { saveBlob, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDiscardGuard, DiscardBar, type CloseRelay } from "@/components/ui/discardGuard";

interface PromptEntry extends PromptDef { override: string | null; overrideInvalid: boolean }

const EXPORT_FORMAT = "fablechat-prompts";

export function PromptsCard() {
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: number; prompts?: PromptEntry[]; error?: string }>({ key: -1 });
  const [editing, setEditing] = useState<PromptId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ prompts: PromptEntry[] }>("/api/prompts")
      .then((r) => { if (!cancelled) setResult({ key: reloadKey, prompts: r.prompts }); })
      .catch((e: Error) => { if (!cancelled) setResult({ key: reloadKey, error: e.message }); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const loading = result.key !== reloadKey;
  const prompts = result.prompts ?? [];
  const reload = () => setReloadKey((k) => k + 1);
  const edited = prompts.filter((p) => p.override !== null);
  const groups = [...new Set(prompts.map((p) => p.group))];
  const open = prompts.find((p) => p.id === editing) ?? null;

  const exportEdits = () => {
    const payload = { format: EXPORT_FORMAT, version: 1, prompts: Object.fromEntries(edited.map((p) => [p.id, p.override])) };
    saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "fablechat-prompts.json");
  };

  const importEdits = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { format?: string; prompts?: Record<string, unknown> };
      if (data.format !== EXPORT_FORMAT || !data.prompts || typeof data.prompts !== "object") {
        setNotice("That file is not a FableChat prompts export.");
        return;
      }
      const done: string[] = [];
      const failed: string[] = [];
      for (const [id, template] of Object.entries(data.prompts)) {
        const title = prompts.find((p) => p.id === id)?.title ?? id;
        try {
          await sendJson("PUT", "/api/prompts", { id, template });
          done.push(title);
        } catch (e) {
          failed.push(`${title} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      setNotice([done.length && `Imported: ${done.join(", ")}.`, failed.length && `Not imported: ${failed.join("; ")}.`].filter(Boolean).join(" ") || "Nothing to import.");
      reload();
    } catch {
      setNotice("Could not read that file as JSON.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Prompts</div>
          <div className="text-xs text-[var(--muted-fg)]">
            The instructions FableChat sends to the model behind the scenes. Edit any of them; Reset brings back the
            original. Saved on the server and kept in backups. The chat prompt itself is set by the character card,
            Presets and global instructions.
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} title="Load edits from a prompts file">
            <Upload className="h-3.5 w-3.5 mr-1" />Import
          </Button>
          <Button variant="outline" size="sm" onClick={exportEdits} disabled={edited.length === 0} title="Save your edited prompts to a file">
            <Download className="h-3.5 w-3.5 mr-1" />Export
          </Button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importEdits(f); }} />
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {notice && <div role="status" className="rounded-lg bg-[var(--muted)] px-3 py-2 text-xs">{notice}</div>}
        {result.error && <div role="alert" className="text-xs text-red-600">Could not load prompts: {result.error}</div>}
        {loading && !result.prompts && <div className="text-xs text-[var(--muted-fg)]">Loading…</div>}
        {groups.map((g) => (
          <div key={g}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] mb-1.5">{g}</div>
            <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]" role="list" aria-label={`${g} prompts`}>
              {prompts.filter((p) => p.group === g).map((p) => (
                <div key={p.id} role="listitem" aria-label={p.title} className="flex items-center gap-3 px-3 py-2.5">
                  <FileText className="h-4 w-4 text-[var(--purple-fg)] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--foreground)]">{p.title}</span>
                      {p.override !== null && (
                        <span className={cn("rounded-full px-1.5 text-[10px] font-medium border",
                          p.overrideInvalid ? "border-red-300 text-red-600" : "border-[var(--purple)] text-[var(--purple-fg)]")}
                          title={p.overrideInvalid ? "Your edit no longer passes its check, so the original is being used" : "You have edited this prompt"}>
                          {p.overrideInvalid ? "Edited · not in use" : "Edited"}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--muted-fg)]">{p.usedFor}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditing(p.id)}>{p.override !== null ? "Edit" : "View / edit"}</Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardBody>
      {open && <PromptEditorDialog key={open.id} entry={open} onClose={() => setEditing(null)} onSaved={(msg) => { setNotice(msg); reload(); }} />}
    </Card>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────

type View = "edit" | "preview" | "changes";

function PromptEditorDialog({ entry, onClose, onSaved }: { entry: PromptEntry; onClose: () => void; onSaved: (msg: string) => void }) {
  const closeRef = useRef<(() => void) | null>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) (closeRef.current ?? onClose)(); }}>
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        <PromptEditor entry={entry} onClose={onClose} onSaved={onSaved} closeRef={closeRef} />
      </DialogContent>
    </Dialog>
  );
}

function PromptEditor({ entry, onClose, onSaved, closeRef }: {
  entry: PromptEntry; onClose: () => void; onSaved: (msg: string) => void; closeRef: CloseRelay;
}) {
  const initial = entry.override ?? entry.template;
  const [draft, setDraft] = useState(initial);
  const [view, setView] = useState<View>("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== initial;
  const guard = useDiscardGuard(dirty, onClose, closeRef);

  const check = useMemo(() => checkTemplate(draft, entry.variables), [draft, entry.variables]);
  const samples = useMemo(() => Object.fromEntries(entry.variables.map((v) => [v.name, v.sample])), [entry.variables]);
  const preview = useMemo(() => renderTemplate(draft, samples), [draft, samples]);
  const hunks = useMemo(() => diffHunks(lineDiff(entry.template, draft)), [entry.template, draft]);
  const isDefault = draft === entry.template;

  const insert = (name: string) => {
    const el = textRef.current;
    const token = `{{${name}}}`;
    if (!el) { setDraft((d) => d + token); return; }
    const { selectionStart: s, selectionEnd: e } = el;
    setDraft(draft.slice(0, s) + token + draft.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await sendJson<{ ok: true; warnings: string[] }>("PUT", "/api/prompts", { id: entry.id, template: draft });
      onSaved(isDefault ? `${entry.title}: back to the original.` : `${entry.title} saved.${r.warnings.length ? ` Note: ${r.warnings.join(" ")}` : ""}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true); setError(null);
    try {
      await sendJson("DELETE", `/api/prompts?id=${encodeURIComponent(entry.id)}`);
      onSaved(`${entry.title}: back to the original.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="border-b border-[var(--border)] px-5 py-4 pr-12">
        <DialogTitle>{entry.title}</DialogTitle>
        <div className="text-[11px] text-[var(--muted-fg)] mt-0.5">{entry.usedFor}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {entry.warning && (
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /><span>{entry.warning}</span>
          </div>
        )}
        {entry.overrideInvalid && (
          <div role="alert" className="rounded-lg border border-red-300 px-3 py-2 text-[11px] text-red-600">
            This edit no longer passes its check, so the original prompt is being used. Fix it or reset it.
          </div>
        )}

        <div role="tablist" aria-label="Prompt view" className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
          {([["edit", "Edit"], ["preview", "Preview"], ["changes", isDefault ? "Changes" : `Changes (${hunks.filter((h) => h && h.kind !== "same").length})`]] as const).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn("px-3 py-1.5 cursor-pointer", view === v ? "bg-[var(--purple)] text-white" : "text-[var(--muted-fg)] hover:bg-[var(--muted)]")}>
              {label}
            </button>
          ))}
        </div>

        {view === "edit" && (
          <>
            <textarea
              ref={textRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              aria-label="Prompt text"
              className="w-full h-80 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-[11px] leading-relaxed text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--purple)] resize-y"
            />
            {entry.variables.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-[var(--foreground)] mb-1">Variables — click to insert at the cursor</div>
                <div className="space-y-1">
                  {entry.variables.map((v) => (
                    <div key={v.name} className="flex items-baseline gap-2 text-[11px]">
                      <button onClick={() => insert(v.name)} title={`Insert {{${v.name}}}`}
                        className="font-mono rounded bg-[var(--muted)] px-1.5 py-0.5 text-[var(--purple-fg)] hover:bg-[var(--purple-light)] cursor-pointer whitespace-nowrap">
                        {`{{${v.name}}}`}
                      </button>
                      <span className="text-[var(--muted-fg)]">{v.description}{v.required ? " Required." : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {view === "preview" && (
          <div>
            <div className="text-[11px] text-[var(--muted-fg)] mb-1">With example values filled in. In a real chat, the variables hold that chat&apos;s messages and memory.</div>
            <pre className="h-80 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{preview}</pre>
          </div>
        )}

        {view === "changes" && (
          <div className="h-80 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 font-mono text-[11px] leading-relaxed">
            {isDefault ? <div className="p-2 text-[var(--muted-fg)]">Same as the original.</div> : hunks.map((h, k) => h === null
              ? <div key={k} className="text-[var(--muted-fg)] px-1">⋯</div>
              : <div key={k} className={cn("px-1 whitespace-pre-wrap",
                  h.kind === "add" && "bg-green-500/15 text-green-700 dark:text-green-300",
                  h.kind === "del" && "bg-red-500/15 text-red-700 dark:text-red-300 line-through")}>
                  {h.kind === "add" ? "+ " : h.kind === "del" ? "− " : "  "}{h.text || " "}
                </div>)}
          </div>
        )}

        {(check.errors.length > 0 || check.warnings.length > 0) && (
          <div className="space-y-0.5 text-[11px]" role={check.errors.length ? "alert" : "status"}>
            {check.errors.map((e) => <div key={e} className="text-red-600">✕ {e}</div>)}
            {check.warnings.map((w) => <div key={w} className="text-[var(--muted-fg)]">• {w}</div>)}
          </div>
        )}
        {error && <div role="alert" className="text-[11px] text-red-600">{error}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3">
        {guard.confirming ? <DiscardBar onDiscard={guard.discard} onKeep={guard.keepEditing} /> : confirmReset ? (
          <>
            <span className="text-xs text-amber-700">Throw away your edit and use the original?</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" className="border-red-300 text-red-600" onClick={reset} disabled={busy}>Reset</Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            {entry.override !== null ? (
              <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />Reset to original
              </Button>
            ) : !isDefault && (
              <Button variant="outline" size="sm" onClick={() => setDraft(entry.template)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />Undo my changes
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={guard.attemptClose}>Cancel</Button>
              <Button variant="purple" size="sm" onClick={save} disabled={busy || !dirty || !check.ok}
                title={!check.ok ? "Fix the problems listed above first" : undefined}>
                Save
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
