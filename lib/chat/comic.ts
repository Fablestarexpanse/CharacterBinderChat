// ─── Comic-it ─────────────────────────────────────────────────────────────────
// "Comic it" in a chat makes one comic page of what happened since the last
// page: the background model writes the panel script (/api/image/comic-script),
// lib/media/comicPage.ts lays it out and compiles it to a MOSS-Image Layout,
// and the page is drawn with the MOSS workflow at 1024x1536, placed as a page
// card after the last message. Off unless switched on in Settings → Media →
// Comic-it (/api/comic). Running notes and open issues: docs/comic-it.md.
//
// What is kept, and where:
// - each page card (message.comic): the stretch it covers (fromId..upToId), the
//   recap before and after it, the script, and the finished page as an asset;
// - the chat (chat.comic): where the last page ended, its recap, who "you" were
//   on the first page, and the looks of recurring people outside the cast.
// The boundary survives a deleted message (the last page card's position is
// used), a branch (lib/chat/branch.ts remaps it) and a deleted page (the
// chats slice moves it back to the page before).

import { useFableStore } from "@/lib/store";
import { getJson, sendJson } from "@/lib/api/client";
import { imageSettingsForChat, queueImage } from "@/lib/chat/imageGen";
import { waitForJob } from "@/lib/chat/photos";
import { storePicture } from "@/lib/chat/assets";
import { historyContent } from "@/lib/chat/channel";
import {
  COMIC_NEGATIVE, MAX_EXTRAS, PAGE, compileLayout, layoutComicPage, lookFromDescription,
  type ComicPerson, type ComicScript,
} from "@/lib/media/comicPage";
import type { ImageLook } from "@/lib/media/imageLook";
import type { Chat, ComicPageInfo, Message } from "@/lib/types";

/** The bundled MOSS-Image workflow (workflows/moss-photo.json): it letters boxed text well and takes MOSS LoRAs */
export const COMIC_WORKFLOW = "moss-photo";
/** At most this many messages go into one page; the rest are left for the page after */
const MAX_MESSAGES = 16;
/**
 * And at most this much text: the script model reads up to 8k tokens, the
 * instructions and the answer take about a third, and a page's worth of long
 * role-play replies can fill the rest. The earliest messages go first.
 */
const MAX_EXCERPT_CHARS = 14_000;

export interface ComicSettings { enabled: boolean; style: string; styleLora?: { name: string; weight: number } }

let cache: { at: number; value: ComicSettings } | null = null;
export async function comicSettings(): Promise<ComicSettings> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  try {
    const value = await getJson<ComicSettings>("/api/comic");
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? { enabled: false, style: "" };
  }
}
export const forgetComicSettings = () => { cache = null; };

const real = (m: Message) => !m.error && !m.imageJobId && !m.callEvent && !m.comic && m.content.trim().length > 0;

/** Index of the first message the next page covers */
export function nextPageStart(chat: Pick<Chat, "messages" | "comic">): number {
  if (chat.comic?.upTo) {
    const i = chat.messages.findIndex((m) => m.id === chat.comic!.upTo);
    if (i !== -1) return i + 1;
  }
  // The boundary message is gone (deleted, re-rolled): a page card sits right after what it covered
  for (let i = chat.messages.length - 1; i >= 0; i--) if (chat.messages[i].comic) return i + 1;
  return 0;
}

/** The messages the next page covers: after the last page, earliest first, within MAX_MESSAGES and MAX_EXCERPT_CHARS */
export function messagesSinceLastPage(chat: Pick<Chat, "messages" | "comic">): Message[] {
  const out: Message[] = [];
  let chars = 0;
  for (const m of chat.messages.slice(nextPageStart(chat)).filter(real)) {
    const len = m.content.length + 40;
    if (out.length >= MAX_MESSAGES || (out.length > 0 && chars + len > MAX_EXCERPT_CHARS)) break;
    out.push(m);
    chars += len;
  }
  return out;
}

/** untagged: people on the page with no image tags (drawn from their description, less consistently) */
export interface ComicResult { ok: boolean; error?: string; panels?: number; left?: number; untagged?: string[] }

type Who = { id: string; name: string; description?: string; image?: ImageLook };

/** How someone is drawn on a page: their comic LoRA's trigger word, then their tags (or their description's look) */
export const lookOf = (who: Who) => {
  const base = who.image?.tags?.trim() || lookFromDescription(who.description ?? "") || "a person";
  const trigger = who.image?.comicLora?.trigger?.trim();
  return trigger ? `${trigger}, ${base}` : base;
};

