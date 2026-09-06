"use client";

import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { startImageJob, dimensionsForRatio, ComfyUIProvider } from "@/lib/providers/comfyui";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { useEffect, useState } from "react";
import {
  Zap,
  Plus,
  X,
  ListChecks,
  RefreshCw,
  Layers,
} from "lucide-react";
import type { AspectRatio } from "@/lib/types";

const SAMPLERS = ["euler", "euler_a", "dpmpp_2m", "dpmpp_2m_karras", "ddim", "lcm"];
const ASPECT_RATIOS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1", "custom"];

export function ImageStudioTab() {
  const { imageSettings, setImageSettings, imageJobs, addImageJob, updateImageJob, providerSettings, activeChatId } =
    useFableStore();
  const [newLora, setNewLora] = useState("");
  const [loraWeight, setLoraWeight] = useState("0.8");
  // In-app viewer — never navigate away to view an output
  const [viewer, setViewer] = useState<{ url: string; id: string } | null>(null);

  // Real LoRA filenames from the ComfyUI host. Keyed by base URL so a settings
  // change refetches; setState only inside the async continuation.
  const comfyBase = providerSettings.comfyui.baseUrl;
  const [loraCatalog, setLoraCatalog] = useState<{ key: string; names: string[] }>({ key: "", names: [] });
  useEffect(() => {
    let cancelled = false;
    new ComfyUIProvider(comfyBase).listLoras().then((names) => {
      if (!cancelled) setLoraCatalog({ key: comfyBase, names });
    });
    return () => { cancelled = true; };
  }, [comfyBase]);

  // Templates actually present in workflows/ — a hardcoded list here meant a
  // template you added never appeared and a deleted one stayed selectable.
  const [workflows, setWorkflows] = useState<Array<{ slug: string; title: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/workflows", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { workflows?: Array<{ slug: string; title: string; error?: string }> }) => {
        if (!cancelled) setWorkflows((d.workflows ?? []).filter((w) => !w.error));
      })
      // The picker falls back to the saved slug, so this stays non-fatal —
      // but a silent catch made a broken endpoint look like "no workflows".
      .catch((e: Error) => console.warn("[/api/workflows] list failed:", e.message));
    return () => { cancelled = true; };
  }, []);

  const handleGenerate = () => {
    // startImageJob returns immediately; connection check, queueing and
    // polling all happen in the background and land via updateImageJob.
    const job = startImageJob(
      providerSettings.comfyui.baseUrl,
      imageSettings,
      activeChatId ?? undefined,
      updateImageJob
    );
    addImageJob(job);
  };

  // Choosing a ratio resolves to real pixels; typing a dimension by hand flips
  // the selector to "custom" so it never claims a shape the render won't have.
  const handleRatioChange = (ratio: AspectRatio) => {
    const dims = dimensionsForRatio(ratio);
    setImageSettings(dims ? { aspectRatio: ratio, ...dims } : { aspectRatio: ratio });
  };

  const handleAddLora = () => {
    const name = newLora.trim();
    if (!name || imageSettings.loras.some((l) => l.name === name)) return;
    const weight = Number(loraWeight);
    setImageSettings({
      loras: [...imageSettings.loras, { name, weight: Number.isFinite(weight) ? weight : 0.8 }],
    });
    setNewLora("");
  };

  const handleRemoveLora = (name: string) => {
    setImageSettings({ loras: imageSettings.loras.filter((l) => l.name !== name) });
  };

  const workflowSupportsLoras = imageSettings.workflow === "krea2-lora-pipeline";

  const recentJobs = imageJobs.slice(0, 4);
  const runningCount = imageJobs.filter((j) => j.status === "queued" || j.status === "generating").length;
  // Only surface a failure if the most recent job is the one that failed
  const lastFailed = imageJobs[0]?.status === "failed" ? imageJobs[0] : undefined;

  return (
    <div className="overflow-y-auto h-full">
      <div className="p-3 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Workflow</label>
          <Select
            value={imageSettings.workflow}
            onChange={(e) => setImageSettings({ workflow: e.target.value })}
          >
            {/* Keep the saved slug selectable even if the file is missing, so
                the picker shows what will actually be sent */}
            {!workflows.some((w) => w.slug === imageSettings.workflow) && (
              <option value={imageSettings.workflow}>{imageSettings.workflow}</option>
            )}
            {workflows.map((w) => (
              <option key={w.slug} value={w.slug}>{w.title}</option>
            ))}
          </Select>
        </div>

        {/* Prompts */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Prompt</label>
          <Textarea
            value={imageSettings.prompt}
            onChange={(e) => setImageSettings({ prompt: e.target.value })}
            placeholder="cyberpunk alley at night, neon lights, rain…"
            rows={3}
            className="text-xs"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Negative Prompt</label>
          <Textarea
            value={imageSettings.negativePrompt}
            onChange={(e) => setImageSettings({ negativePrompt: e.target.value })}
            placeholder="blurry, deformed…"
            rows={2}
            className="text-xs"
          />
        </div>

        {/* Dimensions */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Aspect Ratio</label>
          <Select
            value={imageSettings.aspectRatio}
            onChange={(e) => handleRatioChange(e.target.value as AspectRatio)}
          >
            {ASPECT_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-[var(--muted-fg)]">Width</label>
            <Input
              type="number"
              value={imageSettings.width}
              onChange={(e) => setImageSettings({ width: Number(e.target.value), aspectRatio: "custom" })}
              className="h-8 text-xs"
              step={64}
              min={512}
              max={2048}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[var(--muted-fg)]">Height</label>
            <Input
              type="number"
              value={imageSettings.height}
              onChange={(e) => setImageSettings({ height: Number(e.target.value), aspectRatio: "custom" })}
              className="h-8 text-xs"
              step={64}
              min={512}
              max={2048}
            />
          </div>
        </div>
        <div className="text-[10px] text-[var(--muted-fg)] -mt-1">
          {((imageSettings.width * imageSettings.height) / 1_000_000).toFixed(1)} megapixels
        </div>

        {/* Sliders */}
        <Slider
          label="Steps"
          value={imageSettings.steps}
          onChange={(v) => setImageSettings({ steps: v })}
          min={1} max={60} step={1}
        />
        <Slider
          label="CFG Scale"
          value={imageSettings.cfg}
          onChange={(v) => setImageSettings({ cfg: v })}
          min={1} max={20} step={0.5}
        />

        {/* Sampler */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Sampler</label>
          <Select
            value={imageSettings.sampler}
            onChange={(e) => setImageSettings({ sampler: e.target.value })}
          >
            {SAMPLERS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>

        {/* Seed */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Seed</label>
          <div className="flex gap-2">
            <Input
              type="number"
              value={imageSettings.seed === -1 ? "" : imageSettings.seed}
              onChange={(e) => setImageSettings({ seed: e.target.value ? Number(e.target.value) : -1 })}
              placeholder="-1 (random)"
              className="h-8 text-xs flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setImageSettings({ seed: Math.floor(Math.random() * 999999999) })}
              title="Random seed"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Batch count */}
        <Slider
          label="Batch Count"
          value={imageSettings.batchCount}
          onChange={(v) => setImageSettings({ batchCount: v })}
          min={1} max={4} step={1}
        />

        {/* LoRA stack — injected as <lora:name:weight> into the workflow */}
        {workflowSupportsLoras && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="h-3 w-3" />
              LoRA Stack
            </label>
            <div className="flex gap-1.5">
              {loraCatalog.names.length > 0 ? (
                <Select
                  value={newLora}
                  onChange={(e) => setNewLora(e.target.value)}
                  className="flex-1 h-8 text-xs min-w-0"
                >
                  <option value="">Select LoRA…</option>
                  {loraCatalog.names.map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              ) : (
                <Input
                  value={newLora}
                  onChange={(e) => setNewLora(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddLora(); }}
                  placeholder="lora filename"
                  className="flex-1 h-8 text-xs min-w-0"
                />
              )}
              <Input
                type="number"
                value={loraWeight}
                onChange={(e) => setLoraWeight(e.target.value)}
                className="h-8 w-14 text-xs flex-shrink-0"
                step={0.05}
                min={0}
                max={2}
                title="Weight"
              />
              <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleAddLora}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            {loraCatalog.key === comfyBase && loraCatalog.names.length === 0 && (
              <p className="text-[10px] text-[var(--muted-fg)]">
                Couldn&apos;t read LoRAs from ComfyUI — type the filename exactly as it appears in models/loras.
              </p>
            )}
            {imageSettings.loras.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {imageSettings.loras.map((lora) => (
                  <div
                    key={lora.name}
                    className="flex items-center gap-1 bg-[var(--purple-light)] text-[var(--purple-fg)] rounded-full pl-2 pr-1 py-0.5 text-[11px] max-w-full"
                    title={`<lora:${lora.name}:${lora.weight}>`}
                  >
                    <span className="truncate">{lora.name}</span>
                    <span className="opacity-70 flex-shrink-0">{lora.weight}</span>
                    <button
                      onClick={() => handleRemoveLora(lora.name)}
                      className="hover:text-red-500 transition-colors flex-shrink-0 cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Generate */}
        <Button
          variant="purple"
          size="md"
          className="w-full"
          onClick={handleGenerate}
          disabled={!imageSettings.prompt.trim()}
        >
          <Zap className="h-3.5 w-3.5 mr-1.5" />
          Generate
        </Button>

        {/* Queue status */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
          <div className="text-xs font-semibold text-[var(--muted-fg)] mb-2 flex items-center gap-1.5">
            <ListChecks className="h-3 w-3" />
            Queue Status
          </div>
          <div className="text-xs text-[var(--muted-fg)]">
            {runningCount > 0 ? (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full border-2 border-[var(--purple)] border-t-transparent animate-spin" />
                {runningCount} job{runningCount === 1 ? "" : "s"} running
              </div>
            ) : (
              "Idle"
            )}
          </div>
          {lastFailed && runningCount === 0 && (
            <div className="mt-2 text-[11px] text-red-600 break-words">
              Last job failed: {lastFailed.error ?? "unknown error"}
            </div>
          )}
        </div>

        {/* Recent outputs */}
        {recentJobs.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">
              Recent Outputs
            </div>
            <div className="grid grid-cols-2 gap-2">
              {recentJobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-lg border border-[var(--border)] overflow-hidden aspect-square bg-[var(--muted)] flex flex-col items-center justify-center relative cursor-pointer hover:border-[var(--purple)] transition-colors"
                  title={job.status === "failed" ? job.error : job.prompt}
                >
                  {job.status === "complete" && job.outputUrls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- ComfyUI serves from localhost; next/image can't optimize it
                    <img
                      src={job.outputUrls[0]}
                      alt={job.prompt.slice(0, 60)}
                      className="w-full h-full object-cover"
                      onClick={() => setViewer({ url: job.outputUrls[0], id: job.id })}
                    />
                  ) : job.status === "failed" ? (
                    <X className="h-5 w-5 text-red-500" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-[var(--purple)] border-t-transparent animate-spin" />
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-white/80 px-1.5 py-1">
                    <div className="text-[10px] text-[var(--foreground)] truncate">{job.prompt.slice(0, 20)}</div>
                    <Badge
                      variant={job.status === "complete" ? "green" : job.status === "failed" ? "red" : "yellow"}
                      className="text-[9px]"
                    >
                      {job.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ImageLightbox
        url={viewer?.url ?? null}
        filename={`fablechat-${(viewer?.id ?? "image").slice(0, 8)}.png`}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}
