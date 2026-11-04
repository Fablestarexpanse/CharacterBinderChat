// Encrypted API keys: they must round-trip, must not be readable from the
// stored blob, and must fail closed — wrong key or tampering gives null, never
// garbage that could be sent to a provider as a "key".

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const { encryptSecret, decryptSecret, loadKey } = await import("../../lib/server/secrets.ts");
const { FableStore } = await import("../../lib/db/store.ts");

test("a secret round-trips and the blob does not contain it", () => {
  const key = randomBytes(32);
  const blob = encryptSecret("sk-or-very-secret", key);
  assert.ok(!blob.includes("sk-or-very-secret"));
  assert.ok(!Buffer.from(blob.split(":")[1], "base64").toString("latin1").includes("very-secret"));
  assert.equal(decryptSecret(blob, key), "sk-or-very-secret");
});

test("the same secret encrypts differently every time", () => {
  const key = randomBytes(32);
  assert.notEqual(encryptSecret("x", key), encryptSecret("x", key));
});

test("wrong key, tampering and junk all fail closed", () => {
  const key = randomBytes(32);
  const blob = encryptSecret("sk-or-1", key);
  assert.equal(decryptSecret(blob, randomBytes(32)), null, "wrong key");
  const raw = Buffer.from(blob.split(":")[1], "base64");
  raw[raw.length - 1] ^= 1;
  assert.equal(decryptSecret(`v1:${raw.toString("base64")}`, key), null, "flipped bit");
  assert.equal(decryptSecret("garbage", key), null);
  assert.equal(decryptSecret("v2:AAAA", key), null, "unknown version");
  assert.equal(decryptSecret("v1:", key), null);
});

test("unicode survives", () => {
  const key = randomBytes(32);
  assert.equal(decryptSecret(encryptSecret("clé-🔑", key), key), "clé-🔑");
});

test("a key file is created once, owner-only, and reused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-secret-"));
  const a = loadKey(dir, undefined);
  const b = loadKey(dir, undefined);
  assert.deepEqual(a, b);
  assert.equal(a.length, 32);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dir, ".fable-secret")).mode & 0o777, 0o600);
  }
});

test("FABLE_SECRET_KEY is used instead of a file, and a malformed one is refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-secret-"));
  const hex = randomBytes(32).toString("hex");
  assert.equal(loadKey(dir, hex).toString("hex"), hex);
  assert.equal(fs.existsSync(path.join(dir, ".fable-secret")), false);
  assert.throws(() => loadKey(dir, "tooshort"), /64 hex/);
});

test("a corrupt key file is an error, not a silent new key that orphans stored secrets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-secret-"));
  fs.writeFileSync(path.join(dir, ".fable-secret"), "not hex");
  assert.throws(() => loadKey(dir, undefined), /not a 64-character hex key/);
});

test("the store keeps ciphertext only, and a delete removes it", () => {
  const store = new FableStore(":memory:");
  const key = randomBytes(32);
  store.setKv("secret:openrouterApiKey", encryptSecret("sk-or-abc", key));
  const row = store.db.prepare("SELECT value FROM app_kv WHERE key = 'secret:openrouterApiKey'").get();
  assert.ok(!row.value.includes("sk-or-abc"));
  assert.equal(decryptSecret(store.getKv("secret:openrouterApiKey"), key), "sk-or-abc");
  store.setKv("secret:openrouterApiKey", null);
  assert.equal(store.getKv("secret:openrouterApiKey"), null);
});

test("secrets are not part of the app-state export", () => {
  const store = new FableStore(":memory:");
  store.setKv("secret:openrouterApiKey", encryptSecret("sk-or-abc", randomBytes(32)));
  assert.ok(!JSON.stringify(store.getAppState()).includes("secret"));
});
