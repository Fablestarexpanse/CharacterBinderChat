// ─── Attachments being made in this tab ───────────────────────────────────────
// A photo or clip is made by a promise in the open tab. A reload kills that
// promise but the attachment stays "pending" in the chat, so its card would
// spin forever. The card asks here instead: pending and not being made in this
// tab means it was interrupted, and it offers Try again. Module-local on
// purpose, like generation's AbortController: it describes this page only.

const making = new Set<string>();

/** Run `work` with the attachment marked as being made. */
export async function whileMaking<T>(attachmentId: string, work: () => Promise<T>): Promise<T> {
  making.add(attachmentId);
  try { return await work(); } finally { making.delete(attachmentId); }
}

export const isMaking = (attachmentId: string) => making.has(attachmentId);
