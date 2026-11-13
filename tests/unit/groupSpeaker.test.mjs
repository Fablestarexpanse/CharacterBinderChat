// Group chats: whoever you name answers, by first name or full name; otherwise turns rotate.

import { test } from "node:test";
import assert from "node:assert/strict";

const { nextSpeakerId } = await import("../../lib/chat/generation.ts");

const characters = [
  { id: "elias", name: "Elias Brandt", description: "", tags: [], createdAt: "", updatedAt: "" },
  { id: "june", name: "June Okafor", description: "", tags: [], createdAt: "", updatedAt: "" },
];
const chat = (lastUser, lastSpeaker = "elias") => ({
  id: "g", name: "g", memberIds: ["elias", "june"], absentIds: [], createdAt: "", updatedAt: "",
  messages: [
    { id: "1", chatId: "g", role: "assistant", characterId: lastSpeaker, content: "…", timestamp: "" },
    { id: "2", chatId: "g", role: "user", content: lastUser, timestamp: "" },
  ],
});

test("a first name alone picks who answers, and the earliest name wins", () => {
  assert.equal(nextSpeakerId(chat("Elias, who's Anna? June said she'd approve."), characters), "elias");
  assert.equal(nextSpeakerId(chat("June, is the station okay?", "june"), characters), "june");
  assert.equal(nextSpeakerId(chat("Thanks, Elias Brandt."), characters), "elias");
});

test("a name inside another word does not count, and no name means taking turns", () => {
  assert.equal(nextSpeakerId(chat("It's a Junebug kind of night."), characters), "june", "Junebug is not June: Elias spoke last, so June's turn");
  assert.equal(nextSpeakerId(chat("Junebug again", "june"), characters), "elias");
});
