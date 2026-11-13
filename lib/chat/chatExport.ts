// ─── Exporting a chat ─────────────────────────────────────────────────────────
// A chat as a file you keep or take elsewhere, in the format that suits it:
//
//   html      a web page: reads and prints anywhere (print it to PDF), pictures inside it
//   markdown  text with formatting, for notes apps and editors
//   text      plain text
//   jsonl     SillyTavern's chat file, which other chat apps import
//   json      FableChat's own record: every message and field, and optionally its memory
//
// Pictures, clips and voice can go with it. The web page carries them inside
// itself; every other format with media becomes a .zip holding the file and a
// media/ folder. The builders here are pure (they take the media already
// fetched, as a map from URL to file), so they are unit-tested; fetching and
// downloading is exportChat at the bottom.

import type { CallEvent, Chat, Character, ImageJob, Message } from "@/lib/types";
import { callNote } from "@/lib/chat/channel";

export type ChatExportFormat = "html" | "markdown" | "text" | "jsonl" | "json";

export interface ChatExportOptions {
  format: ChatExportFormat;
  /** Pictures: photos sent in the chat and image cards */
  pictures: boolean;
  /** Clips (video) */
  clips: boolean;
  /** Replies spoken aloud (voice) */
  voice: boolean;
  /** FableChat format only: facts and Core Memory */
  memory: boolean;
}

export const FORMATS: Array<{ id: ChatExportFormat; label: string; ext: string; note: string }> = [
  { id: "html",     label: "Web page",          ext: "html",  note: "Opens in any browser; print it to make a PDF. Pictures are inside the page." },
  { id: "markdown", label: "Markdown",          ext: "md",    note: "Text with formatting, for notes apps and editors." },
  { id: "text",     label: "Plain text",        ext: "txt",   note: "Just the words." },
  { id: "jsonl",    label: "SillyTavern chat",  ext: "jsonl", note: "Imports into SillyTavern and apps that read its chat files." },
  { id: "json",     label: "FableChat (full)",  ext: "json",  note: "Everything FableChat holds about the chat, optionally with its memory." },
];

/** One piece of media in the chat, and the file it becomes */
export interface MediaItem {
  url: string;
  kind: "image" | "video" | "audio";
  /** media/<n>.<ext>, set once fetched */
  file?: string;
  /** data: URL for the web page, set once fetched */
  dataUrl?: string;
}

export interface ExportContext {
  chat: Chat;
  characters: Character[];
  imageJobs: ImageJob[];
  /** What you were called in the chat */
  userName: string;
}

/** One line of the transcript, already in words */
export interface Line {
  id: string;
  who: string;
  isUser: boolean;
  time: string;
  /** "by text", "on the phone" */
  how?: string;
  text: string;
  /** A call starting, ending, being missed */
  event?: string;
  media: Array<{ url: string; kind: MediaItem["kind"]; caption?: string }>;
}

/** "[phone call ends after 3 min]" → "Phone call ends after 3 min" */
const callText = (e: CallEvent) => { const t = callNote(e).replace(/^\[|\]$/g, ""); return t.charAt(0).toUpperCase() + t.slice(1); };

