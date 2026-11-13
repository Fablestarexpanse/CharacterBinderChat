"use client";

// ─── Starting a chat with a character ─────────────────────────────────────────
// One dialog before the chat opens: who you are in this story (your personas,
// the current one chosen), which scenario it opens in (or the character's own),
// the first message that greets you (the character's own, one of its alternate
// greetings, or a saved one from First messages), and which lorebooks it uses (all of them unless you untick some). Then each
// chat is a fresh start; if earlier chats hold memories of this character, offer
// to carry one forward, explicitly (memory never carries over by itself).
// Extracted from the old Characters screen so the Library and anything else can
// start a chat the same way.

import { useState } from "react";
import { Check, History, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { getJson, sendJson } from "@/lib/api/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface MemorySource { chatId: string; chatName: string | null; facts: number; updatedAt: number }

interface Chooser {
  characterId: string;
  sources: MemorySource[];
  personaId: string | null;
  /** "" = the character's own scenario and greeting */
  scenarioId: string;
  /** The lorebooks ticked */
  lorebookIds: string[];
  /** "" = the scenario's or character's own; "alt:<n>" = an alternate greeting; "op:<id>" = a saved first message */
  opener: string;
}

const card = "rounded-xl border p-2 text-left transition-colors cursor-pointer";
const onCard = "border-[var(--purple)] bg-[var(--purple-light)]";
const offCard = "border-[var(--border)] hover:border-[var(--purple)]";

export function useStartChat(onError: (message: string) => void) {
  const { createChatFromBuilder, setActiveChatId, personas, activePersonaId, scenarios, lorebooks, openers, characters } = useFableStore();
  const { setActiveSection } = useUiStore();
  const [chooser, setChooser] = useState<Chooser | null>(null);

  const begin = (c: Chooser, fromChatId?: string) => {
    const scenario = scenarios.find((s) => s.id === c.scenarioId);
    const character = characters.find((ch) => ch.id === c.characterId);
    // A first message you picked wins; then the scenario's; then the character's own
    const picked = c.opener.startsWith("op:") ? openers.find((o) => o.id === c.opener.slice(3))?.text
      : c.opener.startsWith("alt:") ? character?.alternateGreetings?.[Number(c.opener.slice(4))]
      : undefined;
    const chatId = createChatFromBuilder({
      characterId: c.characterId,
      // The opening message is written to whoever you chose to be
      personaId: c.personaId ?? undefined,
      // Every lorebook ticked = all of them (also any added later); otherwise just those
      lorebookIds: c.lorebookIds.length === lorebooks.length ? undefined : c.lorebookIds,
      scenarioText: scenario?.scenario,
      firstMessage: picked?.trim() || scenario?.firstMessage?.trim() || undefined,
    });
    setActiveChatId(chatId);
    setActiveSection("chats");
    setChooser(null);
    if (fromChatId) {
      sendJson("POST", "/api/drawer/transfer", { fromChatId, toChatId: chatId })
        .then(() => useFableStore.getState().bumpExtraction())
        // Said out loud: a failed transfer used to look exactly like a fresh start
        .catch((e: Error) => onError(`Carrying memories forward failed — ${e.message}`));
    }
  };

  const startChat = async (characterId: string) => {
    let sources: MemorySource[] = [];
    try {
      const data = await getJson<{ sources?: MemorySource[] }>(`/api/drawer/transfer?characterId=${encodeURIComponent(characterId)}`);
      sources = (data.sources ?? []).filter((s) => s.facts > 0).slice(0, 4);
    } catch { /* offline or route error: no memories to offer */ }
    const personaId = personas.some((p) => p.id === activePersonaId) ? activePersonaId : personas[0]?.id ?? null;
    const c: Chooser = { characterId, sources, personaId, scenarioId: "", lorebookIds: lorebooks.map((b) => b.id), opener: "" };
    const alternates = (characters.find((ch) => ch.id === characterId)?.alternateGreetings ?? []).filter((g) => g.trim());
    // Nothing to choose: straight in
    if (personas.length === 0 && sources.length === 0 && scenarios.length === 0 && lorebooks.length === 0
      && openers.length === 0 && alternates.length === 0) { begin(c); return; }
    setChooser(c);
  };

  const toggleBook = (id: string) => chooser && setChooser({
    ...chooser,
    lorebookIds: chooser.lorebookIds.includes(id) ? chooser.lorebookIds.filter((x) => x !== id) : [...chooser.lorebookIds, id],
  });

  const dialog = (
    <Dialog open={!!chooser} onOpenChange={(o) => { if (!o) setChooser(null); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <DialogTitle>Start a new story?</DialogTitle>
        </div>
        {chooser && (
        <div className="space-y-4 px-5 py-4">
          {personas.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[var(--foreground)]">Who are you in this story?</div>
              <div role="radiogroup" aria-label="Your persona" className="grid gap-1.5 sm:grid-cols-2">
                {personas.map((p) => {
                  const on = chooser.personaId === p.id;
                  return (
                    <button key={p.id} role="radio" aria-checked={on} onClick={() => setChooser({ ...chooser, personaId: p.id })}
                      className={`flex items-center gap-2 ${card} ${on ? onCard : offCard}`}>
                      <Avatar name={p.name} src={p.avatar} size="sm" />
                      <span className="flex-1 min-w-0 text-sm font-medium text-[var(--foreground)] truncate">{p.name}</span>
                      {on && <Check className="h-3.5 w-3.5 text-[var(--purple-fg)] flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {scenarios.length > 0 && (
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-[var(--foreground)]">Scenario</span>
              <select value={chooser.scenarioId} onChange={(e) => setChooser({ ...chooser, scenarioId: e.target.value })}
                aria-label="Scenario" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm">
                <option value="">The character&apos;s own scenario and greeting</option>
                {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {chooser.scenarioId && (
                <span className="block text-[11px] text-[var(--muted-fg)] line-clamp-2">
                  {scenarios.find((s) => s.id === chooser.scenarioId)?.scenario}
                </span>
              )}
            </label>
          )}

          {(() => {
            const character = characters.find((ch) => ch.id === chooser.characterId);
            const alternates = (character?.alternateGreetings ?? []).map((g, i) => ({ g, i })).filter(({ g }) => g.trim());
            if (openers.length === 0 && alternates.length === 0) return null;
            const scenarioOpens = !!scenarios.find((s) => s.id === chooser.scenarioId)?.firstMessage?.trim();
            const preview = chooser.opener.startsWith("op:") ? openers.find((o) => o.id === chooser.opener.slice(3))?.text
              : chooser.opener.startsWith("alt:") ? character?.alternateGreetings?.[Number(chooser.opener.slice(4))]
              : scenarioOpens ? scenarios.find((s) => s.id === chooser.scenarioId)?.firstMessage : character?.firstMessage;
            return (
              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-[var(--foreground)]">First message</span>
                <select value={chooser.opener} onChange={(e) => setChooser({ ...chooser, opener: e.target.value })}
                  aria-label="First message" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm">
                  <option value="">{scenarioOpens ? "The scenario's opening" : `${character?.name ?? "The character"}'s own greeting`}</option>
                  {alternates.length > 0 && (
                    <optgroup label="Alternate greetings">
                      {alternates.map(({ i }) => <option key={i} value={`alt:${i}`}>Alternate greeting {i + 1}</option>)}
                    </optgroup>
                  )}
                  {openers.length > 0 && (
                    <optgroup label="Saved first messages">
                      {openers.map((o) => <option key={o.id} value={`op:${o.id}`}>{o.name}</option>)}
                    </optgroup>
                  )}
                </select>
                <span className="block text-[11px] text-[var(--muted-fg)] line-clamp-2">
                  {preview?.trim() || "No first message: you start the chat."}
                </span>
              </label>
            );
          })()}

          {lorebooks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-[var(--foreground)]">Lorebooks</div>
              <div className="space-y-1">
                {lorebooks.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={chooser.lorebookIds.includes(b.id)} onChange={() => toggleBook(b.id)}
                      aria-label={`Use ${b.name}`} className="h-4 w-4 accent-[var(--purple)]" />
                    <span className="truncate">{b.name}</span>
                    <span className="text-[11px] text-[var(--muted-fg)]">{b.entries.length} entr{b.entries.length === 1 ? "y" : "ies"}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-xs text-[var(--muted-fg)]">
              Each chat is its own story — the character starts with no memory of other chats.
              {chooser.sources.length ? " You can carry memories over from a previous story if you want to continue where you left off." : ""}
            </p>
            <button onClick={() => begin(chooser)}
              className="w-full flex items-center gap-3 rounded-xl border border-[var(--purple)] bg-[var(--purple-light)] p-3 text-left hover:brightness-95 transition">
              <Sparkles className="h-4 w-4 text-[var(--purple-fg)] flex-shrink-0" />
              <span>
                <span className="block text-sm font-medium text-[var(--foreground)]">{chooser.sources.length ? "Fresh start" : "Start the chat"}</span>
                <span className="block text-xs text-[var(--muted-fg)]">A blank slate — nothing remembered</span>
              </span>
            </button>
            {chooser.sources.map((s) => (
              <button key={s.chatId} onClick={() => begin(chooser, s.chatId)}
                className="w-full flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors">
                <History className="h-4 w-4 text-[var(--muted-fg)] flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-[var(--foreground)]">Continue from “{s.chatName ?? s.chatId}”</span>
                  <span className="block text-xs text-[var(--muted-fg)]">
                    Carries over {s.facts} remembered fact{s.facts !== 1 ? "s" : ""} and the relationship
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );

  return { startChat, dialog };
}
