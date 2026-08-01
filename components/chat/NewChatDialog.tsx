"use client";

// ─── New-chat builder ─────────────────────────────────────────────────────────
// Build the chat before starting it: pick the character, who YOU are, which
// worlds (lorebooks) apply, and the opening — the character sheet's own
// scenario/greeting, or a saved Scenario that overrides both.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Check, Globe, Clapperboard, MessageSquare, Sparkles } from "lucide-react";

export function NewChatDialog() {
  const { chatBuilderOpen, setChatBuilderOpen } = useFableStore();
  return (
    <Dialog open={chatBuilderOpen} onOpenChange={(o) => !o && setChatBuilderOpen(false)}>
      {/* Mounted fresh on every open, so initial useState values ARE the reset */}
      {chatBuilderOpen && <BuilderForm />}
    </Dialog>
  );
}

function BuilderForm() {
  const {
    setChatBuilderOpen,
    characters, personas, activePersonaId, lorebooks, scenarios,
    createChatFromBuilder, setActiveSection,
  } = useFableStore();

  const [characterId, setCharacterId] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState<string | null>(activePersonaId);
  const [worldIds, setWorldIds] = useState<Set<string>>(() => new Set(lorebooks.map((b) => b.id)));
  const [scenarioId, setScenarioId] = useState<string | null>(null); // null = character's own

  const character = characters.find((c) => c.id === characterId);
  const scenario = scenarios.find((s) => s.id === scenarioId);
  const opening = scenario?.firstMessage?.trim() || character?.firstMessage?.trim() || "";

  const toggleWorld = (id: string) => {
    setWorldIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStart = () => {
    if (!characterId) return;
    createChatFromBuilder({
      characterId,
      personaId,
      // All worlds selected = store undefined so future books auto-join
      lorebookIds: worldIds.size === lorebooks.length ? undefined : [...worldIds],
      scenarioText: scenario?.scenario,
      firstMessage: scenario?.firstMessage?.trim() || undefined,
    });
    setChatBuilderOpen(false);
    setActiveSection("chats");
  };

  const sectionLabel = "text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] mb-1.5";

  return (
    <DialogContent className="max-w-lg p-5 max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--purple-fg)]" />
          Build your chat
        </DialogTitle>

        <div className="mt-4 space-y-4">
          {/* Character */}
          <div>
            <div className={sectionLabel}>Character</div>
            {characters.length === 0 ? (
              <div className="text-xs text-[var(--muted-fg)]">
                No characters yet —{" "}
                <button
                  className="text-[var(--purple-fg)] underline cursor-pointer"
                  onClick={() => { setChatBuilderOpen(false); setActiveSection("characters"); }}
                >
                  create one first
                </button>.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {characters.map((c) => {
                  const active = c.id === characterId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCharacterId(c.id)}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors cursor-pointer ${
                        active
                          ? "border-[var(--purple)] bg-[var(--purple-light)]"
                          : "border-[var(--border)] bg-white hover:bg-[var(--muted)]"
                      }`}
                    >
                      <Avatar name={c.name} src={c.avatar} size="xs" />
                      <span className={`flex-1 min-w-0 text-xs font-medium truncate ${active ? "text-[var(--purple-fg)]" : "text-[var(--foreground)]"}`}>
                        {c.name}
                      </span>
                      {active && <Check className="h-3 w-3 text-[var(--purple-fg)] flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Persona */}
          <div>
            <div className={sectionLabel}>You are</div>
            <div className="grid grid-cols-2 gap-1.5">
              {personas.map((p) => {
                const active = p.id === personaId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPersonaId(p.id)}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors cursor-pointer ${
                      active
                        ? "border-[var(--purple)] bg-[var(--purple-light)]"
                        : "border-[var(--border)] bg-white hover:bg-[var(--muted)]"
                    }`}
                  >
                    <Avatar name={p.name} src={p.avatar} size="xs" />
                    <span className={`flex-1 min-w-0 text-xs font-medium truncate ${active ? "text-[var(--purple-fg)]" : "text-[var(--foreground)]"}`}>
                      {p.name}
                    </span>
                    {active && <Check className="h-3 w-3 text-[var(--purple-fg)] flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
            {personas.length === 0 && (
              <div className="text-xs text-[var(--muted-fg)]">
                No personas yet — you can create one in Characters.
              </div>
            )}
          </div>

          {/* Worlds */}
          {lorebooks.length > 0 && (
            <div>
              <div className={sectionLabel}>Worlds ({worldIds.size} of {lorebooks.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {lorebooks.map((b) => {
                  const active = worldIds.has(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => toggleWorld(b.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${
                        active
                          ? "border-[var(--purple)] bg-[var(--purple-light)] text-[var(--purple-fg)]"
                          : "border-[var(--border)] bg-white text-[var(--muted-fg)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <Globe className="h-3 w-3" />
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Opening: character's own vs saved scenario */}
          <div>
            <div className={sectionLabel}>Scenario &amp; first message</div>
            <div className="space-y-1">
              <button
                onClick={() => setScenarioId(null)}
                className={`w-full flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                  scenarioId === null
                    ? "border-[var(--purple)] bg-[var(--purple-light)]"
                    : "border-[var(--border)] bg-white hover:bg-[var(--muted)]"
                }`}
              >
                <MessageSquare className={`h-3.5 w-3.5 flex-shrink-0 ${scenarioId === null ? "text-[var(--purple-fg)]" : "text-[var(--muted-fg)]"}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${scenarioId === null ? "text-[var(--purple-fg)]" : "text-[var(--foreground)]"}`}>
                    Character&apos;s own
                  </div>
                  <div className="text-[10px] text-[var(--muted-fg)]">
                    Use the scenario and greeting from the character sheet
                  </div>
                </div>
                {scenarioId === null && <Check className="h-3.5 w-3.5 text-[var(--purple-fg)] flex-shrink-0" />}
              </button>
              {scenarios.map((s) => {
                const active = s.id === scenarioId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setScenarioId(s.id)}
                    className={`w-full flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                      active
                        ? "border-[var(--purple)] bg-[var(--purple-light)]"
                        : "border-[var(--border)] bg-white hover:bg-[var(--muted)]"
                    }`}
                  >
                    <Clapperboard className={`h-3.5 w-3.5 flex-shrink-0 ${active ? "text-[var(--purple-fg)]" : "text-[var(--muted-fg)]"}`} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium truncate ${active ? "text-[var(--purple-fg)]" : "text-[var(--foreground)]"}`}>
                        {s.name}
                      </div>
                      {s.scenario && (
                        <div className="text-[10px] text-[var(--muted-fg)] truncate">{s.scenario}</div>
                      )}
                    </div>
                    {active && <Check className="h-3.5 w-3.5 text-[var(--purple-fg)] flex-shrink-0" />}
                  </button>
                );
              })}
              <button
                onClick={() => { setChatBuilderOpen(false); setActiveSection("scenarios"); }}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-[var(--muted-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
              >
                + New scenario…
              </button>
            </div>
          </div>

          {/* Opening-message preview */}
          {character && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] mb-1">
                Opens with
              </div>
              <p className="text-[11px] text-[var(--foreground)] leading-snug line-clamp-3">
                {opening || <span className="italic text-[var(--muted-fg)]">No first message — you speak first.</span>}
              </p>
            </div>
          )}

          {/* Start */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setChatBuilderOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!characterId} onClick={handleStart}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Start chat
            </Button>
          </div>
        </div>
      </DialogContent>
  );
}
