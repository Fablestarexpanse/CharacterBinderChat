"use client";

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import type { Character } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Trash2 } from "lucide-react";

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name:         string;
  avatar:       string;
  tags:         string;  // comma-separated in the UI
  description:  string;
  personality:  string;
  scenario:     string;
  firstMessage: string;
}

function toFormState(source: Partial<Character> | null): FormState {
  return {
    name:         source?.name ?? "",
    avatar:       source?.avatar ?? "",
    tags:         (source?.tags ?? []).join(", "),
    description:  source?.description ?? "",
    personality:  source?.personality ?? "",
    scenario:     source?.scenario ?? "",
    firstMessage: source?.firstMessage ?? "",
  };
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--foreground)]">
        {label}
        {hint && <span className="ml-1.5 font-normal text-[var(--muted-fg)]">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Inner form ───────────────────────────────────────────────────────────────
// Mounted fresh per dialog open (keyed by target id), so useState initialisers
// seed the form without any set-state-in-effect.

function EditorForm({ editing, draft }: { editing: Character | null; draft: Partial<Character> | null }) {
  const { addCharacter, updateCharacter, deleteCharacter, closeCharacterEditor } = useFableStore();

  const [form, setForm]                   = useState<FormState>(() => toFormState(editing ?? draft));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = () => {
    const data = {
      name:         form.name.trim(),
      avatar:       form.avatar.trim() || undefined,
      tags:         form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      description:  form.description.trim(),
      personality:  form.personality.trim() || undefined,
      scenario:     form.scenario.trim()    || undefined,
      firstMessage: form.firstMessage.trim() || undefined,
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
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} placeholder="Ronan" autoFocus />
        </Field>

        <Field label="Avatar URL" hint="optional — initials are shown without one">
          <Input value={form.avatar} onChange={set("avatar")} placeholder="/avatars/ronan.png or https://…" />
        </Field>

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
  const {
    characters, characterEditorOpen, characterEditorId, characterEditorDraft,
    closeCharacterEditor,
  } = useFableStore();

  const editing = characters.find((c) => c.id === characterEditorId) ?? null;

  return (
    <Dialog open={characterEditorOpen} onOpenChange={(open) => { if (!open) closeCharacterEditor(); }}>
      <DialogContent aria-describedby={undefined}>
        <EditorForm
          key={characterEditorId ?? "new"}
          editing={editing}
          draft={characterEditorDraft}
        />
      </DialogContent>
    </Dialog>
  );
}
