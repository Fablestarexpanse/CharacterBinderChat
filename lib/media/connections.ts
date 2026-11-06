// ─── Media connections ────────────────────────────────────────────────────────
// The services that make images, video and speech, and turn speech into text.
// Pure and client-safe: the shape, the catalogue of supported services and the
// validation. Storage and the real calls are server-side
// (lib/server/mediaConnections.ts), because media keys never go to the browser:
// every media request goes through the FableChat server.

export type MediaKind = "image" | "video" | "voice" | "stt";

/** What a connection is chosen *for*. Each purpose has one default connection. */
export type MediaPurpose = "portrait" | "photo" | "scene" | "video" | "voice" | "stt";

export type MediaProviderId = "comfyui" | "openai-image" | "openai-speech" | "vibevoice" | "elevenlabs" | "openai-stt";

export interface MediaProviderInfo {
  id: MediaProviderId;
  label: string;
  kinds: MediaKind[];
  /** Shown under the name in the picker */
  blurb: string;
  defaultBaseUrl: string;
  /** Whether a key is required (false = optional, e.g. local servers) */
  keyRequired: boolean;
  /** Which optional fields the form shows */
  fields: Array<"model" | "voice">;
  modelPlaceholder?: string;
  voicePlaceholder?: string;
  /** Where to find out more / get a key */
  help: string;
}

export const MEDIA_PROVIDERS: readonly MediaProviderInfo[] = [
  {
    id: "comfyui", label: "ComfyUI", kinds: ["image", "video"],
    blurb: "Local image and video generation through your own workflows.",
    defaultBaseUrl: "http://127.0.0.1:8188", keyRequired: false, fields: [],
    help: "Start ComfyUI and use its address. Workflows are chosen on the Workflows screen.",
  },
  {
    id: "openai-image", label: "OpenAI-compatible images", kinds: ["image"],
    blurb: "Any service with an OpenAI-style /images API: OpenAI's image models and the many that copy it.",
    defaultBaseUrl: "https://api.openai.com/v1", keyRequired: true, fields: ["model"],
    modelPlaceholder: "gpt-image-1",
    help: "Use the service's base URL ending in /v1 and an API key from its dashboard.",
  },
  {
    id: "vibevoice", label: "VibeVoice (local)", kinds: ["voice"],
    blurb: "FableChat's own voice server: VibeVoice on your GPU, speaking in any voice from a short sample. Set it up below with Download and set up; FableChat starts and stops it.",
    defaultBaseUrl: "http://127.0.0.1:7861/v1", keyRequired: false, fields: ["voice"],
    voicePlaceholder: "demo:en-Alice_woman, or one of yours",
    help: "Built from SanDiegoDude/VibeVoice (MIT). Microsoft's VibeVoice is for research use; only add voices you have the right to use.",
  },
  {
    id: "openai-speech", label: "OpenAI-compatible speech", kinds: ["voice"],
    blurb: "Text to speech through an OpenAI-style /audio/speech API. Works with OpenAI and with local voice servers that copy the API.",
    defaultBaseUrl: "http://127.0.0.1:8880/v1", keyRequired: false, fields: ["model", "voice"],
    modelPlaceholder: "tts-1, kokoro, …", voicePlaceholder: "alloy, af_bella, …",
    help: "A local server needs no key. For OpenAI use https://api.openai.com/v1 and a key.",
  },
  {
    id: "elevenlabs", label: "ElevenLabs", kinds: ["voice"],
    blurb: "Cloud voices, including cloned ones.",
    defaultBaseUrl: "https://api.elevenlabs.io/v1", keyRequired: true, fields: ["model", "voice"],
    modelPlaceholder: "eleven_multilingual_v2", voicePlaceholder: "a voice id from your voice library",
    help: "Keys and voice ids are in your ElevenLabs profile.",
  },
  {
    id: "openai-stt", label: "OpenAI-compatible speech-to-text", kinds: ["stt"],
    blurb: "Any /audio/transcriptions API: OpenAI, Groq, or a local Whisper server.",
    defaultBaseUrl: "http://127.0.0.1:8000/v1", keyRequired: false, fields: ["model"],
    modelPlaceholder: "whisper-1, Systran/faster-whisper-small, …",
    help: "A local Whisper server needs no key.",
  },
];

