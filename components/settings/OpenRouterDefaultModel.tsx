"use client";

// ─── Settings → Chat models → OpenRouter: the default model ───────────────────
// The OpenRouter model new chats start on. Shown once OpenRouter is connected
// (the list is its own catalogue); a chat can still switch model in its header,
// and chats you already have keep theirs.

import { useFableStore } from "@/lib/store";
import { useModelCatalog } from "@/lib/hooks/useModelCatalog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OpenRouterDefaultModel() {
  const current = useFableStore((s) => s.providerSettings.openrouter.defaultModel ?? "");
  const setProviderSetting = useFableStore((s) => s.setProviderSetting);
  const connected = useFableStore((s) => s.providerStatuses.find((p) => p.id === "openrouter")?.connected ?? false);
  const { models } = useModelCatalog();
  const openrouter = models.filter((m) => m.providerId === "openrouter").sort((a, b) => a.name.localeCompare(b.name));
  if (!connected) {
    return <p className="text-[11px] text-[var(--muted-fg)]">Once your key connects, you can choose the model new chats start on here.</p>;
  }
  const known = openrouter.find((m) => m.id === current);
  return (
    <div className="space-y-1.5">
      <label htmlFor="openrouter-default-model" className="text-xs font-medium text-[var(--foreground)]">Default model for new chats</label>
      <div className="flex gap-2">
        <Input id="openrouter-default-model" list="openrouter-models" value={current} placeholder="Type to search, e.g. claude or deepseek"
          onChange={(e) => setProviderSetting("openrouter", { defaultModel: e.target.value })} />
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
    </div>
  );
}
