"use client";

// ─── Settings → Media connections ─────────────────────────────────────────────
// Add, test and choose the services that make images, video and speech, and
// that turn speech into text. Requests go through the FableChat server, so a
// key typed here is stored encrypted there and never comes back to the browser.

import { useEffect, useState } from "react";
import { CheckCircle2, Image as ImageIcon, Mic, Plus, Trash2, Video, Volume2, XCircle } from "lucide-react";
import { getJson, sendJson } from "@/lib/api/client";
import { useFableStore } from "@/lib/store";
import {
  KIND_LABEL, MEDIA_PROVIDERS, PURPOSES, providerInfo, validateConnection,
  type MediaConnection, type MediaConnectionView, type MediaDefaults, type MediaKind, type MediaProviderId, type MediaPurpose,
} from "@/lib/media/connections";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ListData { connections: MediaConnectionView[]; defaults: MediaDefaults }
interface TestOutcome { ok: boolean; label: string; sample?: { type: "image" | "audio"; dataUrl: string } }

const KINDS: MediaKind[] = ["image", "video", "voice", "stt"];
const KIND_ICON = { image: ImageIcon, video: Video, voice: Volume2, stt: Mic } as const;

interface Draft { id: string; isNew: boolean; name: string; kind: MediaKind; provider: MediaProviderId; baseUrl: string; model: string; voice: string; key: string; hasKey: boolean }

const newId = (provider: string) => `${provider}-${Math.random().toString(36).slice(2, 8)}`;

function draftFor(kind: MediaKind, provider?: MediaProviderId, baseUrl?: string): Draft {
  const info = provider ? providerInfo(provider)! : MEDIA_PROVIDERS.find((p) => p.kinds.includes(kind))!;
  return {
    id: newId(info.id), isNew: true, kind, provider: info.id,
    name: `${info.label}${info.kinds.length > 1 ? ` (${KIND_LABEL[kind].toLowerCase()})` : ""}`,
    baseUrl: baseUrl ?? info.defaultBaseUrl, model: "", voice: "", key: "", hasKey: false,
  };
}

