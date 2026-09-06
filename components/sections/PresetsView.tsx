"use client";

// ─── Presets ──────────────────────────────────────────────────────────────────
// Named bundles of sampler parameters and standing prompts. One is the default
// applied to every chat that hasn't picked its own; a chat can still override
// individual parameters from the header's gear dialog.
//
// Two honesty rules shape this screen:
//   1. A parameter you haven't touched shows its default with a muted tag and
//      writes NOTHING to the preset. Only the core three (temperature, max
//      tokens, top P) are always sent; the rest go out only once set. Without
//      the tag that rule would be invisible.
//   2. Controls a model won't honour aren't rendered at all, with one line
//      explaining the absence — an empty space reads as a bug.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_GENERATION_PARAMS, paramSupport } from "@/lib/providers/params";
import { MAX_FORBIDDEN_WORDS } from "@/lib/utils";
import type { GenerationParams, ParamKey, Preset } from "@/lib/types";
import { Sliders, Plus, Trash2, Copy, Star, X, Globe, RotateCcw } from "lucide-react";

// ─── One parameter row ────────────────────────────────────────────────────────

function ParamRow({
  label, hint, paramKey, params, onChange, onClear, min, max, step,
}: {
  label: string;
  hint?: string;
  paramKey: ParamKey;
  params: Partial<GenerationParams>;
  onChange: (v: number) => void;
  onClear: () => void;
  min: number;
  max: number;
  step: number;
}) {
  const isSet = params[paramKey] !== undefined;
  const value = params[paramKey] ?? DEFAULT_GENERATION_PARAMS[paramKey];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--foreground)]">{label}</span>
        {isSet ? (
          <button
            onClick={onClear}
            title="Back to default (stops sending this parameter)"
            className="text-[10px] text-[var(--muted-fg)] hover:text-red-500 transition-colors cursor-pointer flex items-center gap-0.5"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            reset
          </button>
        ) : (
          <span
            className="text-[10px] text-[var(--muted-fg)] px-1.5 rounded-full border border-[var(--border)]"
            title="Not set — the model's own default applies and nothing is sent"
          >
            default
          </span>
        )}
        <span className="ml-auto text-xs font-mono text-[var(--foreground)]">{value}</span>
      </div>
      <Slider
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        showValue={false}
      />
      {hint && <p className="text-[10px] text-[var(--muted-fg)] leading-snug">{hint}</p>}
    </div>
  );
}

// ─── Forbidden words chips ────────────────────────────────────────────────────

