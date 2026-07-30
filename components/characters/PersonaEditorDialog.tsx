"use client";

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import type { Persona } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Trash2 } from "lucide-react";

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

// ─── Inner form (mounted fresh per open, keyed by target id) ─────────────────

function EditorForm({
  editing,
  onClose,
}: {
  editing: Persona | null;
  onClose: () => void;
}) {
  const { addPersona, updatePersona, deletePersona } = useFableStore();

  const [name,        setName]        = useState(editing?.name ?? "");
  const [avatar,      setAvatar]      = useState(editing?.avatar ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    const data = {
      name:        name.trim(),
      avatar:      avatar.trim() || undefined,
      description: description.trim(),
    };
    if (editing) updatePersona(editing.id, data);
    else addPersona(data);
    onClose();
  };

  const handleDelete = () => {
    if (!editing) return;
    deletePersona(editing.id);
    onClose();
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <Avatar name={name || "?"} src={avatar.trim() || undefined} size="md" />
        <DialogTitle>{editing ? `Edit ${editing.name}` : "New Persona"}</DialogTitle>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <Field label="Name" hint="how characters address you">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kira" autoFocus />
        </Field>

        <Field label="Avatar URL" hint="optional — initials are shown without one">
          <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="/avatars/me.png or https://…" />
        </Field>

        <Field label="Description" hint="who you are in the story — appearance, role, backstory">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="A freelance courier working the lower city. Quick on her feet, slow to trust…"
          />
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
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="purple" size="sm" onClick={handleSave} disabled={!name.trim()}>
          {editing ? "Save changes" : "Create persona"}
        </Button>
      </div>
    </>
  );
}

// ─── Dialog shell (controlled by the parent) ─────────────────────────────────

export function PersonaEditorDialog({
  open,
  personaId,
  onClose,
}: {
  open: boolean;
  personaId: string | null;
  onClose: () => void;
}) {
  const { personas } = useFableStore();
  const editing = personas.find((p) => p.id === personaId) ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <EditorForm key={personaId ?? "new"} editing={editing} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