/** The chat as lines, in order, without failed or removed things */
export function transcript(ctx: ExportContext, opts: Pick<ChatExportOptions, "pictures" | "clips" | "voice">): Line[] {
  const nameOf = (m: Message) =>
    m.role === "user" ? ctx.userName
    : ctx.characters.find((c) => c.id === (m.characterId ?? ctx.chat.characterId))?.name ?? "Character";
  const lines: Line[] = [];
  for (const m of ctx.chat.messages) {
    if (m.error || m.role === "system") continue;
    const media: Line["media"] = [];
    for (const a of m.attachments ?? []) {
      if (a.status !== "ready" || !a.url) continue;
      if (a.kind === "image" && !opts.pictures) continue;
      if (a.kind === "video" && !opts.clips) continue;
      if (a.kind === "audio" && !opts.voice) continue;
      media.push({ url: a.url, kind: a.kind, caption: a.prompt });
    }
    if (m.imageJobId) {
      const job = ctx.imageJobs.find((j) => j.id === m.imageJobId);
      const wanted = job?.kind === "video" ? opts.clips : opts.pictures;
      if (!job || job.status !== "complete" || !wanted) continue;
      job.outputUrls.forEach((u, i) => media.push({ url: job.keptAs?.[i] ?? u, kind: job.kind === "video" ? "video" : "image", caption: job.prompt }));
      if (media.length === 0) continue;
    }
    if (opts.voice && m.speech?.url) media.push({ url: m.speech.url, kind: "audio", caption: "Spoken" });
    const event = m.callEvent ? callText(m.callEvent) : undefined;
    if (!event && !m.content.trim() && media.length === 0) continue;
    lines.push({
      id: m.id, who: nameOf(m), isUser: m.role === "user", time: m.timestamp,
      how: m.channel === "text" ? "by text" : m.channel === "call" && !m.callEvent ? "on the phone" : undefined,
      text: m.imageJobId ? "" : m.content, event, media,
    });
  }
  return lines;
}

