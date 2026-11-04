"use client";

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import type { Character } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { AvatarPicker } from "@/components/ui/AvatarPicker";
import { Trash2 } from "lucide-react";
import { Field } from "@/components/ui/field";
import { useUiStore } from "@/lib/store/ui";
import { QuickImportPanel, type QuickImportResult } from "./QuickImportPanel";

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name:         string;
  avatar:       string;
  tags:         string;  // comma-separated in the UI
  description:  string;
  personality:  string;
  scenario:     string;
  firstMessage: string;
  // Card fields — collapsed under "Card details"
  exampleDialogue:         string;
  systemPrompt:            string;
  postHistoryInstructions: string;
  alternateGreetings:      string;  // one per block, separated by a line of ---
  creator:                 string;
  creatorNotes:            string;
  lorebookId:              string;  // "" = none
}

const GREETING_SEPARATOR = "\n---\n";

function toFormState(source: Partial<Character> | null): FormState {
  return {
    name:         source?.name ?? "",
    avatar:       source?.avatar ?? "",
    tags:         (source?.tags ?? []).join(", "),
    description:  source?.description ?? "",
    personality:  source?.personality ?? "",
    scenario:     source?.scenario ?? "",
    firstMessage: source?.firstMessage ?? "",
    exampleDialogue:         source?.exampleDialogue ?? "",
    systemPrompt:            source?.systemPrompt ?? "",
    postHistoryInstructions: source?.postHistoryInstructions ?? "",
    alternateGreetings:      (source?.alternateGreetings ?? []).join(GREETING_SEPARATOR),
    creator:                 source?.creator ?? "",
    creatorNotes:            source?.creatorNotes ?? "",
    lorebookId:              source?.lorebookId ?? "",
  };
}

// ─── Inner form ───────────────────────────────────────────────────────────────
// Mounted fresh per dialog open (keyed by target id), so useState initialisers
// seed the form without any set-state-in-effect.

