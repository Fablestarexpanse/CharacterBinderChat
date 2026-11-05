"use client";

// ─── Workflows ────────────────────────────────────────────────────────────────
// ComfyUI templates: the ones shipped in workflows/ and the ones you import.
// Import takes ComfyUI's "Export (API)" file as it is: FableChat reads which
// node holds the prompt, seed, size and so on, and you confirm or change that
// with dropdowns instead of hand-writing node paths.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ClipboardPaste, Copy, GitBranch, Loader2, Play, Trash2, Upload } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { getJson, sendJson } from "@/lib/api/client";
import type { WorkflowSummary } from "@/lib/api/dto";
import { queueImage } from "@/lib/chat/imageGen";
import {
  ROLE_INFO, missingNodeTypes, readWorkflow,
  type ApiWorkflow, type WorkflowMapping, type WorkflowPurpose, type WorkflowReading, type WorkflowRole,
} from "@/lib/media/workflowDetect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useDiscardGuard, DiscardBar, type CloseRelay } from "@/components/ui/discardGuard";

const PURPOSE_LABEL: Record<WorkflowPurpose, string> = { portrait: "Portraits", photo: "Photo messages", scene: "Scene images", video: "Video" };
const TEST_PROMPT = "a red apple on a wooden table, soft window light";

type Editing = { mode: "import"; workflow?: ApiWorkflow } | { mode: "edit"; slug: string; title: string; description: string | null; workflow: ApiWorkflow };