function ForbiddenWords({
  words, onChange,
}: {
  words: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const full = words.length >= MAX_FORBIDDEN_WORDS;

  const commit = () => {
    const word = draft.trim().replace(/,$/, "");
    if (!word || full) return;
    if (words.some((w) => w.toLowerCase() === word.toLowerCase())) { setDraft(""); return; }
    onChange([...words, word]);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--foreground)]">Forbidden words</span>
        <span className="text-[10px] text-[var(--muted-fg)]">{words.length}/{MAX_FORBIDDEN_WORDS}</span>
      </div>
      {words.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {words.map((w) => (
            <span
              key={w}
              className="flex items-center gap-1 rounded-full bg-[var(--muted)] pl-2 pr-1 py-0.5 text-[11px] text-[var(--foreground)]"
            >
              {w}
              <button
                onClick={() => onChange(words.filter((x) => x !== w))}
                className="hover:text-red-500 transition-colors cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
        }}
        onBlur={commit}
        disabled={full}
        placeholder={full ? `Limit reached (${MAX_FORBIDDEN_WORDS})` : "Type a word and press Enter"}
        className="h-8 text-xs"
      />
      <p className="text-[10px] text-[var(--muted-fg)] leading-snug">
        Asked, not enforced — these are added as an instruction to the model, which may still
        use them. No provider here exposes a real word ban list.
      </p>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function SettingsSection({
  title, action, children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
        {action}
      </CardHeader>
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function PresetsView() {
  const {
    presets, defaultPresetId, globalInstructions, availableModels,
    chats, activeChatId,
    addPreset, updatePreset, deletePreset, duplicatePreset,
    setDefaultPreset, setGlobalInstructions,
  } = useFableStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const selected: Preset | undefined =
    presets.find((p) => p.id === selectedId) ?? presets[0];

  // Capabilities are judged against the model this preset would actually run
  // on — the active chat's, falling back to whatever the providers reported.
  const chat = chats.find((c) => c.id === activeChatId);
  const providerId = chat?.providerId ?? "ollama";
  const model = availableModels.find((m) => m.id === chat?.modelId);

  const setParam = (key: ParamKey, value: number | undefined) => {
    if (!selected) return;
    const params = { ...selected.params };
    if (value === undefined) delete params[key];
    else params[key] = value;
    updatePreset(selected.id, { params });
  };

  const advanced: Array<{ key: ParamKey; label: string; min: number; max: number; step: number; hint?: string }> = [
    { key: "topK", label: "Top K", min: 0, max: 200, step: 1, hint: "Sample only from the K most likely tokens. 0 disables it." },
    { key: "topP", label: "Top P", min: 0.1, max: 1, step: 0.01 },
    { key: "repetitionPenalty", label: "Repetition penalty", min: 0.8, max: 2, step: 0.05, hint: "Above 1 discourages repeating text already written." },
    { key: "frequencyPenalty", label: "Frequency penalty", min: -2, max: 2, step: 0.1 },
    { key: "presencePenalty", label: "Presence penalty", min: -2, max: 2, step: 0.1 },
  ];
  const shown = advanced.filter((a) => paramSupport(providerId, a.key, model) !== "unsupported");
  const hidden = advanced.filter((a) => paramSupport(providerId, a.key, model) === "unsupported");

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Presets</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              Model settings and standing prompts, saved together and reusable across chats.
            </p>
          </div>
          <Button variant="purple" size="md" onClick={() => setSelectedId(addPreset())}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Preset
          </Button>
        </div>

        {/* ── Global instructions — deliberately outside the preset list ───── */}
        <Card className="mb-6 border-[var(--purple)]">
          <CardHeader className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[var(--purple-fg)]" />
            <span className="text-sm font-semibold text-[var(--foreground)]">Global prompt</span>
            <Badge variant="purple">applies to every chat</Badge>
          </CardHeader>
          <CardBody>
            <Textarea
              value={globalInstructions.globalPrompt ?? ""}
              onChange={(e) => setGlobalInstructions({ globalPrompt: e.target.value })}
              rows={3}
              placeholder="Standing instructions sent with every message, whichever preset is active…"
              className="text-xs"
            />
            <p className="text-[10px] text-[var(--muted-fg)] mt-1.5 leading-snug">
              Injected just below the character&apos;s identity line, above the preset prompt. It sits
              below identity on purpose: a global instruction placed above it would outrank every
              character at once.
            </p>
          </CardBody>
        </Card>

        {presets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <Sliders className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              No presets yet — create one to save a set of model settings and prompts.
            </div>
          </div>
        ) : (
          <div className="flex gap-6 items-start">
            {/* Preset rail */}
            <div className="w-52 flex-shrink-0 space-y-1">
              {presets.map((p) => {
                const isSel = p.id === selected?.id;
                return (
                  <div
                    key={p.id}
                    className={`group rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                      isSel ? "border-[var(--purple)] bg-[var(--purple-light)]" : "border-[var(--border)] hover:bg-[var(--muted)]"
                    }`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`flex-1 min-w-0 truncate text-xs font-medium ${isSel ? "text-[var(--purple-fg)]" : "text-[var(--foreground)]"}`}>
                        {p.name}
                      </span>
                      {p.id === defaultPresetId && <Badge variant="green">default</Badge>}
                    </div>
                    <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDefaultPreset(p.id); }}
                        title="Use for chats that haven't picked a preset"
                        className="rounded p-1 text-[var(--muted-fg)] hover:text-[var(--purple-fg)] cursor-pointer"
                      >
                        <Star className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); const id = duplicatePreset(p.id); if (id) setSelectedId(id); }}
                        title="Duplicate"
                        className="rounded p-1 text-[var(--muted-fg)] hover:text-[var(--foreground)] cursor-pointer"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirmDelete === p.id) { deletePreset(p.id); setConfirmDelete(null); setSelectedId(null); }
                          else { setConfirmDelete(p.id); setTimeout(() => setConfirmDelete((v) => (v === p.id ? null : v)), 3000); }
                        }}
                        title={confirmDelete === p.id ? "Click again to delete" : "Delete preset"}
                        className={`rounded p-1 cursor-pointer ${confirmDelete === p.id ? "text-red-500 bg-red-50" : "text-[var(--muted-fg)] hover:text-red-500"}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Editor */}
            {selected && (
              <div className="flex-1 min-w-0 space-y-4">
                <Input
                  value={selected.name}
                  onChange={(e) => updatePreset(selected.id, { name: e.target.value })}
                  className="font-medium"
                  placeholder="Preset name"
                />

                <SettingsSection title="Instructions">
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-[var(--foreground)]">Custom prompt</span>
                    <Textarea
                      value={selected.customPrompt ?? ""}
                      onChange={(e) => updatePreset(selected.id, { customPrompt: e.target.value })}
                      rows={4}
                      placeholder="Instructions sent only while this preset is active…"
                      className="text-xs"
                    />
                    <p className="text-[10px] text-[var(--muted-fg)] leading-snug">
                      Sent only while this preset is active, at the top of every request — right
                      below the global prompt.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs font-medium text-[var(--foreground)]">Prefill</span>
                    <Textarea
                      value={selected.prefill ?? ""}
                      onChange={(e) => updatePreset(selected.id, { prefill: e.target.value })}
                      rows={2}
                      placeholder="*She hesitates, then*"
                      className="text-xs"
                    />
                    <p className="text-[10px] text-[var(--muted-fg)] leading-snug">
                      The reply is forced to begin with this text, and the model continues from it.
                      Trailing spaces are trimmed.
                    </p>
                  </div>

                  <ForbiddenWords
                    words={selected.forbiddenWords ?? []}
                    onChange={(next) => updatePreset(selected.id, { forbiddenWords: next })}
                  />
                </SettingsSection>

                <SettingsSection
                  title="Generation settings"
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        const params = { ...selected.params };
                        delete params.temperature; delete params.maxTokens; delete params.contextSize;
                        updatePreset(selected.id, { params });
                      }}
                    >
                      Reset to Defaults
                    </Button>
                  }
                >
                  <ParamRow
                    label="Temperature" paramKey="temperature" params={selected.params}
                    onChange={(v) => setParam("temperature", v)} onClear={() => setParam("temperature", undefined)}
                    min={0} max={2} step={0.05}
                    hint="Lower is more focused; higher is more surprising."
                  />
                  <ParamRow
                    label="Max tokens" paramKey="maxTokens" params={selected.params}
                    onChange={(v) => setParam("maxTokens", v)} onClear={() => setParam("maxTokens", undefined)}
                    min={256} max={8192} step={256}
                    hint="How long a single reply may run."
                  />
                  <ParamRow
                    label="Context size" paramKey="contextSize" params={selected.params}
                    onChange={(v) => setParam("contextSize", v)} onClear={() => setParam("contextSize", undefined)}
                    min={2048} max={131072} step={2048}
                    hint={
                      providerId === "ollama"
                        ? "How much conversation is kept in the prompt. On Ollama this also sets num_ctx, which reallocates the KV cache — too high can exhaust VRAM."
                        : "How much conversation is kept in the prompt. Trims old messages to fit; the model's own window is fixed and set by the provider."
                    }
                  />
                </SettingsSection>

                <SettingsSection title="Advanced settings">
                  {shown.map((a) => (
                    <ParamRow
                      key={a.key}
                      label={a.label} hint={a.hint} paramKey={a.key} params={selected.params}
                      onChange={(v) => setParam(a.key, v)} onClear={() => setParam(a.key, undefined)}
                      min={a.min} max={a.max} step={a.step}
                    />
                  ))}
                  {hidden.length > 0 && (
                    <p className="text-[10px] text-[var(--muted-fg)] leading-snug border-t border-[var(--border)] pt-3">
                      {hidden.map((h) => h.label).join(", ")}{" "}
                      {hidden.length === 1 ? "is" : "are"} hidden —{" "}
                      <span className="font-mono">{chat?.modelId ?? providerId}</span>{" "}
                      {model ? "doesn't support" : "isn't known to support"} them.
                    </p>
                  )}
                </SettingsSection>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
