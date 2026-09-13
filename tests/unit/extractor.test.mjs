// Drawer 2 extraction, with the model stubbed. This is the only path that
// writes to the graph from untrusted model output, so what is asserted is the
// defence around it: ids the model minted get folded onto real entities, a
// reply that is not JSON writes nothing at all and says so, and facts in a
// group are stamped with exactly the members who were present.
//
// FABLE_DB_PATH is set before the first import because getStore() reads it
// once and caches the instance on globalThis.

process.env.FABLE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { extractMemory } = await import("../../lib/server/memoryExtractor.ts");
const { getStore }      = await import("../../lib/db/index.ts");

/**
 * Answer both requests extraction makes: a chat completion carrying `reply`
 * as JSON, and any embeddings call with a refusal, so the lexical fallback
 * runs (embeddings are optional infrastructure everywhere else too).
 */
function stubModel(reply) {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("embed")) return new Response("nope", { status: 503 });
    return new Response(JSON.stringify({ response: JSON.stringify(reply) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
}

let chatSeq = 0;
/** Each test gets its own chat id, since the store is shared and cached. */
const freshChat = () => `extract-${++chatSeq}`;

const task = (chatId, extra = {}) => ({
  chatId, characterId: "ash", characterName: "Ash", personaName: "Ronan",
  messages: [{ role: "user", content: "I hate deep water." }],
  providerType: "ollama", providerBaseUrl: "http://127.0.0.1:11434", modelId: "m",
  ...extra,
});

test("the player entity is named after the active persona", async () => {
  const chatId = freshChat();
  stubModel({ entities: [], facts: [], stat_changes: [] });

  const result = await extractMemory(task(chatId));

  assert.equal(result.ok, true);
  assert.equal(getStore().getEntity(chatId, "player").name, "Ronan",
    "the graph and the conversation labels must agree on who the user is");
  assert.equal(getStore().getEntity(chatId, "ash").name, "Ash");
});

test("a renamed persona renames the existing player entity rather than adding one", async () => {
  const chatId = freshChat();
  stubModel({ entities: [], facts: [], stat_changes: [] });
  await extractMemory(task(chatId));

  await extractMemory(task(chatId, { personaName: "Rhys" }));

  assert.equal(getStore().getEntity(chatId, "player").name, "Rhys");
  const players = getStore().listEntities(chatId).filter((e) => e.id === "player");
  assert.equal(players.length, 1, "no second player entity");
});

test("model-minted ids are folded onto the entity that already exists", async () => {
  const chatId = freshChat();
  // The extractor mints "ronan" for a person already stored as "player".
  stubModel({
    entities: [{ id: "ronan", type: "character", name: "Ronan" }],
    facts: [{ subject: "ronan", predicate: "fears", object: "deep water" }],
    stat_changes: [],
  });

  const result = await extractMemory(task(chatId));

  assert.ok(result.remapped.some((r) => r.startsWith("ronan->")),
    `expected ronan to be folded, got ${JSON.stringify(result.remapped)}`);
  assert.equal(getStore().getEntity(chatId, "ronan"), null,
    "a duplicate identity must not reach the graph");
  assert.ok(getStore().queryFacts(chatId, "player").some((f) => f.objectLiteral === "deep water"));
});

test("unparseable output writes nothing and says so", async () => {
  const chatId = freshChat();
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("embed")) return new Response("nope", { status: 503 });
    return new Response(JSON.stringify({ response: "I'm sorry, I can't help with that." }), { status: 200 });
  };

  const result = await extractMemory(task(chatId));

  assert.equal(result.ok, false);
  assert.match(result.error, /unparseable/);
  assert.ok(result.rawModel.length > 0, "the raw reply comes back so the failure can be read");
  assert.equal(getStore().queryFacts(chatId, "ash").length, 0);
});

test("an unreachable model is an upstream failure, not an extraction failure", async () => {
  const chatId = freshChat();
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };

  const result = await extractMemory(task(chatId));

  assert.equal(result.ok, false);
  assert.match(result.error, /could not be reached/,
    "the caller has to tell 'the model is down' from 'the model answered badly'");
});

test("a 1:1 chat writes public facts, a group stamps its witnesses", async () => {
  const solo = freshChat();
  stubModel({
    entities: [],
    facts: [{ subject: "ash", predicate: "fears", object: "deep water" }],
    stat_changes: [],
  });
  await extractMemory(task(solo));
  const publicFact = getStore().queryFacts(solo, "ash")[0];
  assert.ok(!publicFact.knownTo || publicFact.knownTo.length === 0,
    "a 1:1 fact is public — nobody is absent to keep it from");

  const group = freshChat();
  await extractMemory(task(group, {
    participants: [{ id: "ash", name: "Ash" }, { id: "player", name: "Ronan" }],
  }));
  const witnessed = getStore().queryFacts(group, "ash")[0];
  assert.deepEqual([...(witnessed.knownTo ?? [])].sort(), ["ash", "player"],
    "a group fact is known only to who was in the room");
});

test("participants are seeded as entities before the roster is built", async () => {
  const chatId = freshChat();
  stubModel({ entities: [], facts: [], stat_changes: [] });

  await extractMemory(task(chatId, {
    participants: [{ id: "kael", name: "Kael" }, { id: "bad" }, null],
  }));

  assert.equal(getStore().getEntity(chatId, "kael").name, "Kael");
  assert.equal(getStore().getEntity(chatId, "bad"), null,
    "a participant without a name is not a participant");
});

test("stat changes land through deltaStat, so the non-linear rules still apply", async () => {
  const chatId = freshChat();
  stubModel({
    entities: [],
    facts: [],
    stat_changes: [{ observer: "ash", target: "player", stat: "trust", delta: 10 }],
  });

  const result = await extractMemory(task(chatId));

  assert.deepEqual(result.stats, ["ash->player:trust(+10)"],
    "the result names the change rather than counting it");
  const stat = getStore().getStat(chatId, "ash", "player", "trust");
  assert.ok(stat && stat.value > 0, "the row exists and moved in the right direction");
});

test("a mood stat change is refused — mood belongs to Drawer 1", async () => {
  const chatId = freshChat();
  stubModel({
    entities: [],
    facts: [],
    stat_changes: [{ observer: "ash", target: "player", stat: "mood", delta: -11 }],
  });

  await extractMemory(task(chatId));

  assert.equal(getStore().getStat(chatId, "ash", "player", "mood"), null,
    "the extractor writing mood put a stray -11 in a soak run once");
});
