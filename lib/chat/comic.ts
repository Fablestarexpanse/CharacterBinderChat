// ─── Comic-it ─────────────────────────────────────────────────────────────────
// "Comic it" in a chat makes one comic page of what happened since the last
// page: the background model writes the panel script (/api/image/comic-script),
// lib/media/comicPage.ts lays it out and compiles it to a MOSS-Image Layout,
// and the page is drawn with the MOSS workflow at 1024x1536, placed as an image
// card after the last message. The chat remembers where the page ended
// (chat.comic.upTo) and what it told (recap), so the next page continues it.
// Off unless switched on in Settings → Media → Comic-it (/api/comic).

import { useFableStore } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";
import { imageSettingsForChat, queueImage } from "@/lib/chat/imageGen";
import { COMIC_NEGATIVE, PAGE, compileLayout, layoutComicPage, lookFromDescription, type ComicPerson, type ComicScript } from "@/lib/media/comicPage";
import type { Chat, Message } from "@/lib/types";

/** The bundled MOSS-Image workflow (workflows/moss-photo.json): it letters boxed text well */
export const COMIC_WORKFLOW = "moss-photo";
/** At most this many messages go into one page; older unseen ones are left for the page after */
const MAX_MESSAGES = 16;

let cache: { at: number; value: { enabled: boolean; style: string } } | null = null;
export async function comicSettings(): Promise<{ enabled: boolean; style: string }> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  try {
    const value = await getJson<{ enabled: boolean; style: string }>("/api/comic");
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? { enabled: false, style: "" };
  }
}
export const forgetComicSettings = () => { cache = null; };

const real = (m: Message) => !m.error && !m.imageJobId && !m.callEvent && m.content.trim().length > 0;

/** The messages the next page covers: those after the last page, at most MAX_MESSAGES (the earliest first) */
export function messagesSinceLastPage(chat: Pick<Chat, "messages" | "comic">): Message[] {
  const start = chat.comic ? chat.messages.findIndex((m) => m.id === chat.comic!.upTo) + 1 : 0;
  return chat.messages.slice(Math.max(0, start)).filter(real).slice(0, MAX_MESSAGES);
}

/** untagged: people on the page with no image tags (drawn from their description, less consistently) */
export interface ComicResult { ok: boolean; error?: string; panels?: number; left?: number; untagged?: string[] }

/** Make the next comic page for this chat. Resolves once the page is queued (drawing continues in the card). */
export async function makeComicPage(chatId: string): Promise<ComicResult> {
  const settings = await comicSettings();
  if (!settings.enabled) return { ok: false, error: "Comic-it is off (Settings → Media → Comic-it)." };
  const st = useFableStore.getState();
  const chat = st.chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: "chat not found" };
  const msgs = messagesSinceLastPage(chat);
  if (msgs.length === 0) return { ok: false, error: "Nothing new since the last comic page." };

  const persona = st.personas.find((p) => p.id === st.activePersonaId);
  const memberIds = chat.memberIds?.length ? chat.memberIds : chat.characterId ? [chat.characterId] : [];
  const cast = memberIds.map((id) => st.characters.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const lookOf = (who: { name: string; description?: string; image?: { tags?: string } }) =>
    who.image?.tags?.trim() || lookFromDescription(who.description ?? "") || "a person";
  const people: Array<ComicPerson & { role: "character" | "you" }> = [
    ...cast.map((c) => ({ name: c.name, look: lookOf(c), role: "character" as const })),
    ...(persona ? [{ name: persona.name, look: lookOf(persona), role: "you" as const }] : []),
  ];
  const nameOf = (m: Message) => m.role === "user" ? persona?.name ?? "You" : st.characters.find((c) => c.id === (m.characterId ?? chat.characterId))?.name ?? "Character";
  const excerpt = msgs.map((m) => `${nameOf(m)}: ${m.content.trim()}`).join("\n\n");

  let script: ComicScript;
  try {
    const r = await sendJson<{ ok: boolean; script?: ComicScript; error?: string }>("POST", "/api/image/comic-script", {
      people, excerpt, recap: chat.comic?.recap ?? "",
      ollamaBaseUrl: st.providerSettings.ollama.baseUrl, utilityModel: st.providerSettings.ollama.utilityModel,
    });
    if (!r.script) return { ok: false, error: r.error ?? "no script came back" };
    script = r.script;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const prompt = compileLayout(layoutComicPage(script, people, settings.style, PAGE));
  const base = imageSettingsForChat(chatId);
  const job = queueImage({
    ...base, workflow: COMIC_WORKFLOW, prompt, negativePrompt: COMIC_NEGATIVE,
    width: PAGE.width, height: PAGE.height, aspectRatio: "custom", batchCount: 1, loras: [], referenceImages: undefined,
  }, chatId);

  const last = msgs[msgs.length - 1];
  const title = script.title ? `“${script.title}”` : "Comic page";
  store().insertMessageAfter(chatId, chat.messages[chat.messages.length - 1].id, {
    chatId, role: "assistant", content: `${title}: ${script.panels.length} panels`, imageJobId: job.id,
  });
  const recap = [script.title, ...script.panels.map((p) => p.shot)].filter(Boolean).join(". ").slice(0, 600);
  store().setChatComic(chatId, { upTo: last.id, recap });
  const remaining = chat.messages.slice(chat.messages.findIndex((m) => m.id === last.id) + 1).filter(real).length;
  const onPage = new Set(script.panels.flatMap((p) => p.characters));
  const untagged = [...cast, ...(persona ? [persona] : [])].filter((w) => onPage.has(w.name) && !w.image?.tags?.trim()).map((w) => w.name);
  return { ok: true, panels: script.panels.length, left: remaining, ...(untagged.length ? { untagged } : {}) };
}

const store = () => useFableStore.getState();
