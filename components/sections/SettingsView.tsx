"use client";

import { addDemoStory } from "@/lib/demo";
import { useRef, useState } from "react";
import { useFableStore, DEFAULT_UTILITY_MODEL } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { OllamaProvider } from "@/lib/providers/ollama";
import { LMStudioProvider } from "@/lib/providers/lmstudio";
import { OpenRouterProvider } from "@/lib/providers/openrouter";
import { ComfyUIProvider } from "@/lib/providers/comfyui";
import { useThemeStore } from "@/lib/store/theme";
import { useMemorySettings } from "@/lib/store/memorySettings";
import { ACCENT_PRESETS, accentHex, normalizeHex, type ThemeMode } from "@/lib/theme";
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { PromptsCard } from "@/components/settings/PromptsCard";
import { MediaConnectionsCard } from "@/components/settings/MediaConnectionsCard";
import { MediaFolderCard } from "@/components/settings/MediaFolderCard";
import { PictureReaderCard } from "@/components/settings/PictureReaderCard";
import { VoiceSetupCard } from "@/components/settings/VoiceSetupCard";
import { NarratorCard } from "@/components/settings/NarratorCard";
import { BackgroundModelCard } from "@/components/settings/BackgroundModelCard";
import { OpenRouterDefaultModel } from "@/components/settings/OpenRouterDefaultModel";
import { ContactCard } from "@/components/settings/ContactCard";
import { useUiStore, SETTINGS_TABS, type SettingsTab } from "@/lib/store/ui";

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

// ─── Appearance ───────────────────────────────────────────────────────────────

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light",  label: "Light" },
  { id: "dark",   label: "Dark" },
  { id: "system", label: "Match system" },
];

