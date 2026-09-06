// Who is in the scene, in a group chat. presentMemberIds is small and it is
// read by the prompt builder, the speaker picker and the extractor's witness
// stamping, so an absent member leaking back into the list means a character
// speaks who is not there and, worse, "remembers" a scene they missed.

import { test } from "node:test";
import assert from "node:assert/strict";

const { presentMemberIds } = await import("../../lib/chat/generation.ts");

const chat = (fields) => ({ id: "c1", messages: [], ...fields });

test("a 1:1 chat has no members list at all", () => {
  assert.deepEqual(presentMemberIds(chat({ characterId: "ash" })), [],
    "[] is the signal for 'not a group', not an empty group");
  assert.deepEqual(presentMemberIds(chat({ memberIds: ["ash"] })), [],
    "one member is still a 1:1 conversation");
});

test("a group lists its members in order", () => {
  assert.deepEqual(presentMemberIds(chat({ memberIds: ["ash", "kael", "fen"] })),
    ["ash", "kael", "fen"]);
});

test("absent members drop out of the scene", () => {
  const group = chat({ memberIds: ["ash", "kael", "fen"], absentIds: ["kael"] });
  assert.deepEqual(presentMemberIds(group), ["ash", "fen"]);
});

test("an absent id that is not a member is ignored", () => {
  const group = chat({ memberIds: ["ash", "kael"], absentIds: ["someone-else"] });
  assert.deepEqual(presentMemberIds(group), ["ash", "kael"]);
});

test("marking everyone absent still reports what the list says", () => {
  // The guard against emptying a scene lives in toggleMemberPresence; this
  // function reports state rather than defending it, and the two should not
  // both try to be the rule.
  const group = chat({ memberIds: ["ash", "kael"], absentIds: ["ash", "kael"] });
  assert.deepEqual(presentMemberIds(group), []);
});
