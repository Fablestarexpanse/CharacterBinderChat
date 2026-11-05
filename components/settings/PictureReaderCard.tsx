"use client";

// ─── Settings → Chat models: the picture reader ───────────────────────────────
// The model that looks at pictures you send in chats and writes what they show,
// so any chat model (even one that cannot see) understands them. It must be a
// model that takes images: in LM Studio one with a vision projector (mmproj),
// in Ollama a vision model such as qwen2.5vl or gemma3, or an OpenRouter
// model that accepts images. Test reads a small built-in picture.

import { useState } from "react";
import { Eye } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFableStore } from "@/lib/store";
import { sendJson } from "@/lib/api/client";
import { pictureReader } from "@/lib/chat/userPictures";
import type { ProviderType } from "@/lib/llm/callers";

const PROVIDERS: Array<{ id: ProviderType; label: string; hint: string }> = [
  { id: "lmstudio", label: "LM Studio", hint: "the model id as LM Studio lists it, for a model with a vision projector (mmproj)" },
  { id: "ollama", label: "Ollama", hint: "a vision model, for example qwen2.5vl:7b or gemma3:12b" },
  { id: "openrouter", label: "OpenRouter", hint: "a model that accepts images, for example google/gemini-2.5-flash" },
];

export function PictureReaderCard() {
  const { providerSettings, setProviderSetting } = useFableStore();
  const vision = providerSettings.vision;
  const provider = vision?.provider ?? "lmstudio";
  const [result, setResult] = useState<{ ok: boolean; text: string } | "running" | null>(null);

  const set = (patch: Partial<{ provider: ProviderType; model: string }>) =>
    setProviderSetting("vision", { provider, model: vision?.model ?? "", ...patch });

  const test = async () => {
    const reader = pictureReader();
    if (!reader) { setResult({ ok: false, text: "Choose a model first." }); return; }
    setResult("running");
    try {
      const r = await sendJson<{ description?: string; error?: string }>("POST", "/api/vision/describe", { test: true, ...reader });
      setResult(r.description ? { ok: true, text: `It read the test picture as: "${r.description}"` } : { ok: false, text: r.error ?? "No description came back." });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5 font-semibold text-sm"><Eye className="h-4 w-4" />Picture reader</div>
        <div className="text-xs text-[var(--muted-fg)]">
          Reads the pictures you send in chats and tells the character what they show, so any chat model understands them.
          It needs a model that can see images. Without one, a picture still sends and you can describe it yourself.
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="text-xs"><span className="font-medium">Runs on</span>
            <select value={provider} onChange={(e) => set({ provider: e.target.value as ProviderType })} aria-label="Picture reader runs on"
              className="mt-1 h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs">
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-xs"><span className="font-medium">Model</span>
            <Input className="mt-1 h-8 text-xs" value={vision?.model ?? ""} onChange={(e) => set({ model: e.target.value })} aria-label="Picture reader model"
              placeholder={provider === "ollama" ? "qwen2.5vl:7b" : provider === "openrouter" ? "google/gemini-2.5-flash" : "qwen3-vl-30b-a3b-thinking"} />
          </label>
        </div>
        <div className="text-[11px] text-[var(--muted-fg)]">Use {PROVIDERS.find((p) => p.id === provider)?.hint}. The address is the one set for {PROVIDERS.find((p) => p.id === provider)?.label} above.</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void test()} disabled={result === "running"}>{result === "running" ? "Reading…" : "Test"}</Button>
          {vision?.model && <Button variant="ghost" size="sm" onClick={() => { setProviderSetting("vision", { provider, model: "" }); setResult(null); }}>Turn off</Button>}
        </div>
        {result && result !== "running" && (
          <div role={result.ok ? "status" : "alert"} className={`text-xs ${result.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{result.text}</div>
        )}
      </CardBody>
    </Card>
  );
}
