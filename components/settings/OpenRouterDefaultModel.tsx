"use client";

// ─── Settings → Chat models → OpenRouter: the default model ───────────────────
// The OpenRouter model new chats start on. Shown once OpenRouter is connected
// (the list is its own catalogue); a chat can still switch model in its header.
// Chats you already have keep theirs, so when some use another model there is a
// button to switch them over too, which says how many it will change.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { useModelCatalog } from "@/lib/hooks/useModelCatalog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OpenRouterDefaultModel() {
  const current = useFableStore((s) => s.providerSettings.openrouter.defaultModel ?? "");
  const setProviderSetting = useFableStore((s) => s.setProviderSetting);
  const connected = useFableStore((s) => s.providerStatuses.find((p) => p.id === "openrouter")?.connected ?? false);
  const chats = useFableStore((s) => s.chats);
  const setChatModel = useFableStore((s) => s.setChatModel);
  const [switched, setSwitched] = useState<number | null>(null);
  const { models } = useModelCatalog();
  const openrouter = models.filter((m) => m.providerId === "openrouter").sort((a, b) => a.name.localeCompare(b.name));
  if (!connected) {
    return <p className="text-[11px] text-[var(--muted-fg)]">Once your key connects, you can choose the model new chats start on here.</p>;
  }
  const known = openrouter.find((m) => m.id === current);
  // Chats on some other model (a chat on a local provider is left alone: that was a choice of provider, not of model)
  const others = known ? chats.filter((c) => (c.providerId ?? "openrouter") === "openrouter" && c.modelId !== current) : [];
  return (
    <div className="space-y-1.5">
      <label htmlFor="openrouter-default-model" className="text-xs font-medium text-[var(--foreground)]">Default model for new chats</label>
      <div className="flex gap-2">
        <Input id="openrouter-default-model" list="openrouter-models" value={current} placeholder="Type to search, e.g. claude or deepseek"
          onChange={(e) => { setSwitched(null); setProviderSetting("openrouter", { defaultModel: e.target.value }); }} />
        {current && <Button variant="outline" size="sm" onClick={() => setProviderSetting("openrouter", { defaultModel: "" })}>Clear</Button>}
      </div>
      <datalist id="openrouter-models">
        {openrouter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </datalist>
      <p className="text-[11px] text-[var(--muted-fg)]">
        {current
          ? known ? `New chats start on ${known.name}. Each chat can still switch in its header.` : "Not in OpenRouter's list (yet): check the spelling, or pick from the list."
          : "None chosen: a new chat starts on the first model listed."}
      </p>
      {known && others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-fg)]">
          <span>
            {others.length} chat{others.length === 1 ? " you already have uses" : "s you already have use"} another model
            ({[...new Set(others.map((c) => c.modelId?.replace(/^~/, "") ?? "none"))].slice(0, 2).join(", ")}).
          </span>
          <Button variant="outline" size="sm" onClick={() => { for (const c of others) setChatModel(c.id, current, "openrouter"); setSwitched(others.length); }}>
            Switch {others.length === 1 ? "it" : `all ${others.length}`} to {known.name}
          </Button>
        </div>
      )}
      {switched !== null && others.length === 0 && (
        <p role="status" className="text-[11px] text-green-700">Switched {switched} chat{switched === 1 ? "" : "s"} to {known?.name ?? current}.</p>
      )}
    </div>
  );
}
