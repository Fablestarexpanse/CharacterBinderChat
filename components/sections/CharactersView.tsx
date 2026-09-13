"use client";

import { useRef, useState } from "react";
import { useFableStore } from "@/lib/store";
import { importCardFiles } from "@/lib/import/applyCards";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PersonaEditorDialog } from "@/components/characters/PersonaEditorDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Plus, MessageSquare, UserCircle2, Check, Sparkles, History } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { getJson, sendJson } from "@/lib/api/client";

// A chat that holds memories involving a character — offered as a source when
// starting a new chat, because memory never carries over implicitly.
interface MemorySource {
  chatId:    string;
  chatName:  string | null;
  facts:     number;
  updatedAt: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CharactersView() {
  const { characters, createChat, setActiveChatId, personas, activePersonaId, setActivePersona } = useFableStore();
  const { setActiveSection, openCharacterEditor } = useUiStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [personaEditor, setPersonaEditor] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  // Fresh-vs-continue chooser, shown only when prior chats hold memories
  const [memoryChooser, setMemoryChooser] = useState<{
    characterId: string; sources: MemorySource[];
  } | null>(null);

  const beginChat = (characterId: string, fromChatId?: string) => {
    const chatId = createChat(characterId);
    setActiveChatId(chatId);
    setActiveSection("chats");
    setMemoryChooser(null);
    if (fromChatId) {
      // Copy the source chat's memories into the new one, then nudge the
      // inspector to re-fetch
      sendJson("POST", "/api/drawer/transfer", { fromChatId, toChatId: chatId })
        .then(() => useFableStore.getState().bumpExtraction())
        // A failed transfer used to bump the "memory changed" signal anyway,
        // so the inspector re-fetched, found nothing, and the user was told
        // nothing — a silent loss of what they asked for.
        .catch((e: Error) => setImportError(`Carrying memories forward failed — ${e.message}`));
    }
  };

  const handleStartChat = async (characterId: string) => {
    // Each chat is a fresh start by default. If earlier chats hold memories of
    // this character, let the user choose to carry one forward explicitly.
    try {
      const data = await getJson<{ sources?: MemorySource[] }>(
        `/api/drawer/transfer?characterId=${encodeURIComponent(characterId)}`);
      const sources = (data.sources ?? []).filter((s) => s.facts > 0);
      if (sources.length > 0) {
        setMemoryChooser({ characterId, sources: sources.slice(0, 4) });
        return;
      }
    } catch { /* offline or route error — just start fresh */ }
    beginChat(characterId);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setImportError(null);
    // Same pipeline as window drag-and-drop: PNG cards (CharacterBinder /
    // SillyTavern) or JSON. Characters open the editor for review; other card
    // types (lorebook, persona, scenario) land directly in their sections.
    const [result] = await importCardFiles([file]);
    if (!result.ok) setImportError(`${result.file}: ${result.message}`);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Characters</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {characters.length} character{characters.length !== 1 ? "s" : ""} available
            </p>
          </div>
          <Button variant="purple" size="md" onClick={() => openCharacterEditor()}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Character
          </Button>
        </div>

        {importError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {importError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {characters.map((char) => (
            <Card key={char.id} className="p-4 hover:border-[var(--purple)] transition-colors">
              <div className="flex items-start gap-3">
                <Avatar name={char.name} src={char.avatar} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--foreground)]">{char.name}</div>
                  <div className="flex flex-wrap gap-1 mt-1 mb-2">
                    {char.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="purple">{tag}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--muted-fg)] line-clamp-2">{char.description}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="purple"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleStartChat(char.id)}
                >
                  <MessageSquare className="h-3 w-3 mr-1.5" />
                  Chat
                </Button>
                <Button variant="outline" size="sm" onClick={() => openCharacterEditor(char.id)}>
                  Edit
                </Button>
              </div>
            </Card>
          ))}

          {/* Import / create card */}
          <Card
            className="p-4 border-dashed flex items-center justify-center cursor-pointer hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors min-h-[120px]"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-center">
              <Plus className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-1" />
              <div className="text-sm text-[var(--muted-fg)]">Import card</div>
              <div className="text-xs text-[var(--muted-fg)]">
                PNG (CharacterBinder / SillyTavern) or JSON — or drop it anywhere
              </div>
            </div>
          </Card>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.png,application/json,image/png"
          className="hidden"
          onChange={handleImportFile}
        />

        {/* ── Your Personas ─────────────────────────────────────────────── */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-[var(--foreground)] flex items-center gap-2">
                <UserCircle2 className="h-4 w-4 text-[var(--purple-fg)]" />
                Your Personas
              </h2>
              <p className="text-sm text-[var(--muted-fg)] mt-1">
                Who <em>you</em> are in the story — characters address you by the active persona.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPersonaEditor({ open: true, id: null })}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New Persona
            </Button>
          </div>

          {personas.length === 0 ? (
            <Card
              className="p-4 border-dashed flex items-center justify-center cursor-pointer hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors min-h-[80px]"
              onClick={() => setPersonaEditor({ open: true, id: null })}
            >
              <div className="text-center">
                <div className="text-sm text-[var(--muted-fg)]">No persona yet</div>
                <div className="text-xs text-[var(--muted-fg)]">
                  Create one so characters know who they&apos;re talking to
                </div>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {personas.map((p) => {
                const isActive = p.id === activePersonaId;
                return (
                  <Card
                    key={p.id}
                    className={`p-4 cursor-pointer transition-colors ${
                      isActive
                        ? "border-[var(--purple)] bg-[var(--purple-light)]"
                        : "hover:border-[var(--purple)]"
                    }`}
                    onClick={() => setActivePersona(isActive ? null : p.id)}
                    title={isActive ? "Active persona — click to deactivate" : "Click to make active"}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={p.name} src={p.avatar} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm text-[var(--foreground)]">{p.name}</span>
                          {isActive && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--purple-fg)] bg-white border border-[var(--purple)] rounded-full px-1.5 py-0.5">
                              <Check className="h-2.5 w-2.5" />
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--muted-fg)] line-clamp-2 mt-1">
                          {p.description || <em>No description</em>}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPersonaEditor({ open: true, id: p.id });
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <PersonaEditorDialog
          open={personaEditor.open}
          personaId={personaEditor.id}
          onClose={() => setPersonaEditor({ open: false, id: null })}
        />

        {/* Fresh start vs continue-with-memories */}
        <Dialog open={!!memoryChooser} onOpenChange={(o) => { if (!o) setMemoryChooser(null); }}>
          <DialogContent className="max-w-md" aria-describedby={undefined}>
            <div className="border-b border-[var(--border)] px-5 py-4">
              <DialogTitle>Start a new story?</DialogTitle>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-xs text-[var(--muted-fg)]">
                Each chat is its own story — the character starts with no memory of other
                chats. You can carry memories over from a previous story if you want to
                continue where you left off.
              </p>

              <button
                onClick={() => memoryChooser && beginChat(memoryChooser.characterId)}
                className="w-full flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors"
              >
                <Sparkles className="h-4 w-4 text-[var(--purple-fg)] flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium text-[var(--foreground)]">Fresh start</span>
                  <span className="block text-xs text-[var(--muted-fg)]">A blank slate — nothing remembered</span>
                </span>
              </button>

              {memoryChooser?.sources.map((s) => (
                <button
                  key={s.chatId}
                  onClick={() => beginChat(memoryChooser.characterId, s.chatId)}
                  className="w-full flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors"
                >
                  <History className="h-4 w-4 text-[var(--muted-fg)] flex-shrink-0" />
                  <span>
                    <span className="block text-sm font-medium text-[var(--foreground)]">
                      Continue from “{s.chatName ?? s.chatId}”
                    </span>
                    <span className="block text-xs text-[var(--muted-fg)]">
                      Carries over {s.facts} remembered fact{s.facts !== 1 ? "s" : ""} and the relationship
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
