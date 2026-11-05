"use client";

// ─── Settings → Media: where copies of chat media are saved ───────────────────
// Photos and clips made in chats always live in FableChat's database (backups,
// sync and undo stay one file). This card adds a copy of each to a folder you
// choose, optionally one sub-folder per character. The server checks the folder
// can be written before keeping it.

import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FolderSettings { folder: string | null; byCharacter: boolean }
type Status = { kind: "ok" | "error"; text: string } | null;

export function MediaFolderCard() {
  const [saved, setSaved] = useState<FolderSettings | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/media/save-folder", { cache: "no-store" })
      .then((r) => r.json() as Promise<FolderSettings>)
      .then((s) => { if (!cancelled) setSaved(s); })
      .catch(() => { if (!cancelled) setStatus({ kind: "error", text: "Could not read this setting from FableChat's server." }); });
    return () => { cancelled = true; };
  }, []);

  const shown = draft ?? saved?.folder ?? "";
  const put = async (patch: Partial<{ folder: string | null; byCharacter: boolean }>, done: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/media/save-folder", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = (await res.json()) as { ok?: boolean; settings?: FolderSettings; error?: string };
      if (!res.ok || !body.ok || !body.settings) { setStatus({ kind: "error", text: body.error ?? `Not saved (HTTP ${res.status}).` }); return; }
      setSaved(body.settings);
      setDraft(null);
      setStatus({ kind: "ok", text: done.replace("{folder}", body.settings.folder ?? "") });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 font-semibold text-sm"><FolderOpen className="h-4 w-4" />Save chat media to a folder</div>
        <div className="text-xs text-[var(--muted-fg)]">
          Photos and clips made in your chats are always kept inside FableChat, in backups too. Set a folder here and a copy
          of each one is also saved there, named with the date and the character.
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <label className="block text-xs">
          <span className="font-medium">Folder</span>
          <Input className="mt-1 h-8 text-xs" value={shown} onChange={(e) => setDraft(e.target.value)} aria-label="Folder for chat media"
            placeholder="F:\FableChat media" disabled={!saved} />
        </label>
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-[var(--purple)]" checked={saved?.byCharacter ?? true} disabled={!saved || busy}
            onChange={(e) => void put({ byCharacter: e.target.checked }, e.target.checked ? "Each character gets their own folder." : "Everything goes into one folder.")} />
          <span>A folder for each character<span className="block text-[11px] text-[var(--muted-fg)]">For example <code className="bg-[var(--muted)] px-1 rounded">Ronan\2026-11-05_1432_Ronan_photo_b37fe98e.png</code></span></span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="purple" size="sm" disabled={!saved || busy || !shown.trim() || shown.trim() === saved?.folder}
            onClick={() => void put({ folder: shown.trim() }, "Copies will be saved to {folder}.")}>{busy ? "Checking…" : "Save folder"}</Button>
          {saved?.folder && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void put({ folder: null }, "Copies are off. Media stays inside FableChat.")}>Stop saving copies</Button>
          )}
          {!saved?.folder && saved && <span className="text-[11px] text-[var(--muted-fg)]">Off: media is kept inside FableChat only.</span>}
        </div>
        {status && (
          <div role={status.kind === "error" ? "alert" : "status"} className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-green-700 dark:text-green-400"}`}>{status.text}</div>
        )}
      </CardBody>
    </Card>
  );
}