export function WorkflowsView() {
  const { imageSettings, setImageSettings, providerSettings, imageJobs } = useFableStore();
  const { setActiveSection } = useUiStore();
  const comfyBase = providerSettings.comfyui.baseUrl;
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: number; list: WorkflowSummary[]; error: string | null } | null>(null);
  const [installed, setInstalled] = useState<{ state: "idle" | "checking" | "done" | "error"; types?: Record<string, unknown>; error?: string }>({ state: "idle" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({}); // slug -> job id
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ workflows?: WorkflowSummary[] }>("/api/workflows")
      .then((d) => { if (!cancelled) setResult({ key: reloadKey, list: d.workflows ?? [], error: null }); })
      .catch((e: Error) => { if (!cancelled) setResult({ key: reloadKey, list: [], error: e.message }); });
    return () => { cancelled = true; };
  }, [reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);
  const loading = result === null;

  const checkNodes = async () => {
    setInstalled({ state: "checking" });
    try {
      const types = await getJson<Record<string, unknown>>(`/api/comfyui/object_info?base=${encodeURIComponent(comfyBase)}`);
      setInstalled({ state: "done", types });
    } catch (e) {
      setInstalled({ state: "error", error: `Could not ask ComfyUI at ${comfyBase} which nodes it has: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const openFile = async (file: File) => {
    try {
      setEditing({ mode: "import", workflow: JSON.parse(await file.text()) as ApiWorkflow });
    } catch {
      setNotice(`${file.name} is not valid JSON.`);
    }
  };

  const testRun = (wf: WorkflowSummary) => {
    const job = queueImage({ ...imageSettings, workflow: wf.slug, prompt: TEST_PROMPT, negativePrompt: "", batchCount: 1, loras: [] });
    setTests((t) => ({ ...t, [wf.slug]: job.id }));
  };

  const remove = async (slug: string) => {
    try {
      await sendJson("DELETE", `/api/workflows/${slug}`);
      if (imageSettings.workflow === slug) setImageSettings({ workflow: result?.list.find((w) => w.source === "bundled")?.slug ?? "" });
      setConfirmDelete(null);
      reload();
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  };

  const edit = async (wf: WorkflowSummary, asCopy: boolean) => {
    try {
      const full = await getJson<ApiWorkflow>(`/api/workflows/${wf.slug}`);
      if (asCopy) {
        const { _meta, ...graph } = full;
        void _meta;
        setEditing({ mode: "import", workflow: { ...graph, _meta: { title: `${wf.title} (copy)`, fablechat: (full._meta as { fablechat?: WorkflowMapping } | undefined)?.fablechat } } as ApiWorkflow });
      } else {
        setEditing({ mode: "edit", slug: wf.slug, title: wf.title, description: wf.description, workflow: full });
      }
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div
      className="flex-1 overflow-y-auto p-4 md:p-6 bg-[var(--card)]"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { const f = e.dataTransfer.files[0]; setDragging(false); if (f && /json$/i.test(f.name)) { e.preventDefault(); e.stopPropagation(); void openFile(f); } }}
    >
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Workflows</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">ComfyUI templates for images and video: the ones FableChat ships with, and yours.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={checkNodes} disabled={installed.state === "checking"} title={`Ask ComfyUI at ${comfyBase} which nodes it has`}>
              {installed.state === "checking" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}Check nodes
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing({ mode: "import" })}><ClipboardPaste className="h-3.5 w-3.5 mr-1" />Paste</Button>
            <Button variant="purple" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5 mr-1" />Import</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void openFile(f); }} />
          </div>
        </div>
        <p className="text-xs text-[var(--muted-fg)] mt-3 mb-5">
          In ComfyUI, build and test a workflow, then use <strong>Workflow → Export (API)</strong> and import or drop that
          file here. FableChat finds the prompt, seed, size and other inputs itself; you check them before saving.
        </p>

        {dragging && <div className="mb-4 rounded-xl border-2 border-dashed border-[var(--purple)] p-6 text-center text-sm text-[var(--purple-fg)]">Drop the exported workflow to import it</div>}
        {notice && <div role="status" className="mb-4 rounded-lg bg-[var(--muted)] px-3 py-2 text-xs">{notice}</div>}
        {installed.state === "error" && <div role="alert" className="mb-4 rounded-lg border border-red-200 px-3 py-2 text-xs text-red-600">{installed.error}</div>}
        {installed.state === "done" && <div role="status" className="mb-4 text-xs text-[var(--muted-fg)]">ComfyUI reports {Object.keys(installed.types ?? {}).length.toLocaleString()} node types. Each workflow below says whether it has what it needs.</div>}

        {loading && <div className="flex items-center gap-2 text-sm text-[var(--muted-fg)]"><Loader2 className="h-4 w-4 animate-spin" />Reading workflows…</div>}
        {result?.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">{result.error}</div>}

        <div className="space-y-3" role="list" aria-label="Workflows">
          {result?.list.map((wf) => {
            const isDefault = wf.slug === imageSettings.workflow;
            const missing = installed.state === "done" && installed.types ? missingNodeTypes(wf.classTypes, installed.types) : null;
            const job = tests[wf.slug] ? imageJobs.find((j) => j.id === tests[wf.slug]) : undefined;
            return (
              <Card key={wf.slug} role="listitem" aria-label={wf.title} className={isDefault ? "border-[var(--purple)]" : ""}>
                <CardBody className="space-y-2">
                  <div className="flex items-start gap-3">
                    <GitBranch className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isDefault ? "text-[var(--purple-fg)]" : "text-[var(--muted-fg)]"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--foreground)]">{wf.title}</span>
                        {wf.source === "imported" && <Badge variant="default">yours</Badge>}
                        {wf.purpose && <Badge variant="default">{PURPOSE_LABEL[wf.purpose]}</Badge>}
                        {isDefault && <Badge variant="purple"><Check className="h-2.5 w-2.5 mr-0.5" />active</Badge>}
                        {wf.error && <Badge variant="red"><AlertTriangle className="h-2.5 w-2.5 mr-0.5" />unreadable</Badge>}
                      </div>
                      {wf.description && <p className="text-xs text-[var(--muted-fg)] mt-1 leading-relaxed">{wf.description}</p>}
                      {wf.error && <p className="text-xs text-red-600 mt-1">{wf.error}</p>}
                    </div>
                  </div>
                  {!wf.error && (
                    <>
                      <div className="flex items-center gap-1.5 flex-wrap pl-7">
                        <Badge variant="default">{wf.nodeCount} nodes</Badge>
                        {wf.controls.length > 0
                          ? wf.controls.map((c) => <Badge key={c} variant="green">{c}</Badge>)
                          : <Badge variant="yellow">nothing mapped: settings will not reach it</Badge>}
                        {missing && (missing.length === 0
                          ? <Badge variant="green"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />all nodes installed</Badge>
                          : <Badge variant="red" title={missing.join(", ")}>missing {missing.length}: {missing.slice(0, 3).join(", ")}{missing.length > 3 ? "…" : ""}</Badge>)}
                      </div>
                      <div className="flex flex-wrap gap-2 pl-7">
                        {!isDefault && wf.purpose !== "video" && <Button variant="outline" size="sm" onClick={() => setImageSettings({ workflow: wf.slug })}>Use for Image Studio</Button>}
                        {wf.purpose !== "video" && (
                          <Button variant="outline" size="sm" onClick={() => testRun(wf)} disabled={job?.status === "queued" || job?.status === "generating"} title="Make one small test image with this workflow">
                            <Play className="h-3 w-3 mr-1" />{job?.status === "queued" || job?.status === "generating" ? "Running…" : "Test run"}
                          </Button>
                        )}
                        {wf.source === "imported"
                          ? <Button variant="outline" size="sm" onClick={() => edit(wf, false)}>Edit</Button>
                          : <Button variant="outline" size="sm" onClick={() => edit(wf, true)} title="Bundled templates are read-only; a copy can be changed"><Copy className="h-3 w-3 mr-1" />Import a copy</Button>}
                        {wf.source === "imported" && (confirmDelete === wf.slug ? (
                          <>
                            <Button variant="outline" size="sm" className="border-red-300 text-red-600" onClick={() => remove(wf.slug)}>Delete</Button>
                            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Keep</Button>
                          </>
                        ) : <Button variant="ghost" size="icon" aria-label={`Delete ${wf.title}`} title="Delete" onClick={() => setConfirmDelete(wf.slug)}><Trash2 className="h-3.5 w-3.5" /></Button>)}
                      </div>
                      {job && (
                        <div className="pl-7 text-xs" role="status">
                          {job.status === "failed" && <span className="text-red-600">Test run failed: {job.error}</span>}
                          {(job.status === "queued" || job.status === "generating") && <span className="text-[var(--muted-fg)]">Running in ComfyUI…</span>}
                          {job.status === "complete" && (
                            <div className="flex gap-2 items-center">
                              {/* eslint-disable-next-line @next/next/no-img-element -- ComfyUI output through the local proxy */}
                              {job.outputUrls.slice(0, 1).map((u) => <img key={u} src={u} alt="Test run result" className="h-24 w-24 rounded-lg object-cover border border-[var(--border)]" />)}
                              <span className="text-green-700 dark:text-green-400">Worked.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {result && result.list.length > 0 && (
          <Button variant="outline" size="sm" className="mt-6" onClick={() => setActiveSection("image-studio")}>Open Image Studio</Button>
        )}
      </div>

      {editing && (
        <WorkflowDialog
          key={editing.mode === "edit" ? editing.slug : "import"}
          editing={editing}
          installed={installed.state === "done" ? installed.types : undefined}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setNotice(msg); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Import / edit dialog ─────────────────────────────────────────────────────

function WorkflowDialog(props: { editing: Editing; installed?: Record<string, unknown>; onClose: () => void; onSaved: (msg: string) => void }) {
  const closeRef = useRef<(() => void) | null>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) (closeRef.current ?? props.onClose)(); }}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <WorkflowForm {...props} closeRef={closeRef} />
      </DialogContent>
    </Dialog>
  );
}

function WorkflowForm({ editing, installed, onClose, onSaved, closeRef }: {
  editing: Editing; installed?: Record<string, unknown>; onClose: () => void; onSaved: (msg: string) => void; closeRef: CloseRelay;
}) {
  const [workflow, setWorkflow] = useState<ApiWorkflow | undefined>(editing.workflow);
  const [pasted, setPasted] = useState("");
  const reading: WorkflowReading | { ok: false; error: string } | null = useMemo(() => (workflow ? readWorkflow(workflow) : null), [workflow]);
  const stored = (workflow?._meta as { fablechat?: WorkflowMapping; title?: string; description?: string } | undefined);
  const initial = useMemo(() => (reading?.ok ? { ...reading.mapping, ...(stored?.fablechat ?? {}) } : {}), [reading, stored]);
  const [mapping, setMapping] = useState<WorkflowMapping | null>(null);
  const m = mapping ?? initial;
  const [title, setTitle] = useState(editing.mode === "edit" ? editing.title : "");
  const [description, setDescription] = useState(editing.mode === "edit" ? editing.description ?? "" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = editing.mode === "import" ? !!workflow : mapping !== null || title !== editing.title || description !== (editing.description ?? "");
  const guard = useDiscardGuard(dirty, onClose, closeRef);
  const shownTitle = title || (reading?.ok ? reading.title ?? stored?.title ?? "" : "");

  const loadPasted = () => {
    try { setWorkflow(JSON.parse(pasted) as ApiWorkflow); setError(null); }
    catch { setError("That is not valid JSON. Paste the whole file from Export (API)."); }
  };

  const setRole = (role: WorkflowRole, path: string) => setMapping({ ...m, [role]: path || null });
  const toggleRef = (path: string) => {
    const cur = m.referenceImageNodes ?? [];
    setMapping({ ...m, referenceImageNodes: cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path] });
  };

  const save = async () => {
    if (!workflow || !reading?.ok) return;
    if (!shownTitle.trim()) { setError("Give the workflow a name."); return; }
    setBusy(true); setError(null);
    try {
      if (editing.mode === "edit") await sendJson("PUT", `/api/workflows/${editing.slug}`, { title: shownTitle, description, mapping: m });
      else {
        const { _meta, ...graph } = workflow;
        void _meta;
        await sendJson("POST", "/api/workflows", { title: shownTitle, description, workflow: graph, mapping: m });
      }
      onSaved(`${shownTitle} ${editing.mode === "edit" ? "saved" : "imported"}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const missing = reading?.ok && installed ? missingNodeTypes(reading.classTypes, installed) : null;

  return (
    <>
      <div className="border-b border-[var(--border)] px-5 py-4 pr-12">
        <DialogTitle>{editing.mode === "edit" ? `Edit ${editing.title}` : "Import a workflow"}</DialogTitle>
        <div className="text-[11px] text-[var(--muted-fg)] mt-0.5">Check which input FableChat fills for each setting. Anything set to “not used” keeps the value saved in the workflow.</div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {!workflow && (
          <div className="space-y-2">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Workflow JSON" placeholder="Paste the JSON from ComfyUI's Workflow → Export (API)…"
              className="w-full h-48 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-[11px]" />
            <div className="flex justify-end"><Button variant="purple" size="sm" onClick={loadPasted} disabled={!pasted.trim()}>Read it</Button></div>
          </div>
        )}
        {reading && !reading.ok && <div role="alert" className="rounded-lg border border-red-300 px-3 py-2 text-xs text-red-600">{reading.error}</div>}
        {reading?.ok && (
          <>
            <div className="text-[11px] text-[var(--muted-fg)]">{reading.nodeCount} nodes · {reading.isVideo ? "looks like a video workflow" : "looks like an image workflow"}</div>
            {missing && (missing.length === 0
              ? <div className="text-[11px] text-green-700 dark:text-green-400">Your ComfyUI has every node this workflow uses.</div>
              : <div role="alert" className="rounded-lg border border-amber-300 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                  Your ComfyUI is missing {missing.length} node type{missing.length === 1 ? "" : "s"} this workflow needs: <strong>{missing.join(", ")}</strong>. Install them (for example with ComfyUI Manager → Install Missing Custom Nodes) or the workflow will fail.
                </div>)}
            {!installed && <div className="text-[11px] text-[var(--muted-fg)]">Tip: Check nodes on the Workflows screen first to see whether your ComfyUI has everything this needs.</div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs sm:col-span-2"><span className="font-medium">Name</span>
                <input value={shownTitle} onChange={(e) => setTitle(e.target.value)} aria-label="Name" className="mt-1 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs" />
              </label>
              <label className="text-xs sm:col-span-2"><span className="font-medium">Description (optional)</span>
                <input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" className="mt-1 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs" />
              </label>
              <label className="text-xs"><span className="font-medium">Used for</span>
                <select aria-label="Used for" value={m.purpose ?? "scene"} onChange={(e) => setMapping({ ...m, purpose: e.target.value as WorkflowPurpose })}
                  className="mt-1 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs">
                  {Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer sm:col-span-2">
                <input type="checkbox" checked={m.ownSampling === true} onChange={(e) => setMapping({ ...m, ownSampling: e.target.checked || undefined })} className="mt-0.5 accent-[var(--purple)]" />
                <span><span className="font-medium">Keep this workflow&apos;s own steps, CFG and sampler</span>
                  <span className="block text-[11px] text-[var(--muted-fg)]">For tuned or distilled models. Image Studio&apos;s steps, CFG and sampler are then ignored for this workflow; prompt, seed and size are still filled in.</span></span>
              </label>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium">Settings FableChat fills in</div>
              {ROLE_INFO.filter((r) => !r.video || reading.isVideo || m.purpose === "video").map((r) => (
                <label key={r.role} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-xs">
                  <span className="text-[var(--muted-fg)]">{r.label}</span>
                  <select aria-label={r.label} value={(m[r.role] as string | null | undefined) ?? ""} onChange={(e) => setRole(r.role, e.target.value)}
                    className="h-8 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs">
                    <option value="">Not used</option>
                    {reading.candidates[r.role].map((c) => <option key={c.path} value={c.path}>{c.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {reading.imageInputs.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium">Reference images go into</div>
                <div className="text-[11px] text-[var(--muted-fg)]">Load Image nodes that receive a character&apos;s reference pictures (or a video&apos;s first frame).</div>
                {reading.imageInputs.map((c) => (
                  <label key={c.path} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={(m.referenceImageNodes ?? []).includes(c.path)} onChange={() => toggleRef(c.path)} className="accent-[var(--purple)]" />{c.label}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {error && <div role="alert" className="text-xs text-red-600">{error}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3">
        {guard.confirming ? <DiscardBar onDiscard={guard.discard} onKeep={guard.keepEditing} /> : (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={guard.attemptClose}>Cancel</Button>
            <Button variant="purple" size="sm" onClick={save} disabled={busy || !reading?.ok}>{editing.mode === "edit" ? "Save" : "Import"}</Button>
          </div>
        )}
      </div>
    </>
  );
}
