// ─── Local embeddings ─────────────────────────────────────────────────────────
// Semantic vectors for memory retrieval, from a local Ollama instance
// (nomic-embed-text by default). Local-first: no cloud calls, no key.
//
// Everything degrades gracefully: if Ollama is missing or the model isn't
// pulled, callers get null and retrieval falls back to lexical overlap.
// Availability is cached briefly so a downed Ollama doesn't add latency to
// every exchange.
//
// Vectors are L2-normalized at creation, so cosine similarity is a dot product.


let unavailableUntil = 0;
const RETRY_AFTER_MS = 60_000;

function normalize(v: number[]): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

/**
 * Embed a batch of texts. Returns null (never throws) when embeddings are
 * unavailable — callers must treat null as "use the lexical fallback".
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[] | null> {
  if (texts.length === 0) return [];
  if (Date.now() < unavailableUntil) return null;

  // Read per call, not at import: a module constant snapshots whatever the
  // environment was when the module first loaded, which in dev is whenever a
  // hot reload happened to pull it in. getStore() reads FABLE_DB_PATH the same
  // way.
  const embedUrl   = process.env.OLLAMA_EMBED_URL ?? "http://127.0.0.1:11434";
  const embedModel = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

  try {
    const res = await fetch(`${embedUrl}/api/embed`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model: embedModel, input: texts }),
      signal:  AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
      throw new Error("embed response shape mismatch");
    }
    return data.embeddings.map(normalize);
  } catch {
    unavailableUntil = Date.now() + RETRY_AFTER_MS;
    return null;
  }
}

export async function embedText(text: string): Promise<Float32Array | null> {
  const r = await embedTexts([text]);
  return r?.[0] ?? null;
}

/** Dot product of two normalised vectors = cosine similarity. */
export function cosine(a: Float32Array, b: Float32Array): number {
  // Dimension mismatch (e.g. the embed model changed under stored vectors)
  // must read as "no similarity", not a silently-truncated dot product —
  // wrong similarities feed the 0.92 fold threshold and retrieval ranking.
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function bufferToVec(buf: Buffer | Uint8Array | null): Float32Array | null {
  if (!buf || buf.byteLength === 0 || buf.byteLength % 4 !== 0) return null;
  const u8 = buf instanceof Buffer ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf;
  // Copy so the view is aligned and independent of the SQLite buffer
  return new Float32Array(u8.slice().buffer);
}

export function vecToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Cosine similarity rescaled onto roughly the 0..1 band lexical overlap
 * produces, so a corpus with some embedded rows and some not ranks sanely.
 * Real cosines here sit around 0.3..0.9.
 */
export function embeddingRelevance(query: Float32Array, row: Float32Array | undefined): number {
  if (!row) return 0;
  return Math.max(0, (cosine(query, row) - 0.3) / 0.6);
}
