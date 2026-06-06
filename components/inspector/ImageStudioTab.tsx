"use client";

import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ComfyUIProvider } from "@/lib/providers/comfyui";
import { useState } from "react";
import {
  Zap,
  Plus,
  X,
  ListChecks,
  RefreshCw,
  ImageIcon,
  Layers,
} from "lucide-react";
import type { AspectRatio } from "@/lib/types";

const WORKFLOWS = [
  { value: "flux-cinematic", label: "Flux Dev - Cinematic" },
  { value: "sdxl-portrait", label: "SDXL Portrait" },
  { value: "anime-character-card", label: "Anime Character Card" },
  { value: "concept-art", label: "Concept Art" },
];

const SAMPLERS = ["euler", "euler_a", "dpmpp_2m", "dpmpp_2m_karras", "ddim", "lcm"];
const ASPECT_RATIOS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4", "2:1", "custom"];
const LORA_OPTIONS = ["Cyberpunk Style", "Anime Face", "Film Grain", "Neon Glow", "Concept Art"];

export function ImageStudioTab() {
  const { imageSettings, setImageSettings, imageJobs, addImageJob, providerSettings } = useFableStore();
  const [newLora, setNewLora] = useState("");
  const [isQueuing, setIsQueuing] = useState(false);

  const handleGenerate = async () => {
    setIsQueuing(true);
    const comfyui = new ComfyUIProvider(providerSettings.comfyui.baseUrl);
    // Try real connection, fall back to mock
    const connected = await comfyui.checkConnection();
    if (connected) {
      // TODO: load real workflow template and queue
      // const workflow = await comfyui.loadWorkflowTemplate(`/workflows/${imageSettings.workflow}.json`);
      // const promptId = await comfyui.queuePrompt(workflow, { "6.inputs.text": imageSettings.prompt });
    }
    const job = comfyui.createMockJob(imageSettings);
    addImageJob(job);
    setIsQueuing(false);
  };

  const handleAddLora = () => {
    if (!newLora) return;
    setImageSettings({ loras: [...imageSettings.loras, { name: newLora, weight: 0.8 }] });
    setNewLora("");
  };

  const handleRemoveLora = (name: string) => {
    setImageSettings({ loras: imageSettings.loras.filter((l) => l.name !== name) });
  };

  const recentJobs = imageJobs.slice(0, 4);

  return (
    <div className="overflow-y-auto h-full">
      <div className="p-3 space-y-4">
        {/* Provider & Workflow */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Provider</label>
          <Select value="comfyui" onChange={() => {}}>
            <option value="comfyui">ComfyUI Local</option>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">Workflow</label>
          <Select
            value={imageSettings.workflow}
            onChange={(e) => setImageSettings({ workflow: e.target.value })}
          >
            {WORKFLOWS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
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
            onChange={(e) => setImageSettings({ aspectRatio: e.target.value as AspectRatio })}
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
              onChange={(e) => setImageSettings({ width: Number(e.target.value) })}
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
              onChange={(e) => setImageSettings({ height: Number(e.target.value) })}
              className="h-8 text-xs"
              step={64}
              min={512}
              max={2048}
            />
          </div>
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

        {/* Refiner toggle */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">
            Refiner
          </label>
          <button
            onClick={() => setImageSettings({ refiner: !imageSettings.refiner })}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors cursor-pointer ${
              imageSettings.refiner ? "bg-[var(--purple)]" : "bg-[var(--border)]"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                imageSettings.refiner ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>

        {/* Character reference */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">
            Character Reference
          </label>
          <div className="border-2 border-dashed border-[var(--border)] rounded-lg p-4 text-center cursor-pointer hover:border-[var(--purple)] transition-colors">
            <ImageIcon className="h-5 w-5 text-[var(--muted-fg)] mx-auto mb-1" />
            <div className="text-[11px] text-[var(--muted-fg)]">Drop image or click to upload</div>
          </div>
        </div>

        {/* LoRA stack */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            LoRA Stack
          </label>
          <div className="flex gap-2">
            <Select
              value={newLora}
              onChange={(e) => setNewLora(e.target.value)}
              className="flex-1 h-8 text-xs"
            >
              <option value="">Select LoRA…</option>
              {LORA_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleAddLora}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {imageSettings.loras.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {imageSettings.loras.map((lora) => (
                <div
                  key={lora.name}
                  className="flex items-center gap-1 bg-[var(--purple-light)] text-[var(--purple-fg)] rounded-full pl-2 pr-1 py-0.5 text-[11px]"
                >
                  {lora.name}
                  <button
                    onClick={() => handleRemoveLora(lora.name)}
                    className="hover:text-red-500 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ControlNet */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">ControlNet</label>
          <Select
            value={imageSettings.controlNet ?? ""}
            onChange={(e) => setImageSettings({ controlNet: e.target.value || undefined })}
          >
            <option value="">None</option>
            <option value="depth">Depth Map</option>
            <option value="canny">Canny Edge</option>
            <option value="openpose">OpenPose</option>
            <option value="ip-adapter">IP-Adapter</option>
          </Select>
        </div>

        {/* Generate / Queue buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button
            variant="purple"
            size="md"
            className="w-full"
            onClick={handleGenerate}
            disabled={isQueuing || !imageSettings.prompt.trim()}
          >
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            {isQueuing ? "Queuing…" : "Generate"}
          </Button>
          <Button variant="outline" size="md" className="w-full" onClick={handleGenerate} disabled={isQueuing}>
            <ListChecks className="h-3.5 w-3.5 mr-1.5" />
            Queue
          </Button>
        </div>

        {/* Queue status */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
          <div className="text-xs font-semibold text-[var(--muted-fg)] mb-2 flex items-center gap-1.5">
            <ListChecks className="h-3 w-3" />
            Queue Status
          </div>
          <div className="text-xs text-[var(--muted-fg)]">
            {isQueuing ? (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full border-2 border-[var(--purple)] border-t-transparent animate-spin" />
                Sending to ComfyUI…
              </div>
            ) : (
              `${imageJobs.filter((j) => j.status === "queued" || j.status === "generating").length} jobs running`
            )}
          </div>
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
                  className="rounded-lg border border-[var(--border)] overflow-hidden aspect-square bg-gradient-to-br from-purple-50 to-indigo-100 flex flex-col items-center justify-center relative cursor-pointer hover:border-[var(--purple)] transition-colors"
                >
                  <div className="text-xl">🏙️</div>
                  <div className="absolute bottom-0 left-0 right-0 bg-white/80 px-1.5 py-1">
                    <div className="text-[10px] text-[var(--foreground)] truncate">{job.prompt.slice(0, 20)}</div>
                    <Badge variant={job.status === "complete" ? "green" : "yellow"} className="text-[9px]">
                      {job.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