export function MediaConnectionsCard() {
  const comfyUrl = useFableStore((s) => s.providerSettings.comfyui.baseUrl);
  const reloadKey = 0; // mutations return the fresh list, so there is nothing to reload
  const [result, setResult] = useState<{ key: number; data?: ListData; error?: string }>({ key: -1 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, TestOutcome | "running">>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<ListData>("/api/media/connections")
      .then((d) => { if (!cancelled) setResult({ key: reloadKey, data: d }); })
      .catch((e: Error) => { if (!cancelled) setResult({ key: reloadKey, error: e.message }); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const data = result.data;
  const apply = (d: ListData) => setResult((r) => ({ key: r.key, data: d }));

  const runTest = async (id: string, body: object) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    try {
      const r = await sendJson<TestOutcome>("POST", "/api/media/test", body);
      setTests((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, label: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const draftConnection = (d: Draft): MediaConnection => ({
    id: d.id, name: d.name, kind: d.kind, provider: d.provider, baseUrl: d.baseUrl,
    ...(d.model ? { model: d.model } : {}), ...(d.voice ? { voice: d.voice } : {}),
  });

  const save = async () => {
    if (!draft) return;
    const v = validateConnection(draftConnection(draft));
    if (!v.ok) { setError(v.errors.join(" ")); return; }
    setError(null);
    try {
      const d = await sendJson<ListData>("PUT", "/api/media/connections", {
        connection: v.value, ...(draft.key.trim() ? { key: draft.key } : {}),
      });
      apply(d);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    try {
      apply(await sendJson<ListData>("DELETE", `/api/media/connections?id=${encodeURIComponent(id)}`));
      setConfirmRemove(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setDefault = async (purpose: MediaPurpose, id: string) => {
    // Only the one that changed: the server merges, so quick changes don't race
    try { apply(await sendJson<ListData>("PUT", "/api/media/connections", { defaults: { [purpose]: id || null } })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const edit = (c: MediaConnectionView) =>
    setDraft({ id: c.id, isNew: false, name: c.name, kind: c.kind, provider: c.provider, baseUrl: c.baseUrl, model: c.model ?? "", voice: c.voice ?? "", key: "", hasKey: c.hasKey });

  return (
    <Card>
      <CardHeader>
        <div className="font-semibold text-sm">Media connections</div>
        <div className="text-xs text-[var(--muted-fg)]">
          The services that make images, video and speech, and turn your speech into text. Test makes a real request
          (a small image or one spoken sentence, so a cloud test may cost a little). Keys are stored encrypted on this
          computer and are never sent back to the browser or put in backups.
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        {result.error && <div role="alert" className="text-xs text-red-600">Could not load connections: {result.error}</div>}
        {error && <div role="alert" className="text-xs text-red-600">{error}</div>}
        {KINDS.map((kind) => {
          const Icon = KIND_ICON[kind];
          const list = data?.connections.filter((c) => c.kind === kind) ?? [];
          const comfyQuick = (kind === "image" || kind === "video") && !list.some((c) => c.provider === "comfyui");
          return (
            <section key={kind} aria-label={KIND_LABEL[kind]}>
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="h-3.5 w-3.5 text-[var(--purple-fg)]" />
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] flex-1">{KIND_LABEL[kind]}</div>
                {comfyQuick && (
                  <Button variant="outline" size="sm" onClick={() => setDraft(draftFor(kind, "comfyui", comfyUrl))} title={`Use ComfyUI at ${comfyUrl}`}>
                    Use my ComfyUI
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setDraft(draftFor(kind))}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
              </div>
              {list.length === 0 && !(draft?.isNew && draft.kind === kind) && (
                <div className="text-[11px] text-[var(--muted-fg)] rounded-lg border border-dashed border-[var(--border)] px-3 py-2">
                  None yet.{kind === "stt" ? " Optional: only needed to speak instead of typing." : ""}
                </div>
              )}
              <div className="space-y-2">
                {list.map((c) => {
                  const t = tests[c.id];
                  const info = providerInfo(c.provider);
                  if (draft && !draft.isNew && draft.id === c.id) return <DraftForm key={c.id} draft={draft} setDraft={setDraft} onSave={save} onTest={() => runTest(c.id, { connection: draftConnection(draft), ...(draft.key.trim() ? { key: draft.key } : {}) })} test={t} />;
                  return (
                    <div key={c.id} role="group" aria-label={c.name} className="rounded-lg border border-[var(--border)] px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex-1 min-w-[10rem]">
                          <div className="text-xs font-medium text-[var(--foreground)]">{c.name}</div>
                          <div className="text-[11px] text-[var(--muted-fg)] break-all">
                            {info?.label} · {c.baseUrl}{c.model ? ` · ${c.model}` : ""}{c.voice ? ` · voice ${c.voice}` : ""}
                            {info?.keyRequired || c.hasKey ? (c.hasKey ? " · key saved" : " · no key yet") : ""}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => runTest(c.id, { id: c.id })} disabled={t === "running"}>{t === "running" ? "Testing…" : "Test"}</Button>
                        <Button variant="outline" size="sm" onClick={() => edit(c)}>Edit</Button>
                        {confirmRemove === c.id ? (
                          <>
                            <Button variant="outline" size="sm" className="border-red-300 text-red-600" onClick={() => remove(c.id)}>Remove</Button>
                            <Button variant="outline" size="sm" onClick={() => setConfirmRemove(null)}>Keep</Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="icon" title="Remove" aria-label={`Remove ${c.name}`} onClick={() => setConfirmRemove(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                      <TestResult t={t} />
                    </div>
                  );
                })}
                {draft?.isNew && draft.kind === kind && (
                  <DraftForm draft={draft} setDraft={setDraft} onSave={save} onTest={() => runTest(draft.id, { connection: draftConnection(draft), ...(draft.key.trim() ? { key: draft.key } : {}) })} test={tests[draft.id]} />
                )}
              </div>
            </section>
          );
        })}

        {data && data.connections.length > 0 && (
          <section aria-label="Defaults">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] mb-1.5">Use for</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PURPOSES.map((p) => {
                const options = data.connections.filter((c) => c.kind === p.kind);
                return (
                  <label key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <span><span className="font-medium text-[var(--foreground)]">{p.label}</span><span className="block text-[10px] text-[var(--muted-fg)]">{p.hint}</span></span>
                    <select
                      aria-label={`Connection for ${p.label}`}
                      value={data.defaults[p.id] ?? ""}
                      onChange={(e) => setDefault(p.id, e.target.value)}
                      disabled={options.length === 0}
                      className="h-8 max-w-[11rem] rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs"
                    >
                      <option value="">{options.length ? `First ${KIND_LABEL[p.kind].toLowerCase()} connection` : "None set up"}</option>
                      {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
          </section>
        )}
      </CardBody>
    </Card>
  );
}

function TestResult({ t }: { t: TestOutcome | "running" | undefined }) {
  if (!t || t === "running") return null;
  return (
    <div role="status" className="mt-2 space-y-2">
      <div className={cn("flex items-start gap-1.5 text-[11px]", t.ok ? "text-green-700 dark:text-green-400" : "text-red-600")}>
        {t.ok ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-px" /> : <XCircle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />}
        <span>{t.label}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL test sample, not a site asset */}
      {t.sample?.type === "image" && <img src={t.sample.dataUrl} alt="Test image from this connection" className="h-32 w-32 rounded-lg object-cover border border-[var(--border)]" />}
      {t.sample?.type === "audio" && <audio controls src={t.sample.dataUrl} className="h-8 w-full max-w-sm" aria-label="Test speech from this connection" />}
    </div>
  );
}

function DraftForm({ draft, setDraft, onSave, onTest, test }: {
  draft: Draft; setDraft: (d: Draft | null) => void; onSave: () => void; onTest: () => void; test: TestOutcome | "running" | undefined;
}) {
  const info = providerInfo(draft.provider)!;
  const choices = MEDIA_PROVIDERS.filter((p) => p.kinds.includes(draft.kind));
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  return (
    <div role="group" aria-label={draft.isNew ? `New ${KIND_LABEL[draft.kind].toLowerCase()} connection` : `Editing ${draft.name}`} className="rounded-lg border border-[var(--purple)] bg-[var(--purple-light)]/40 px-3 py-3 space-y-2.5">
      {draft.isNew && choices.length > 1 && (
        <label className="block text-xs">
          <span className="font-medium">Service</span>
          <select aria-label="Service" value={draft.provider}
            onChange={(e) => { const p = providerInfo(e.target.value as MediaProviderId)!; set({ provider: p.id, baseUrl: p.defaultBaseUrl, name: p.label, model: "", voice: "" }); }}
            className="mt-1 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs">
            {choices.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      )}
      <div className="text-[11px] text-[var(--muted-fg)]">{info.blurb} {info.help}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs"><span className="font-medium">Name</span><Input className="mt-1 h-8 text-xs" value={draft.name} onChange={(e) => set({ name: e.target.value })} aria-label="Name" /></label>
        <label className="text-xs"><span className="font-medium">Address</span><Input className="mt-1 h-8 text-xs" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} aria-label="Address" /></label>
        {info.fields.includes("model") && (
          <label className="text-xs"><span className="font-medium">Model</span><Input className="mt-1 h-8 text-xs" value={draft.model} placeholder={info.modelPlaceholder} onChange={(e) => set({ model: e.target.value })} aria-label="Model" /></label>
        )}
        {info.fields.includes("voice") && (
          <label className="text-xs"><span className="font-medium">Voice</span><Input className="mt-1 h-8 text-xs" value={draft.voice} placeholder={info.voicePlaceholder} onChange={(e) => set({ voice: e.target.value })} aria-label="Voice" /></label>
        )}
        <label className="text-xs sm:col-span-2">
          <span className="font-medium">API key{info.keyRequired ? "" : " (optional)"}</span>
          <Input className="mt-1 h-8 text-xs" type="password" autoComplete="off" value={draft.key}
            placeholder={draft.hasKey ? "Saved. Leave empty to keep it" : info.keyRequired ? "Required" : "Not needed for a local server"}
            onChange={(e) => set({ key: e.target.value })} aria-label="API key" />
        </label>
      </div>
      <TestResult t={test} />
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onTest} disabled={test === "running"}>{test === "running" ? "Testing…" : "Test"}</Button>
        <Button variant="outline" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
        <Button variant="purple" size="sm" onClick={onSave}>Save</Button>
      </div>
    </div>
  );
}