/** Every media URL the lines use, once each */
export function mediaOf(lines: Line[]): MediaItem[] {
  const seen = new Map<string, MediaItem>();
  for (const l of lines) for (const m of l.media) if (!seen.has(m.url)) seen.set(m.url, { url: m.url, kind: m.kind });
  return [...seen.values()];
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-11-13 08:45": the same everywhere, no locale */
export function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fileSafe = (n: string) => n.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "chat";

const title = (ctx: ExportContext) => ctx.chat.name || "Chat";
const people = (ctx: ExportContext) => {
  const ids = ctx.chat.memberIds?.length ? ctx.chat.memberIds : ctx.chat.characterId ? [ctx.chat.characterId] : [];
  return ids.map((id) => ctx.characters.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
};

// ── Text formats ─────────────────────────────────────────────────────────────

export function toText(ctx: ExportContext, lines: Line[], media: Map<string, MediaItem>): string {
  const out = [title(ctx), `With ${[...people(ctx), ctx.userName].join(", ")}. Started ${stamp(ctx.chat.createdAt)}.`, ""];
  for (const l of lines) {
    if (l.event) { out.push(`[${l.event}, ${stamp(l.time)}]`, ""); continue; }
    out.push(`${l.who}${l.how ? ` (${l.how})` : ""}, ${stamp(l.time)}:`);
    if (l.text.trim()) out.push(l.text.trim());
    for (const m of l.media) out.push(`[${m.kind === "image" ? "picture" : m.kind === "video" ? "clip" : "voice"}${media.get(m.url)?.file ? `: ${media.get(m.url)!.file}` : ""}${m.caption && m.kind !== "audio" ? ` (${oneLine(m.caption)})` : ""}]`);
    out.push("");
  }
  return out.join("\n");
}

const oneLine = (s: string, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);

export function toMarkdown(ctx: ExportContext, lines: Line[], media: Map<string, MediaItem>): string {
  const out = [`# ${title(ctx)}`, "", `*With ${[...people(ctx), ctx.userName].join(", ")}. Started ${stamp(ctx.chat.createdAt)}.*`, ""];
  for (const l of lines) {
    if (l.event) { out.push(`> ${l.event}, ${stamp(l.time)}`, ""); continue; }
    out.push(`**${l.who}**${l.how ? ` *(${l.how})*` : ""} · ${stamp(l.time)}`, "");
    if (l.text.trim()) out.push(l.text.trim(), "");
    for (const m of l.media) {
      const file = media.get(m.url)?.file;
      const label = oneLine(m.caption ?? (m.kind === "audio" ? "Voice" : "Picture"), 120).replace(/[[\]]/g, "");
      if (!file) out.push(`*[${m.kind === "image" ? "picture" : m.kind === "video" ? "clip" : "voice"} not included]*`, "");
      else if (m.kind === "image") out.push(`![${label}](${file})`, "");
      else out.push(`[${m.kind === "video" ? "Clip" : "Voice"}: ${label}](${file})`, "");
    }
  }
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** *actions* in italics, the rest as written, line breaks kept */
const prose = (s: string) => esc(s.trim()).replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\n/g, "<br>");

export function toHtml(ctx: ExportContext, lines: Line[], media: Map<string, MediaItem>): string {
  const body = lines.map((l) => {
    if (l.event) return `<p class="event">${esc(l.event)} · ${esc(stamp(l.time))}</p>`;
    const items = l.media.map((m) => {
      const src = media.get(m.url)?.dataUrl ?? media.get(m.url)?.file;
      const cap = m.caption && m.kind !== "audio" ? `<figcaption>${esc(oneLine(m.caption, 300))}</figcaption>` : "";
      if (!src) return "";
      if (m.kind === "image") return `<figure><img src="${esc(src)}" alt="${esc(oneLine(m.caption ?? "Picture", 120))}">${cap}</figure>`;
      if (m.kind === "video") return `<figure><video src="${esc(src)}" controls></video>${cap}</figure>`;
      return `<audio src="${esc(src)}" controls></audio>`;
    }).join("");
    return `<article class="${l.isUser ? "you" : "them"}"><header><b>${esc(l.who)}</b>${l.how ? ` <i>${esc(l.how)}</i>` : ""} <time>${esc(stamp(l.time))}</time></header>${l.text.trim() ? `<p>${prose(l.text)}</p>` : ""}${items}</article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title(ctx))}</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf8;--fg:#1f1d1a;--muted:#6b665e;--you:#efe9ff;--them:#ffffff;--line:#e5e1da}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--fg:#ece8e1;--muted:#a39d93;--you:#2b2540;--them:#1f1e1c;--line:#34312d}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Georgia,"Times New Roman",serif}
main{max-width:720px;margin:0 auto;padding:32px 16px 64px}
h1{font:600 26px/1.3 system-ui,sans-serif;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 28px;font:14px system-ui,sans-serif}
article{background:var(--them);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:0 0 12px;break-inside:avoid}
article.you{background:var(--you)}header{font:13px system-ui,sans-serif;color:var(--muted);margin-bottom:4px}header b{color:var(--fg)}
p{margin:0}em{color:var(--muted)}.event{text-align:center;color:var(--muted);font:13px system-ui,sans-serif;margin:16px 0}
figure{margin:10px 0 0}img,video{max-width:100%;border-radius:8px;display:block}figcaption{font:12px system-ui,sans-serif;color:var(--muted);margin-top:4px}
audio{width:100%;margin-top:8px}@media print{body{background:#fff;color:#000}article{border-color:#ccc}audio,video{display:none}}
</style></head>
<body><main><h1>${esc(title(ctx))}</h1><p class="sub">With ${esc([...people(ctx), ctx.userName].join(", "))}. Started ${esc(stamp(ctx.chat.createdAt))}.</p>
${body}
</main></body></html>
`;
}

/** SillyTavern's chat file: a header line, then one line per message */
export function toSillyTavern(ctx: ExportContext, lines: Line[]): string {
  const character = people(ctx)[0] ?? "Character";
  const header = { user_name: ctx.userName, character_name: character, create_date: stamp(ctx.chat.createdAt), chat_metadata: {} };
  const rows = lines.filter((l) => !l.event && l.text.trim()).map((l) => ({
    name: l.who, is_user: l.isUser, is_system: false, send_date: stamp(l.time), mes: l.text.trim(), extra: {},
  }));
  return [header, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n";
}

export interface ChatMemory { facts?: unknown; coreMemory?: unknown }

/** FableChat's own record: the chat as stored, its characters' names, and (when asked) its memory */
export function toFableJson(ctx: ExportContext, media: Map<string, MediaItem>, memory?: ChatMemory): string {
  const files = Object.fromEntries([...media.values()].filter((m) => m.file).map((m) => [m.url, m.file]));
  return JSON.stringify({
    format: "fablechat-chat", version: 1, exportedAt: new Date().toISOString(),
    chat: ctx.chat,
    characters: Object.fromEntries(ctx.characters.filter((c) => ctx.chat.characterId === c.id || ctx.chat.memberIds?.includes(c.id)).map((c) => [c.id, c.name])),
    userName: ctx.userName,
    ...(Object.keys(files).length ? { mediaFiles: files } : {}),
    ...(memory ? { memory } : {}),
  }, null, 2);
}

// ── Fetching and downloading (browser) ───────────────────────────────────────

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/flac": "flac",
};

/** Our own assets are fetched directly; a ComfyUI output goes through the server's proxy (ComfyUI sends no CORS headers) */
export function fetchableUrl(url: string): string {
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    const q = new URLSearchParams(u.search);
    q.set("base", u.origin);
    return `/api/comfyui${u.pathname}?${q}`;
  } catch { return url; }
}

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export interface ExportResult { file: string; included: number; missing: number }

/** Build the chosen export and download it. */
export async function exportChat(ctx: ExportContext, opts: ChatExportOptions, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  const { writeZip } = await import("@/lib/cards/zipWrite");
  const lines = transcript(ctx, opts);
  const items = opts.format === "jsonl" ? [] : mediaOf(lines);
  const bytes = new Map<string, Uint8Array>();
  let missing = 0;
  for (const [i, m] of items.entries()) {
    onProgress?.(i, items.length);
    try {
      const res = await fetch(fetchableUrl(m.url));
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const ext = EXT[blob.type.split(";")[0]] ?? (m.kind === "image" ? "png" : m.kind === "video" ? "mp4" : "wav");
      m.file = `media/${String(i + 1).padStart(3, "0")}.${ext}`;
      if (opts.format === "html") m.dataUrl = await toDataUrl(blob);
      else bytes.set(m.file, new Uint8Array(await blob.arrayBuffer()));
    } catch { missing++; }
  }
  onProgress?.(items.length, items.length);
  const map = new Map(items.map((m) => [m.url, m]));

  let memory: ChatMemory | undefined;
  if (opts.format === "json" && opts.memory) {
    const q = `chatId=${encodeURIComponent(ctx.chat.id)}`;
    const character = ctx.characters.find((c) => c.id === ctx.chat.characterId);
    const [facts, core] = await Promise.all([
      fetch(`/api/drawer/facts?${q}&includeSuperseded=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      character ? fetch(`/api/chat/core-memory?${q}&characterId=${encodeURIComponent(character.id)}&name=${encodeURIComponent(character.name)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
    ]);
    memory = { facts, coreMemory: core };
  }

  const fmt = FORMATS.find((f) => f.id === opts.format)!;
  const text = opts.format === "html" ? toHtml(ctx, lines, map)
    : opts.format === "markdown" ? toMarkdown(ctx, lines, map)
    : opts.format === "text" ? toText(ctx, lines, map)
    : opts.format === "jsonl" ? toSillyTavern(ctx, lines)
    : toFableJson(ctx, map, memory);
  const base = `${fileSafe(title(ctx))}_${new Date().toISOString().slice(0, 10)}`;
  const main = `${base}.${fmt.ext}`;

  let blob: Blob, file: string;
  if (bytes.size > 0) {
    const zip = writeZip([{ name: main, data: new TextEncoder().encode(text) }, ...[...bytes].map(([name, data]) => ({ name, data }))]);
    blob = new Blob([zip as BlobPart], { type: "application/zip" });
    file = `${base}.zip`;
  } else {
    blob = new Blob([text], { type: opts.format === "html" ? "text/html" : opts.format === "json" ? "application/json" : "text/plain" });
    file = main;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { file, included: items.length - missing, missing };
}
