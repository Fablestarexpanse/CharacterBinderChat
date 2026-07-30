"use client";

import { useRef, useState } from "react";
import { useFableStore } from "@/lib/store";
import type { Character } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PersonaEditorDialog } from "@/components/characters/PersonaEditorDialog";
import { Plus, MessageSquare, UserCircle2, Check } from "lucide-react";

// ─── Character card import ────────────────────────────────────────────────────
// Accepts SillyTavern v2 cards ({spec:"chara_card_v2", data:{…}}), v1 flat
// cards ({name, description, first_mes, …}), and this app's own Character JSON.

function parseCharacterCard(json: unknown): Partial<Character> | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const data =
    obj.spec === "chara_card_v2" && obj.data && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : obj;

  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : undefined);
  const name = str("name");
  if (!name?.trim()) return null;

  const avatar = str("avatar");
  return {
    name,
    description:  str("description") ?? "",
    personality:  str("personality"),
    scenario:     str("scenario"),
    firstMessage: str("first_mes") ?? str("firstMessage"),
    avatar:       avatar && avatar !== "none" ? avatar : undefined,
    tags: Array.isArray(data.tags)
      ? (data.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CharactersView() {
  const {
    characters, createChat, setActiveChatId, setActiveSection, openCharacterEditor,
    personas, activePersonaId, setActivePersona,
  } = useFableStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [personaEditor, setPersonaEditor] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  const handleStartChat = (characterId: string) => {
    const chatId = createChat(characterId);
    setActiveChatId(chatId);
    setActiveSection("chats");
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setImportError(null);
    try {
      const draft = parseCharacterCard(JSON.parse(await file.text()));
      if (!draft) {
        setImportError(`Couldn't find a character in ${file.name} — expected a JSON card with a "name" field.`);
        return;
      }
      // Open the editor prefilled so the import can be reviewed before saving
      openCharacterEditor(null, draft);
    } catch {
      setImportError(`${file.name} isn't valid JSON. PNG cards aren't supported yet — export as JSON.`);
    }
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
              <div className="text-sm text-[var(--muted-fg)]">Import character</div>
              <div className="text-xs text-[var(--muted-fg)]">JSON card (SillyTavern v1/v2)</div>
            </div>
          </Card>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
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
      </div>
    </div>
  );
}
