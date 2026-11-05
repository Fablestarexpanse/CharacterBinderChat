"use client";

// ─── The character, large, with Call and Text ─────────────────────────────────
// Top of the inspector's Character tab: their portrait big enough to see, name
// and tags on a fade, and, while Contact & media is on, Call (the call screen)
// and Text (switches this chat to texting). A character without a portrait
// shows their initial on a soft panel, with a hint to add one.

import { useEffect, useState } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { placeCall } from "@/lib/chat/calls";
import { contactSettings } from "@/lib/chat/photos";
import { unlockSounds } from "@/lib/chat/sounds";
import { sizedSrc } from "@/lib/chat/assets";
import type { Character } from "@/lib/types";

export function CharacterHero({ character }: { character: Character }) {
  const activeChatId = useFableStore((s) => s.activeChatId);
  const textMode = useUiStore((s) => !!(activeChatId && s.textModeChats[activeChatId]));
  const onCall = useUiStore((s) => !!s.call);
  const [contact, setContact] = useState<{ enabled: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void contactSettings().then((s) => { if (!cancelled) setContact({ enabled: s.enabled }); });
    return () => { cancelled = true; };
  }, [character.id]);

  // Their portrait, else their first reference picture
  const picture = character.avatar ?? character.referenceImages?.[0];
  const portrait = picture ? sizedSrc(picture, 400) : undefined;
  const call = async () => {
    unlockSounds();
    if (!activeChatId) return;
    setNote(await placeCall(activeChatId, character.id));
  };
  const text = () => {
    if (!activeChatId) return;
    useUiStore.getState().setTextMode(activeChatId, !textMode);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="relative aspect-[4/5] max-h-80 w-full bg-[var(--muted)]">
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored asset, resized by the server
          <img src={portrait} alt={character.name} className="absolute inset-0 h-full w-full object-cover object-top" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[var(--muted-fg)]">
            <span className="text-5xl font-semibold">{character.name.slice(0, 1)}</span>
            <span className="text-[11px]">No portrait yet: add one in Edit</span>
          </div>
        )}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="text-lg font-semibold leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.9)] truncate">{character.name}</div>
          {character.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {character.tags.slice(0, 4).map((tag) => <Badge key={tag} variant="purple">{tag}</Badge>)}
            </div>
          )}
        </div>
      </div>
      {contact?.enabled && activeChatId && (
        <div className="grid grid-cols-2 gap-2 p-2">
          <button onClick={() => void call()} disabled={onCall} aria-label={`Call ${character.name}`}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-green-500 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50 cursor-pointer">
            <Phone className="h-3.5 w-3.5" />Call
          </button>
          <button onClick={text} aria-pressed={textMode} aria-label={textMode ? "Stop texting (talk in person)" : `Text ${character.name}`}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold cursor-pointer ${textMode
              ? "bg-[#0A84FF] text-white hover:bg-[#0071e3]"
              : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"}`}>
            <MessageCircle className="h-3.5 w-3.5" />{textMode ? "Texting" : "Text"}
          </button>
          {note && <div role="alert" className="col-span-2 text-[11px] text-red-600">{note}</div>}
        </div>
      )}
    </div>
  );
}
