"use client";

// ─── "Delete this chat?" ──────────────────────────────────────────────────────
// Deleting a chat purges what the character remembers from it too (facts,
// stats, episodes), so it is always asked first. Shared by Recent Chats and the
// Chats screen, so both say the same thing. Archiving is the gentle option.
// Pictures made in the chat are kept (the Gallery shows them under "Deleted
// chat") unless you tick "also delete its pictures"; a picture kept as a
// portrait or reference is its own copy and is never touched.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Chat } from "@/lib/types";

export function DeleteChatDialog({ chat, open, onClose }: { chat: Chat; open: boolean; onClose: () => void }) {
  const deleteChat = useFableStore((s) => s.deleteChat);
  const imageJobs = useFableStore((s) => s.imageJobs);
  const pictureJobs = imageJobs.filter((j) => j.chatId === chat.id);
  const [withPictures, setWithPictures] = useState(false);
  const n = chat.messages.length;
  const pics = pictureJobs.length;
  const remove = () => {
    onClose();
    if (withPictures && pics) useFableStore.getState().deleteRenders(pictureJobs.map((j) => j.id));
    deleteChat(chat.id);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-5" aria-describedby={undefined} onClick={(e) => e.stopPropagation()}>
        <DialogTitle>Delete “{chat.name}”?</DialogTitle>
        <p className="text-xs text-[var(--muted-fg)] mt-2 leading-relaxed">
          This permanently deletes the chat and everything the character remembers from it — {n} message{n !== 1 ? "s" : ""},
          facts, stats, and episodes. This can’t be undone. To keep it but put it away, archive it instead.
        </p>
        {pics > 0 && (
          <label className="mt-3 flex items-start gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={withPictures} onChange={(e) => setWithPictures(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--purple)]" aria-label="Also delete its pictures" />
            <span>
              <span className="block font-medium text-[var(--foreground)]">Also delete its {pics} picture{pics === 1 ? "" : "s"}</span>
              <span className="block text-[11px] text-[var(--muted-fg)]">
                Otherwise they stay in the Gallery under “Deleted chat”. A picture kept as a portrait or reference stays either way.
              </span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={remove}>
            <Trash2 className="h-3 w-3 mr-1.5" />
            Delete chat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
