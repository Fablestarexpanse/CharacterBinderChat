"use client";

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { OllamaProvider } from "@/lib/providers/ollama";
import { LMStudioProvider } from "@/lib/providers/lmstudio";
import { OpenRouterProvider } from "@/lib/providers/openrouter";
import { ComfyUIProvider } from "@/lib/providers/comfyui";
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";

// ─── Per-provider test state ──────────────────────────────────────────────────

interface TestResult {
  ok:     boolean;
  label:  string;          // e.g. "Connected · 4 models"
  models: string[];        // model names / IDs
}

interface ProviderCardProps {
  id:          string;
  name:        string;
  description: string;
  children:    React.ReactNode;        // URL / key input
  onTest:      () => Promise<TestResult>;
  helpText?:   React.ReactNode;
}

function ProviderCard({ name, description, children, onTest, helpText }: ProviderCardProps) {
  const [testing, setTesting]       = useState(false);
  const [result,  setResult]        = useState<TestResult | null>(null);
  const [expanded, setExpanded]     = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await onTest();
      setResult(r);
      setExpanded(r.ok && r.models.length > 0);
    } catch (e) {
      setResult({ ok: false, label: String(e), models: [] });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-sm">{name}</div>
            <div className="text-xs text-[var(--muted-fg)]">{description}</div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {result && (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${result.ok ? "text-green-600" : "text-red-500"}`}>
                {result.ok
                  ? <CheckCircle className="h-3.5 w-3.5" />
                  : <XCircle    className="h-3.5 w-3.5" />
                }
                {result.label}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
              className="h-7 px-3 text-xs"
            >
              {testing
                ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Testing…</>
                : "Test"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardBody className="space-y-3">
        {children}
        {helpText}

        {/* Model list (expandable) */}
        {result?.ok && result.models.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[var(--foreground)] bg-[var(--muted)] hover:bg-[var(--border)] transition-colors"
            >
              <span>{result.models.length} model{result.models.length !== 1 ? "s" : ""} available</span>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {expanded && (
              <ul className="divide-y divide-[var(--border)]">
                {result.models.map((m) => (
                  <li key={m} className="px-3 py-1.5 text-xs text-[var(--foreground)] font-mono">
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {result && !result.ok && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {result.label}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Main Settings View ───────────────────────────────────────────────────────

export function SettingsView() {
  const { providerSettings, setProviderSetting } = useFableStore();

  // ── Ollama ──────────────────────────────────────────────────────────────────
  const testOllama = async (): Promise<TestResult> => {
    const p = new OllamaProvider(providerSettings.ollama.baseUrl);
    const ok = await p.checkConnection();
    if (!ok) return { ok: false, label: "Connection failed — is Ollama running?", models: [] };
    const models = await p.listModels();
    const names  = models.map((m) => m.name ?? m.id);
    return {
      ok:     true,
      label:  `Connected · ${names.length} model${names.length !== 1 ? "s" : ""}`,
      models: names,
    };
  };

  // ── LM Studio ───────────────────────────────────────────────────────────────
  const testLMStudio = async (): Promise<TestResult> => {
    const p = new LMStudioProvider(providerSettings.lmstudio.baseUrl);
    const ok = await p.checkConnection();
    if (!ok) return { ok: false, label: "Connection failed — is LM Studio's server running?", models: [] };
    const models = await p.listModels();
    const names  = models.map((m) => m.name ?? m.id);
    return {
      ok:     true,
      label:  names.length > 0 ? `Connected · ${names[0]}` : "Connected · no model loaded",
      models: names,
    };
  };

  // ── ComfyUI ─────────────────────────────────────────────────────────────────
  const testComfyUI = async (): Promise<TestResult> => {
    const p = new ComfyUIProvider(providerSettings.comfyui.baseUrl);
    const ok = await p.checkConnection();
    if (!ok) return { ok: false, label: "Connection failed — is ComfyUI running?", models: [] };
    return { ok: true, label: "Connected", models: [] };
  };

  // ── OpenRouter ──────────────────────────────────────────────────────────────
  const testOpenRouter = async (): Promise<TestResult> => {
    if (!providerSettings.openrouter.apiKey) {
      return { ok: false, label: "No API key entered", models: [] };
    }
    const p = new OpenRouterProvider(providerSettings.openrouter.apiKey);
    const ok = await p.checkConnection();
    if (!ok) return { ok: false, label: "API key invalid or network error", models: [] };
    const models = await p.listModels();
    const names  = models.map((m) => m.name ?? m.id);
    return {
      ok:     true,
      label:  `Connected · ${names.length}+ models`,
      models: names.slice(0, 20),   // cap display at 20
    };
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">Settings</h1>
          <p className="text-sm text-[var(--muted-fg)] mt-1">
            Configure your AI providers. Hit <strong>Test</strong> to verify a connection and see available models.
          </p>
        </div>

        {/* Ollama */}
        <ProviderCard
          id="ollama"
          name="Ollama"
          description="Local LLM runner — free, runs on your machine"
          onTest={testOllama}
          helpText={
            <p className="text-xs text-[var(--muted-fg)]">
              Install from{" "}
              <a href="https://ollama.ai" target="_blank" rel="noreferrer" className="text-[var(--purple-fg)] underline">
                ollama.ai
              </a>
              , then pull a model:{" "}
              <code className="bg-[var(--muted)] px-1 rounded">ollama pull llama3.2</code>
            </p>
          }
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--foreground)]">Base URL</label>
            <Input
              value={providerSettings.ollama.baseUrl}
              onChange={(e) => setProviderSetting("ollama", { baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:11434"
            />
          </div>
        </ProviderCard>

        {/* LM Studio */}
        <ProviderCard
          id="lmstudio"
          name="LM Studio"
          description="OpenAI-compatible local endpoint"
          onTest={testLMStudio}
          helpText={
            <p className="text-xs text-[var(--muted-fg)]">
              Open LM Studio → <strong>Local Server</strong> tab → Start Server, then load a model.
            </p>
          }
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--foreground)]">Base URL</label>
            <Input
              value={providerSettings.lmstudio.baseUrl}
              onChange={(e) => setProviderSetting("lmstudio", { baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:1234"
            />
          </div>
        </ProviderCard>

        {/* OpenRouter */}
        <ProviderCard
          id="openrouter"
          name="OpenRouter"
          description="Cloud models — Claude, GPT-4o, Gemini, Mistral and more"
          onTest={testOpenRouter}
          helpText={
            <p className="text-xs text-[var(--muted-fg)]">
              Get a free key at{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-[var(--purple-fg)] underline">
                openrouter.ai/keys
              </a>
            </p>
          }
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--foreground)]">API Key</label>
            <Input
              type="password"
              value={providerSettings.openrouter.apiKey}
              onChange={(e) => setProviderSetting("openrouter", { apiKey: e.target.value })}
              placeholder="sk-or-…"
            />
          </div>
        </ProviderCard>

        {/* ComfyUI */}
        <ProviderCard
          id="comfyui"
          name="ComfyUI"
          description="Local image generation"
          onTest={testComfyUI}
          helpText={
            <p className="text-xs text-[var(--muted-fg)]">
              Start ComfyUI with{" "}
              <code className="bg-[var(--muted)] px-1 rounded">--enable-cors-header</code>{" "}
              so FableChat can reach it from the browser.
            </p>
          }
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--foreground)]">Base URL</label>
            <Input
              value={providerSettings.comfyui.baseUrl}
              onChange={(e) => setProviderSetting("comfyui", { baseUrl: e.target.value })}
              placeholder="http://127.0.0.1:8188"
            />
          </div>
        </ProviderCard>

        {/* Data */}
        <Card>
          <CardHeader>
            <div className="font-semibold text-sm">Your Data</div>
            <div className="text-xs text-[var(--muted-fg)]">
              Chats, characters and the memory graph live in <code className="bg-[var(--muted)] px-1 rounded">data/fablestore.db</code>
            </div>
          </CardHeader>
          <CardBody>
            <a
              href="/api/state?download=1"
              download
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] text-[var(--foreground)] transition-colors"
            >
              Export chats &amp; characters (JSON)
            </a>
            <p className="text-xs text-[var(--muted-fg)] mt-2">
              Chats sync to the database automatically a moment after each change.
            </p>
          </CardBody>
        </Card>

        {/* About */}
        <Card>
          <CardBody>
            <div className="text-xs text-[var(--muted-fg)] space-y-1">
              <div className="font-semibold text-[var(--foreground)]">FableChat v0.1.0</div>
              <div>Local-first AI roleplay studio.</div>
              <div>Provider settings are stored in your browser&apos;s localStorage.</div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