export const KIND_LABEL: Record<MediaKind, string> = {
  image: "Images", video: "Video", voice: "Voice", stt: "Speech to text",
};

export const PURPOSES: ReadonlyArray<{ id: MediaPurpose; kind: MediaKind; label: string; hint: string }> = [
  { id: "portrait", kind: "image", label: "Portraits", hint: "Character and persona avatars" },
  { id: "photo", kind: "image", label: "Photo messages", hint: "Photos a character sends you" },
  { id: "scene", kind: "image", label: "Scene images", hint: "/image and Image Studio" },
  { id: "video", kind: "video", label: "Video messages", hint: "Short clips animated from a still" },
  { id: "voice", kind: "voice", label: "Voice", hint: "Voice notes and reading replies aloud" },
  { id: "stt", kind: "stt", label: "Speech to text", hint: "Speaking instead of typing" },
];

export interface MediaConnection {
  id: string;
  name: string;
  kind: MediaKind;
  provider: MediaProviderId;
  baseUrl: string;
  model?: string;
  voice?: string;
}

/** What the server sends the browser: never the key, only whether one is set. */
export interface MediaConnectionView extends MediaConnection { hasKey: boolean }

export type MediaDefaults = Partial<Record<MediaPurpose, string>>;

export const providerInfo = (id: MediaProviderId): MediaProviderInfo | undefined => MEDIA_PROVIDERS.find((p) => p.id === id);

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Checked on the server before anything is stored, and in the form before
 * saving. Returns the cleaned connection or the reasons it was refused.
 */
export function validateConnection(raw: unknown): { ok: true; value: MediaConnection } | { ok: false; errors: string[] } {
  const c = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
  const id = str("id"), name = str("name"), baseUrl = str("baseUrl").replace(/\/+$/, "");
  const provider = providerInfo(str("provider") as MediaProviderId);
  const kind = str("kind") as MediaKind;
  if (!ID.test(id)) errors.push("The id must be lower-case letters, digits and dashes.");
  if (!name) errors.push("Give the connection a name.");
  if (name.length > 80) errors.push("The name is too long.");
  if (!provider) errors.push("Choose a supported service.");
  else if (!provider.kinds.includes(kind)) errors.push(`${provider.label} cannot be used for ${KIND_LABEL[kind] ?? "that"}.`);
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") errors.push("The address must start with http:// or https://.");
  } catch {
    errors.push("The address is not a valid URL.");
  }
  if (errors.length) return { ok: false, errors };
  const model = str("model"), voice = str("voice");
  return {
    ok: true,
    value: {
      id, name, kind, provider: provider!.id, baseUrl,
      ...(model && provider!.fields.includes("model") ? { model } : {}),
      ...(voice && provider!.fields.includes("voice") ? { voice } : {}),
    },
  };
}

/** A default may only point at an existing connection of the purpose's kind. */
export function cleanDefaults(defaults: unknown, connections: MediaConnection[]): MediaDefaults {
  const out: MediaDefaults = {};
  const d = (defaults ?? {}) as Record<string, unknown>;
  for (const p of PURPOSES) {
    const id = d[p.id];
    if (typeof id === "string" && connections.some((c) => c.id === id && c.kind === p.kind)) out[p.id] = id;
  }
  return out;
}

/** The connection to use for a purpose: its default, else the first of that kind. */
export function connectionFor(purpose: MediaPurpose, connections: MediaConnection[], defaults: MediaDefaults): MediaConnection | null {
  const kind = PURPOSES.find((p) => p.id === purpose)!.kind;
  return connections.find((c) => c.id === defaults[purpose] && c.kind === kind)
    ?? connections.find((c) => c.kind === kind) ?? null;
}
