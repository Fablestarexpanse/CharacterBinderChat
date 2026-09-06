"use client";

// ─── Generation settings ──────────────────────────────────────────────────────
// Per-chat sampler overrides layered on top of the chat's preset. Opened from
// the chat header.

import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_GENERATION_PARAMS } from "@/lib/providers/params";

export function GenerationSettingsDialog({
  chatId,
  open,
  onOpenChange,
}: {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    chats, presets, defaultPresetId,
    setChatPreset, updateChatSettings, resetChatOverrides,
  } = useFableStore();
  const { setActiveSection } = useUiStore();

  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return null;

  const defaultPreset = presets.find((p) => p.id === defaultPresetId);

  // What a slider should show: this chat's override, else the preset's value,
  // else the shared default — so the dialog never displays a number that isn't
  // what would actually be sent.
  const activePreset = presets.find((p) => p.id === (chat.presetId ?? defaultPresetId));
  const effective = (key: keyof typeof DEFAULT_GENERATION_PARAMS): number =>
    chat.settings?.[key] ?? activePreset?.params?.[key] ?? DEFAULT_GENERATION_PARAMS[key];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <DialogTitle>Generation settings — {chat.name}</DialogTitle>
        </div>
        <div className="space-y-5 px-5 py-4">
          {/* Which preset backs this chat. Values below layer on top of it. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--foreground)]">Preset</label>
            <select
              value={chat.presetId ?? ""}
              onChange={(e) => setChatPreset(chat.id, e.target.value || undefined)}
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--purple)]"
            >
              <option value="">
                {defaultPreset ? `Default (${defaultPreset.name})` : "None — built-in defaults"}
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => { onOpenChange(false); setActiveSection("presets"); }}
              className="text-[11px] text-[var(--purple-fg)] hover:underline cursor-pointer"
            >
              Edit presets…
            </button>
          </div>

          <div className="border-t border-[var(--border)] pt-4 space-y-5">
            <p className="text-[11px] leading-snug text-[var(--muted-fg)]">
              These override the preset for this chat only.
            </p>
            <Slider
              label={`Temperature — ${effective("temperature") < 0.5 ? "focused" : effective("temperature") > 1.1 ? "wild" : "balanced"}`}
              value={effective("temperature")}
              onChange={(v) => updateChatSettings(chat.id, { temperature: v })}
              min={0} max={2} step={0.05}
            />
            <Slider
              label="Top P"
              value={effective("topP")}
              onChange={(v) => updateChatSettings(chat.id, { topP: v })}
              min={0.1} max={1} step={0.05}
            />
            <Slider
              label="Max response tokens"
              value={effective("maxTokens")}
              onChange={(v) => updateChatSettings(chat.id, { maxTokens: v })}
              min={256} max={8192} step={256}
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={!chat.settings || Object.keys(chat.settings).length === 0}
            title="Drop this chat's overrides so the preset shows through again"
            onClick={() => resetChatOverrides(chat.id)}
          >
            Clear overrides
          </Button>
          <Button variant="purple" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