/** Everything a page needs that does not depend on the script */
function pageContext(chat: Chat) {
  const st = useFableStore.getState();
  const personaId = chat.comic?.personaId ?? st.activePersonaId ?? undefined;
  const persona = st.personas.find((p) => p.id === personaId);
  const memberIds = chat.memberIds?.length ? chat.memberIds : chat.characterId ? [chat.characterId] : [];
  const cast = memberIds.map((id) => st.characters.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const extras = chat.comic?.extras ?? [];
  const people: Array<ComicPerson & { role: "character" | "you" | "extra" }> = [
    ...cast.map((c) => ({ name: c.name, look: lookOf(c), role: "character" as const })),
    ...(persona ? [{ name: persona.name, look: lookOf(persona), role: "you" as const }] : []),
    ...extras.map((e) => ({ name: e.name, look: e.look, role: "extra" as const })),
  ];
  const nameOf = (m: Message) => m.role === "user" ? persona?.name ?? "You"
    : st.characters.find((c) => c.id === (m.characterId ?? chat.characterId))?.name ?? "Character";
  const whoOnPage = [...cast, ...(persona ? [persona] : [])] as Who[];
  return { st, persona, personaId, cast, people, nameOf, whoOnPage };
}

/** The LoRAs for a page: the style LoRA, then the comic LoRA of everyone on it */
function pageLoras(settings: ComicSettings, whoOnPage: Who[], script: ComicScript) {
  const onPage = new Set(script.panels.flatMap((p) => p.characters));
  const people = whoOnPage
    .filter((w) => onPage.has(w.name) && w.image?.comicLora?.name)
    .map((w) => ({ name: w.image!.comicLora!.name, weight: w.image!.comicLora!.weight ?? 1 }));
  const all = [...(settings.styleLora ? [settings.styleLora] : []), ...people];
  return all.filter((l, i) => all.findIndex((x) => x.name === l.name) === i);
}

/** Ask the background model for a page script */
async function writeScript(chat: Chat, msgs: Message[], recap: string): Promise<{ script?: ComicScript; error?: string; ctx: ReturnType<typeof pageContext> }> {
  const ctx = pageContext(chat);
  // Texts and calls keep their "(by text)" / "(on the phone)", so they are not drawn as one room
  const excerpt = msgs.map((m) => `${ctx.nameOf(m)}: ${historyContent(m)}`).join("\n\n");
  try {
    const r = await sendJson<{ ok: boolean; script?: ComicScript; error?: string }>("POST", "/api/image/comic-script", {
      people: ctx.people, excerpt, recap,
      ollamaBaseUrl: ctx.st.providerSettings.ollama.baseUrl, utilityModel: ctx.st.providerSettings.ollama.utilityModel,
    });
    return r.script ? { script: r.script, ctx } : { error: r.error ?? "no script came back", ctx };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ctx };
  }
}

/** Queue the drawing of a script, with everyone's looks and the page's LoRAs */
function drawScript(chatId: string, script: ComicScript, ctx: ReturnType<typeof pageContext>, settings: ComicSettings) {
  const people = [...ctx.people, ...(script.extras ?? []).map((e) => ({ ...e, role: "extra" as const }))];
  const prompt = compileLayout(layoutComicPage(script, people, settings.style, PAGE));
  return queueImage({
    ...imageSettingsForChat(chatId), workflow: COMIC_WORKFLOW, prompt, negativePrompt: COMIC_NEGATIVE,
    width: PAGE.width, height: PAGE.height, aspectRatio: "custom", batchCount: 1,
    loras: pageLoras(settings, ctx.whoOnPage, script), referenceImages: undefined,
  }, chatId);
}

/** Once the page is drawn, keep it as an asset on the card, so it outlives ComfyUI's output folder */
function keepWhenDrawn(chatId: string, messageId: string, jobId: string) {
  void (async () => {
    const done = await waitForJob(jobId);
    if (done.status !== "complete" || !done.outputUrls[0]) return;
    try {
      const page = await storePicture(done.outputUrls[0]);
      const msg = store().chats.find((c) => c.id === chatId)?.messages.find((m) => m.id === messageId);
      if (msg?.comic && msg.imageJobId === jobId) store().setMessageComic(chatId, messageId, { comic: { ...msg.comic, page } });
    } catch (e) {
      console.warn("[comic] could not keep the page:", e instanceof Error ? e.message : e);
    }
  })();
}

const titleOf = (script: ComicScript) => `${script.title ? `“${script.title}”` : "Comic page"}: ${script.panels.length} panels`;
const recapOf = (script: ComicScript) => [script.title, ...script.panels.map((p) => p.shot)].filter(Boolean).join(". ").slice(0, 600);

