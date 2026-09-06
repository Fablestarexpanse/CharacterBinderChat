"use client";

// ─── Workflows ────────────────────────────────────────────────────────────────
// The real contents of workflows/, read from disk. The Image Studio picker was
// a hand-maintained array mirroring this directory, so a template you dropped
// in never appeared and a deleted one left a dead option behind.

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { GitBranch, Check, AlertTriangle, Loader2 } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { getJson } from "@/lib/api/client";
import type { WorkflowSummary } from "@/lib/api/dto";

export function WorkflowsView() {
  const { imageSettings, setImageSettings } = useFableStore();
  const { setActiveSection } = useUiStore();
  const [result, setResult] = useState<{ list: WorkflowSummary[]; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ workflows?: WorkflowSummary[] }>("/api/workflows")
      .then((d) => { if (!cancelled) setResult({ list: d.workflows ?? [], error: null }); })
      .catch((e: Error) => { if (!cancelled) setResult({ list: [], error: e.message }); });
    return () => { cancelled = true; };
  }, []);

  const loading = result === null;

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-[var(--foreground)]">Workflows</h1>
        <p className="text-sm text-[var(--muted-fg)] mt-1">
          ComfyUI API-format templates in <code className="bg-[var(--muted)] px-1 rounded text-xs">workflows/</code>
        </p>
        <p className="text-xs text-[var(--muted-fg)] mt-3 mb-6">
          FableChat drives a template through its <code className="bg-[var(--muted)] px-1 rounded">_meta.fablechat</code>{" "}
          mapping — each entry points at the node input that carries a setting. Anything unmapped keeps
          whatever the template ships with.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading workflows…
          </div>
        )}

        {result?.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
            {result.error}
          </div>
        )}

        {result && result.list.length === 0 && !result.error && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <GitBranch className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              No templates found — drop a ComfyUI API-format JSON into workflows/.
            </div>
          </div>
        )}

        <div className="space-y-4">
          {result?.list.map((wf) => {
            const isDefault = wf.slug === imageSettings.workflow;
            return (
              <Card key={wf.slug} className={isDefault ? "border-[var(--purple)]" : ""}>
                <CardBody className="space-y-2">
                  <div className="flex items-start gap-3">
                    <GitBranch className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isDefault ? "text-[var(--purple-fg)]" : "text-[var(--muted-fg)]"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--foreground)]">{wf.title}</span>
                        {isDefault && (
                          <Badge variant="purple">
                            <Check className="h-2.5 w-2.5 mr-0.5" />
                            active
                          </Badge>
                        )}
                        {wf.error && (
                          <Badge variant="red">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                            unreadable
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--muted-fg)] font-mono mt-0.5">{wf.slug}.json</div>
                      {wf.description && (
                        <p className="text-xs text-[var(--muted-fg)] mt-1.5 leading-relaxed">{wf.description}</p>
                      )}
                      {wf.error && (
                        <p className="text-xs text-red-600 mt-1.5">{wf.error}</p>
                      )}
                    </div>
                    {!wf.error && !isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-shrink-0"
                        onClick={() => setImageSettings({ workflow: wf.slug })}
                      >
                        Use this
                      </Button>
                    )}
                  </div>

                  {!wf.error && (
                    <div className="flex items-center gap-1.5 flex-wrap pl-7">
                      <Badge variant="default">{wf.nodeCount} nodes</Badge>
                      {wf.steps !== null && <Badge variant="default">{wf.steps} steps</Badge>}
                      {wf.cfg !== null && <Badge variant="default">CFG {wf.cfg}</Badge>}
                      {wf.controls.length > 0 ? (
                        wf.controls.map((c) => <Badge key={c} variant="green">{c}</Badge>)
                      ) : (
                        <Badge variant="yellow">no _meta.fablechat mapping</Badge>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {result && result.list.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-6"
            onClick={() => setActiveSection("image-studio")}
          >
            Open Image Studio
          </Button>
        )}
      </div>
    </div>
  );
}
