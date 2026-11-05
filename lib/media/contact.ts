// ─── Contact & media settings ─────────────────────────────────────────────────
// The master switches for everything in docs/plan-contact-media.md. Off until
// the user turns them on: while `enabled` is false nothing generates, sends or
// reaches out, and no prompt tells the model it could. Stored on the server
// (app_kv) so a later server-side outreach reads the same switches.

export interface ContactSettings {
  /** Master switch: Settings → Contact & media */
  enabled: boolean;
  /** Show each media prompt for approval before anything is generated */
  reviewMedia: boolean;
}

export const DEFAULT_CONTACT: ContactSettings = { enabled: false, reviewMedia: true };

export function cleanContactSettings(raw: unknown): ContactSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    reviewMedia: r.reviewMedia !== false,
  };
}

/** Per character, on the character row. Not a card field: it is the user's choice, not the card's. */
export interface CharacterContact {
  /** May send you photos of themselves */
  photos?: boolean;
}

/** May this character offer photos? Both switches, and nothing else, decide. */
export const mayOfferPhotos = (settings: ContactSettings, who: { contact?: CharacterContact } | undefined) =>
  settings.enabled && !!who?.contact?.photos;