function AppearanceCard() {
  const theme = useThemeStore();
  const current = accentHex(theme);
  // The text box holds a half-typed value; only a valid hex is committed.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? current;
  const draftInvalid = draft !== null && normalizeHex(draft) === null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-sm">Appearance</div>
            <div className="text-xs text-[var(--muted-fg)]">Recolor the app. Saved in this browser only.</div>
          </div>
          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => { theme.reset(); setDraft(null); }}>
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--foreground)]">Mode</label>
          <div role="radiogroup" aria-label="Color mode" className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={theme.mode === m.id}
                onClick={() => theme.setMode(m.id)}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  theme.mode === m.id
                    ? "bg-[var(--purple)] text-white"
                    : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--foreground)]">Accent color</label>
          <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((p) => {
              const selected = theme.accentId === p.id;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={selected}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => { theme.setAccent(p.id); setDraft(null); }}
                  style={{ backgroundColor: p.hex }}
                  className={`h-7 w-7 rounded-full cursor-pointer transition-shadow ${
                    selected ? "ring-2 ring-offset-2 ring-[var(--foreground)] ring-offset-[var(--card)]" : "hover:ring-2 hover:ring-[var(--border)]"
                  }`}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-[var(--foreground)]">Custom color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick a custom accent color"
              value={theme.accentId === "custom" ? theme.customAccent : current}
              onChange={(e) => { theme.setCustomAccent(e.target.value); setDraft(null); }}
              className="h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0.5"
            />
            <Input
              value={shown}
              onChange={(e) => {
                setDraft(e.target.value);
                if (normalizeHex(e.target.value)) theme.setCustomAccent(e.target.value);
              }}
              onBlur={() => setDraft(null)}
              placeholder="#7c5cbf"
              aria-invalid={draftInvalid}
              className={`w-32 font-mono ${draftInvalid ? "border-red-300" : ""}`}
            />
            {draftInvalid && <span className="text-xs text-red-500">Use a hex like #7c5cbf</span>}
          </div>
          <p className="text-[11px] text-[var(--muted-fg)]">
            Colors too light for white text are darkened automatically so buttons stay readable.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Memory ───────────────────────────────────────────────────────────────────

function MemoryCard() {
  const gate = useMemorySettings((s) => s.extractionGate);
  const setGate = useMemorySettings((s) => s.setExtractionGate);
  return (
    <Card>
      <CardHeader>
        <div className="font-semibold text-sm">Memory</div>
        <div className="text-xs text-[var(--muted-fg)]">How often the model is asked to update memory. Saved in this browser only.</div>
      </CardHeader>
      <CardBody>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={gate === "trivial"}
            onChange={(e) => setGate(e.target.checked ? "trivial" : "off")}
            className="mt-0.5 h-4 w-4 accent-[var(--purple)] cursor-pointer"
          />
          <span>
            <span className="block text-xs font-medium text-[var(--foreground)]">Skip empty exchanges</span>
            <span className="block text-[11px] text-[var(--muted-fg)] mt-0.5">
              Don&apos;t spend model calls on exchanges like &quot;ok&quot; / &quot;*nods*&quot;. Skipped turns are
              picked up by the next extraction, and at most three are skipped in a row. Most useful for
              short, fast chat; roleplay with long turns will rarely trigger it. Off by default.
            </span>
          </span>
        </label>
      </CardBody>
    </Card>
  );
}

// ─── Backup & restore ─────────────────────────────────────────────────────────

interface StagedBackup {
  token: string;
  name: string;
  summary: { characters: number; chats: number; messages: number; facts: number; madeAt: number | null; bytes: number };
}

function BackupCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedBackup | null>(null);
  const [busy, setBusy] = useState<"checking" | "restoring" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1: send the file for inspection. Nothing is replaced yet.
  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";                       // allow choosing the same file again
    if (!file) return;
    setError(null); setStaged(null); setBusy("checking");
    try {
      const res = await fetch("/api/backup/restore?stage=1", { method: "POST", body: file });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setStaged({ token: body.token, name: file.name, summary: body.summary });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Step 2: the person has seen what is in it and said yes.
  const confirm = async () => {
    if (!staged) return;
    setError(null); setBusy("restoring");
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Confirm-Restore": "replace-everything" },
        body: JSON.stringify({ token: staged.token }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      window.location.reload();                // everything on screen is now stale
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const s = staged?.summary;
  return (
    <Card>
      <CardHeader>
        <div className="font-semibold text-sm">Backup &amp; restore</div>
        <div className="text-xs text-[var(--muted-fg)]">
          One file with everything: characters, chats <em>and</em> everything the characters remember.
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/backup"
            download
            className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] text-[var(--foreground)] transition-colors"
          >
            Download full backup
          </a>
          <Button variant="outline" size="sm" className="h-7 px-3 text-xs" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {busy === "checking" ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Checking…</> : "Restore from a backup…"}
          </Button>
          <input ref={fileRef} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream" className="hidden" onChange={choose} />
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

        {staged && s && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800 space-y-2">
            <div className="font-semibold">Restore from {staged.name}?</div>
            <div>
              It holds {s.characters} character{s.characters === 1 ? "" : "s"}, {s.chats} chat{s.chats === 1 ? "" : "s"} ({s.messages.toLocaleString()} messages)
              and {s.facts.toLocaleString()} remembered facts
              {s.madeAt ? <>, made {new Date(s.madeAt * 1000).toLocaleString()}</> : null}.
            </div>
            <div>
              <strong>This replaces everything currently in FableChat.</strong> What you have now is kept as a safety copy
              next to the database file, so you can undo this by hand. Your API keys are not touched.
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-7 px-3 text-xs bg-red-600 hover:bg-red-700 text-white" disabled={busy !== null} onClick={confirm}>
                {busy === "restoring" ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Restoring…</> : "Replace everything"}
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-3 text-xs" disabled={busy !== null} onClick={() => setStaged(null)}>Cancel</Button>
            </div>
          </div>
        )}

        <p className="text-[11px] text-[var(--muted-fg)]">
          API keys are never included in a backup. After restoring on a different computer, enter them again.
        </p>
      </CardBody>
    </Card>
  );
}

// ─── Main Settings View ───────────────────────────────────────────────────────

/**
 * The tab row. Every panel stays mounted (only hidden), so a half-filled form
 * survives a look at another tab. Arrow keys move between tabs, as tabs should.
 */
function SettingsTabs({ tab, onTab }: { tab: SettingsTab; onTab: (t: SettingsTab) => void }) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = SETTINGS_TABS[(i + d + SETTINGS_TABS.length) % SETTINGS_TABS.length].id;
    onTab(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Settings sections" className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--background)] p-1">
      {SETTINGS_TABS.map((t, i) => (
        <button key={t.id} id={`settings-tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`settings-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1} onClick={() => onTab(t.id)} onKeyDown={(e) => move(e, i)}
          className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors cursor-pointer ${tab === t.id
            ? "bg-[var(--purple)] text-white"
            : "text-[var(--muted-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Panel({ id, tab, children }: { id: SettingsTab; tab: SettingsTab; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} hidden={tab !== id} className="space-y-6">
      {children}
    </div>
  );
}

/** Adds the demo story back: only what is missing, never changing what you have (lib/demo.ts) */
function DemoStoryRow() {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
      <Button variant="outline" size="sm" onClick={() => setSaid(addDemoStory() ? "Added what was missing from the demo story." : "The demo story is already all here.")}>
        Add the demo story
      </Button>
      <span className="text-xs text-[var(--muted-fg)]">{said ?? "Port Ellery: June, Elias, a group chat, a lorebook and more. Adds only what is missing."}</span>
    </div>
  );
}

export function SettingsView() {
  const { providerSettings, setProviderSetting } = useFableStore();
  const { settingsTab: tab, setSettingsTab } = useUiStore();

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
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--card)]">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">Settings</h1>
          <p className="text-sm text-[var(--muted-fg)] mt-1">
            Pick a section below. <strong>Test</strong> on any connection makes a real request so you know it works.
          </p>
        </div>

        <div className="sticky top-0 z-10 -mx-1 bg-[var(--card)] px-1 py-2">
          <SettingsTabs tab={tab} onTab={setSettingsTab} />
        </div>

        <Panel id="appearance" tab={tab}><AppearanceCard /></Panel>

        <Panel id="memory" tab={tab}><BackgroundModelCard /><MemoryCard /></Panel>

        <Panel id="contact" tab={tab}><ContactCard /></Panel>

        <Panel id="prompts" tab={tab}><PromptsCard /></Panel>

        <Panel id="models" tab={tab}>
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
          <div className="space-y-1.5 mt-3">
            <label className="text-xs font-medium text-[var(--foreground)]">Utility model</label>
            <Input
              value={providerSettings.ollama.utilityModel ?? DEFAULT_UTILITY_MODEL}
              onChange={(e) => setProviderSetting("ollama", { utilityModel: e.target.value })}
              placeholder={DEFAULT_UTILITY_MODEL}
            />
            <p className="text-[11px] text-[var(--muted-fg)]">
              Local model for background tasks that must stay uncensored regardless of the
              chat&apos;s model — currently the <code className="bg-[var(--muted)] px-1 rounded">/image</code> scene
              director, which turns the current scene into an image prompt.
            </p>
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
          <OpenRouterDefaultModel />
        </ProviderCard>

        <PictureReaderCard />
        </Panel>

        <Panel id="media" tab={tab}>
        <MediaConnectionsCard />

        <VoiceSetupCard />

        <NarratorCard />

        <MediaFolderCard />

        {/* ComfyUI */}
        <ProviderCard
          id="comfyui"
          name="ComfyUI"
          description="Local image generation"
          onTest={testComfyUI}
          helpText={
            <p className="text-xs text-[var(--muted-fg)]">
              Point this at your running ComfyUI instance — no special launch
              flags needed, FableChat proxies the connection server-side.
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
        </Panel>

        <Panel id="data" tab={tab}>
        <BackupCard />

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
              Chats sync to the database automatically a moment after each change. This JSON export holds
              characters, chats, lorebooks, personas, scenarios and presets, <strong>but not what the characters
              remember</strong>. For a complete copy, use Backup &amp; restore above.
            </p>
            <DemoStoryRow />
          </CardBody>
        </Card>

        {/* About */}
        <Card>
          <CardBody>
            <div className="text-xs text-[var(--muted-fg)] space-y-1">
              <div className="font-semibold text-[var(--foreground)]">FableChat v0.1.0</div>
              <div>Local-first AI roleplay studio.</div>
              <div>Chat model settings are kept in this browser; API keys are encrypted and kept by the server (<code>data/.fable-secret</code>).</div>
            </div>
          </CardBody>
        </Card>
        </Panel>
      </div>
    </div>
  );
}