/** Merge new recurring people into the chat's list, keeping the first look each was given */
function mergeExtras(old: Array<{ name: string; look: string }> | undefined, added: ComicPerson[] | undefined) {
  const out = [...(old ?? [])];
  for (const e of added ?? []) if (!out.some((x) => x.name.toLowerCase() === e.name.toLowerCase())) out.push(e);
  return out.slice(-MAX_EXTRAS * 2);
}

/** Make the next comic page for this chat. Resolves once the page is queued (drawing continues in the card). */
export async function makeComicPage(chatId: string): Promise<ComicResult> {
  const settings = await comicSettings();
  if (!settings.enabled) return { ok: false, error: "Comic-it is off (Settings → Media → Comic-it)." };
  const chat = store().chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: "chat not found" };
  const msgs = messagesSinceLastPage(chat);
  if (msgs.length === 0) return { ok: false, error: "Nothing new since the last comic page." };

  const recapBefore = chat.comic?.recap ?? "";
  const { script, error, ctx } = await writeScript(chat, msgs, recapBefore);
  if (!script) return { ok: false, error };
  const job = drawScript(chatId, script, ctx, settings);

  const first = msgs[0], last = msgs[msgs.length - 1];
  const info: ComicPageInfo = {
    title: script.title ?? "Comic page", panels: script.panels.length, fromId: first.id, upToId: last.id,
    recapBefore, recap: recapOf(script), script,
  };
  const now = store().chats.find((c) => c.id === chatId)!;
  const cardId = store().insertMessageAfter(chatId, now.messages[now.messages.length - 1].id, {
    chatId, role: "assistant", content: titleOf(script), imageJobId: job.id, comic: info,
  });
  store().setChatComic(chatId, {
    upTo: last.id, recap: info.recap,
    personaId: ctx.personaId, extras: mergeExtras(chat.comic?.extras, script.extras),
  });
  keepWhenDrawn(chatId, cardId, job.id);

  const lastIndex = now.messages.findIndex((m) => m.id === last.id);
  const left = now.messages.slice(lastIndex + 1).filter(real).length;
  const onPage = new Set(script.panels.flatMap((p) => p.characters));
  const untagged = ctx.whoOnPage.filter((w) => onPage.has(w.name) && !w.image?.tags?.trim()).map((w) => w.name);
  return { ok: true, panels: script.panels.length, left, ...(untagged.length ? { untagged } : {}) };
}

/**
 * A page again, for the same stretch of the story. "script": a new script and a
 * new drawing; "draw": the same script drawn again (a new seed, the current
 * looks, LoRAs and style). The card is updated in place.
 */
export async function redoComicPage(chatId: string, messageId: string, mode: "script" | "draw"): Promise<{ ok: boolean; error?: string }> {
  const settings = await comicSettings();
  const chat = store().chats.find((c) => c.id === chatId);
  const card = chat?.messages.find((m) => m.id === messageId);
  if (!chat || !card?.comic) return { ok: false, error: "That page is no longer here." };
  let script = card.comic.script as ComicScript;
  let ctx = pageContext(chat);
  if (mode === "script") {
    const from = chat.messages.findIndex((m) => m.id === card.comic!.fromId);
    const to = chat.messages.findIndex((m) => m.id === card.comic!.upToId);
    if (from === -1 || to === -1) return { ok: false, error: "Some of the messages this page covered are gone, so it can't be rewritten. Re-draw it, or delete it and make a new page." };
    const msgs = chat.messages.slice(from, to + 1).filter(real);
    const r = await writeScript(chat, msgs, card.comic.recapBefore);
    if (!r.script) return { ok: false, error: r.error };
    script = r.script;
    ctx = r.ctx;
  }
  const job = drawScript(chatId, script, ctx, settings);
  const info: ComicPageInfo = { ...card.comic, title: script.title ?? "Comic page", panels: script.panels.length, recap: recapOf(script), script, page: undefined };
  store().setMessageComic(chatId, messageId, { comic: info, content: titleOf(script), imageJobId: job.id });
  // The latest page's recap is what the next page continues from
  const latest = store().chats.find((c) => c.id === chatId)?.comic;
  if (mode === "script" && latest?.upTo === card.comic.upToId) store().setChatComic(chatId, { ...latest, recap: info.recap, extras: mergeExtras(latest.extras, script.extras) });
  keepWhenDrawn(chatId, messageId, job.id);
  return { ok: true };
}

const store = () => useFableStore.getState();