function EditorForm({ editing, draft }: { editing: Character | null; draft: Partial<Character> | null }) {
  const { addCharacter, updateCharacter, deleteCharacter, lorebooks } = useFableStore();
  const { closeCharacterEditor } = useUiStore();

  const [form, setForm]                   = useState<FormState>(() => toFormState(editing ?? draft));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  /**
   * Apply sorted text to the form. Never destroys: a field already filled in gets
   * the new text added after it; the name is only taken when there is none.
   */
  const applyQuickImport = ({ fields, tags }: QuickImportResult) => {
    setForm((f) => {
      const next = { ...f };
      const add = (key: keyof FormState, value: string | undefined) => {
        if (!value?.trim()) return;
        next[key] = next[key].trim() ? `${next[key].trim()}\n\n${value.trim()}` : value.trim();
      };
      if (!next.name.trim() && fields.name) next.name = fields.name.trim();
      add("description", fields.description);
      add("personality", fields.personality);
      add("scenario", fields.scenario);
      add("firstMessage", fields.first_mes);
      add("exampleDialogue", fields.mes_example);
      add("creator", fields.creator);
      add("creatorNotes", fields.creator_notes);
      const have = next.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const merged = [...have, ...tags.filter((t) => !have.some((h) => h.toLowerCase() === t.toLowerCase()))];
      next.tags = merged.join(", ");
      return next;
    });
  };

  const handleSave = () => {
    const data = {
      name:         form.name.trim(),
      avatar:       form.avatar.trim() || undefined,
      tags:         form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      description:  form.description.trim(),
      personality:  form.personality.trim() || undefined,
      scenario:     form.scenario.trim()    || undefined,
      firstMessage: form.firstMessage.trim() || undefined,
      exampleDialogue:         form.exampleDialogue.trim()         || undefined,
      systemPrompt:            form.systemPrompt.trim()            || undefined,
      postHistoryInstructions: form.postHistoryInstructions.trim() || undefined,
      alternateGreetings: form.alternateGreetings.split(/\n\s*---\s*\n/).map((g) => g.trim()).filter(Boolean),
      creator:      form.creator.trim()      || undefined,
      creatorNotes: form.creatorNotes.trim() || undefined,
      // Not editable here, but part of the card: carried through from what was
      // opened so importing then saving does not silently drop platform data.
      lorebookId:   form.lorebookId || undefined,
      characterVersion: (editing ?? draft)?.characterVersion,
      cardExtensions:   (editing ?? draft)?.cardExtensions,
    };
    if (editing) updateCharacter(editing.id, data);
    else addCharacter(data);
    closeCharacterEditor();
  };

  const handleDelete = () => {
    if (!editing) return;
    deleteCharacter(editing.id);
    closeCharacterEditor();
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <Avatar name={form.name || "?"} src={form.avatar.trim() || undefined} size="md" />
        <DialogTitle>{editing ? `Edit ${editing.name}` : "New Character"}</DialogTitle>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <QuickImportPanel onApply={applyQuickImport} />

        <Field label="Name">
          <Input value={form.name} onChange={set("name")} placeholder="Ronan" autoFocus />
        </Field>

        <AvatarPicker
          name={form.name}
          value={form.avatar}
          onChange={(avatar) => setForm((f) => ({ ...f, avatar }))}
        />

        <Field label="Tags" hint="comma-separated">
          <Input value={form.tags} onChange={set("tags")} placeholder="cyberpunk, mercenary, male" />
        </Field>

        <Field label="Description" hint="who they are — injected into every prompt">
          <Textarea value={form.description} onChange={set("description")} rows={3}
            placeholder="A grizzled mercenary with a sharp wit and a code of honor…" />
        </Field>

        <Field label="Personality" hint="optional">
          <Textarea value={form.personality} onChange={set("personality")} rows={2}
            placeholder="Sarcastic, loyal, world-weary but optimistic underneath." />
        </Field>

        <Field label="Scenario" hint="optional — the current situation">
          <Textarea value={form.scenario} onChange={set("scenario")} rows={2}
            placeholder="Hiding out in a safehouse after a job went sideways." />
        </Field>

        <Field label="First message" hint="optional — greets you when a chat starts">
          <Textarea value={form.firstMessage} onChange={set("firstMessage")} rows={3}
            placeholder="*looks up from cleaning a pistol* You're late." />
        </Field>

        <Field label="Lorebook" hint="this character's world — exported inside their card">
          <select
            value={form.lorebookId}
            onChange={(e) => setForm((f) => ({ ...f, lorebookId: e.target.value }))}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--purple)]"
          >
            <option value="">None</option>
            {lorebooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>

        <details className="rounded-lg border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-[var(--foreground)]">
            Card details <span className="font-normal text-[var(--muted-fg)]">— the rest of the character-card format</span>
          </summary>
          <div className="mt-3 space-y-4">
            <Field label="Example dialogue" hint="how they speak — separate exchanges with <START>">
              <Textarea value={form.exampleDialogue} onChange={set("exampleDialogue")} rows={4}
                placeholder={"<START>\n{{user}}: Where were you?\n{{char}}: *shrugs* Around."} />
            </Field>
            <Field label="System prompt" hint="the card's own instructions to the model">
              <Textarea value={form.systemPrompt} onChange={set("systemPrompt")} rows={3} />
            </Field>
            <Field label="Post-history instructions" hint="a reminder placed near the end of the prompt">
              <Textarea value={form.postHistoryInstructions} onChange={set("postHistoryInstructions")} rows={2} />
            </Field>
            <Field label="Alternate greetings" hint="separate with a line containing only ---">
              <Textarea value={form.alternateGreetings} onChange={set("alternateGreetings")} rows={3} />
            </Field>
            <Field label="Creator" hint="credited in exported cards">
              <Input value={form.creator} onChange={set("creator")} />
            </Field>
            <Field label="Creator notes" hint="shown to people who download the card, never sent to the model">
              <Textarea value={form.creatorNotes} onChange={set("creatorNotes")} rows={2} />
            </Field>
            <p className="text-[11px] text-[var(--muted-fg)]">
              <code>{"{{char}}"}</code> and <code>{"{{user}}"}</code> are filled in with the character&apos;s name and your persona.
            </p>
          </div>
        </details>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-3">
        {editing && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600">Delete permanently?</span>
              <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50" onClick={handleDelete}>
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-red-500 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
          )
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={closeCharacterEditor}>
          Cancel
        </Button>
        <Button variant="purple" size="sm" onClick={handleSave} disabled={!form.name.trim()}>
          {editing ? "Save changes" : "Create character"}
        </Button>
      </div>
    </>
  );
}

// ─── Dialog shell ─────────────────────────────────────────────────────────────

export function CharacterEditorDialog() {
  const { characters } = useFableStore();
  const { characterEditorOpen, characterEditorId, characterEditorDraft, closeCharacterEditor } = useUiStore();

  const editing = characters.find((c) => c.id === characterEditorId) ?? null;

  return (
    <Dialog open={characterEditorOpen} onOpenChange={(open) => { if (!open) closeCharacterEditor(); }}>
      <DialogContent aria-describedby={undefined}>
        <EditorForm
          // Draft identity must be part of the key: dropping card B while
          // reviewing card A keeps the dialog open in create mode, and a bare
          // "new" key silently ignored the fresh draft.
          key={characterEditorId ?? `new-${characterEditorDraft?.name ?? ""}-${characterEditorDraft?.description?.length ?? 0}`}
          editing={editing}
          draft={characterEditorDraft}
        />
      </DialogContent>
    </Dialog>
  );
}
