"use client";

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Group, Plus, MessageSquare, Check } from "lucide-react";

export function GroupsView() {
  const { chats, characters, createGroupChat, setActiveChatId, setActiveSection } = useFableStore();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groupChats = chats.filter((c) => (c.memberIds?.length ?? 0) >= 2);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    const id = createGroupChat([...selected]);
    if (id) {
      setCreating(false);
      setSelected(new Set());
      setActiveChatId(id);
      setActiveSection("chats");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Groups</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {groupChats.length} group chat{groupChats.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button variant="purple" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Group
          </Button>
        </div>

        <p className="text-xs text-[var(--muted-fg)] mb-6">
          Multiple characters, one scene. Each character keeps their own memory and only
          knows what happened while they were present — toggle who is in the scene from the
          chat header, and pick who speaks (or let it auto-select) above the message box.
        </p>

        {groupChats.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <Group className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              No group chats yet — pick two or more characters to start one.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {groupChats.map((chat) => {
              const members = (chat.memberIds ?? [])
                .map((id) => characters.find((c) => c.id === id))
                .filter(Boolean);
              return (
                <Card key={chat.id} className="p-4 hover:border-[var(--purple)] transition-colors">
                  <div className="flex items-center gap-1.5 mb-2">
                    {members.slice(0, 4).map((m) => (
                      <Avatar key={m!.id} name={m!.name} src={m!.avatar} size="sm" />
                    ))}
                  </div>
                  <div className="font-semibold text-sm text-[var(--foreground)] truncate">{chat.name}</div>
                  <div className="text-xs text-[var(--muted-fg)] mb-3">
                    {members.length} characters · {chat.messages.length} messages
                  </div>
                  <Button
                    variant="purple"
                    size="sm"
                    className="w-full"
                    onClick={() => { setActiveChatId(chat.id); setActiveSection("chats"); }}
                  >
                    <MessageSquare className="h-3 w-3 mr-1.5" />
                    Open
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-md p-5">
          <DialogTitle>New group chat</DialogTitle>
          <p className="text-xs text-[var(--muted-fg)] mt-1 mb-3">
            Pick at least two characters. The first selected opens the scene.
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {characters.map((c) => {
              const on = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={`w-full flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    on
                      ? "border-[var(--purple)] bg-[var(--purple-light)]"
                      : "border-[var(--border)] hover:border-[var(--purple)]"
                  }`}
                >
                  <Avatar name={c.name} src={c.avatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--foreground)]">{c.name}</div>
                    <div className="text-[11px] text-[var(--muted-fg)] truncate">{c.description}</div>
                  </div>
                  {on && <Check className="h-4 w-4 text-[var(--purple-fg)] flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="purple" size="sm" disabled={selected.size < 2} onClick={handleCreate}>
              Create ({selected.size})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
