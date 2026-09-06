import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  // Fixed locale + UTC would drift from the user's clock; en-US with an
  // explicit shape keeps server and client output identical for a given
  // timestamp, which matters because these render during SSR.
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** "3h ago" for a millisecond age. The single implementation — callers differ
 *  only in the unit they start from (ISO strings vs Drawer 2's Unix seconds). */
export function formatAge(msAgo: number): string {
  if (msAgo < 60_000)     return "just now";
  if (msAgo < 3_600_000)  return `${Math.floor(msAgo / 60_000)}m ago`;
  if (msAgo < 86_400_000) return `${Math.floor(msAgo / 3_600_000)}h ago`;
  return `${Math.floor(msAgo / 86_400_000)}d ago`;
}

export function formatAgeFromIso(isoString: string): string {
  return formatAge(Date.now() - new Date(isoString).getTime());
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ─── Downloads ────────────────────────────────────────────────────────────────
// Browser-only. Saving through a blob makes the browser download rather than
// navigate — the app's image URLs are same-origin proxies, so a plain link
// would open them in place and lose the chat.

/** Save an in-memory blob under a filename. */
export function saveBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Fetch a URL and save it. Falls back to opening the URL when the fetch or
 * the blob save fails, so the user still reaches the file.
 */
export async function downloadFromUrl(url: string, filename: string): Promise<void> {
  try {
    saveBlob(await fetch(url).then((r) => r.blob()), filename);
  } catch {
    window.open(url, "_blank");
  }
}

// ─── Forbidden words ──────────────────────────────────────────────────────────
// Lives here rather than in lib/chat/settings.ts, which owns the rest of the
// preset rules: the store needs it too, and importing lib/chat from lib/store
// made those two directories depend on each other over this one helper.

/** Ban lists are capped and de-duped wherever they enter the store. */
export const MAX_FORBIDDEN_WORDS = 10;

export function normalizeForbiddenWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_FORBIDDEN_WORDS) break;
  }
  return out;
}
