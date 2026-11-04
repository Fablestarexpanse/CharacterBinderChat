// ─── Encrypted secrets ────────────────────────────────────────────────────────
// API keys at rest. AES-256-GCM, so a tampered or wrong-key blob fails to
// decrypt rather than yielding garbage. Server-only.
//
// What this protects: the key no longer sits in plaintext in the SQLite file or
// in the browser's localStorage, so a copied database, a backup, or a shared
// data folder does not leak it. What it does not: anyone who can read BOTH the
// database and the key file (same folder by default) can decrypt it. Set
// FABLE_SECRET_KEY (64 hex chars) to keep the key off the disk entirely.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION = "v1";

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

/** Plaintext, or null when the blob is malformed, tampered with, or the key is wrong. */
export function decryptSecret(blob: string, key: Buffer): string | null {
  const [version, body] = blob.split(":", 2);
  if (version !== VERSION || !body) return null;
  try {
    const raw = Buffer.from(body, "base64");
    if (raw.length < 12 + 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The encryption key: FABLE_SECRET_KEY if set, otherwise a random one generated
 * on first use and kept beside the database with owner-only permissions.
 */
export function loadKey(dir: string, env: string | undefined = process.env.FABLE_SECRET_KEY): Buffer {
  if (env) {
    if (!/^[0-9a-f]{64}$/i.test(env)) throw new Error("FABLE_SECRET_KEY must be 64 hex characters (32 bytes)");
    return Buffer.from(env, "hex");
  }
  const file = path.join(dir, ".fable-secret");
  try {
    const hex = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
    throw new Error(`${file} is not a 64-character hex key — delete it to generate a new one (stored secrets will be lost)`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  fs.mkdirSync(dir, { recursive: true });
  const key = randomBytes(32);
  // wx: never overwrite a key another request just created
  fs.writeFileSync(file, key.toString("hex"), { mode: 0o600, flag: "wx" });
  return key;
}
