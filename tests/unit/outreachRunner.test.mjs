// Reading a chat for the outreach rules.

import { test } from "node:test";
import assert from "node:assert/strict";
const { chatSignals, sentToday, chatFor } = await import("../../lib/outreach/runner.ts");

const t = (h) => new Date(2026, 10, 5, h).toISOString();
const msg = (role, content, h, extra = {}) => ({ id: `${role}${h}`, chatId: "c", role, content, timestamp: t(h), ...extra });

test("signals: your last message, follow-ups since, and an open question", () => {
  const s = chatSignals({ messages: [msg("assistant", "Hi.", 9), msg("user", "Hey.", 10), msg("assistant", "Which stairwell?", 11)] });
  assert.equal(s.lastUserAt, Date.parse(t(10)));
  assert.equal(s.sinceLastUser, 0);
  assert.equal(s.unansweredQuestion, true);
  const f = chatSignals({ messages: [msg("user", "Hey.", 10), msg("assistant", "you there?", 12, { outreach: { trigger: "question", reason: "x" } }), msg("assistant", "hello?", 14, { outreach: { trigger: "question", reason: "x" } })] });
  assert.equal(f.sinceLastUser, 2);
  assert.equal(f.lastOutreachAt, Date.parse(t(14)));
  assert.equal(f.unansweredQuestion, false, "their own reaching out does not count as a question you owe");
  assert.equal(chatSignals({ messages: [msg("assistant", "Hi?", 9)] }).lastUserAt, null);
  assert.equal(chatSignals({ messages: [msg("user", "x", 9), msg("assistant", "ok?", 10, { error: true })] }).unansweredQuestion, false, "error notices are ignored");
});

test("today's count, across chats and per character", () => {
  const out = (h, who) => msg("assistant", "x", h, { characterId: who, outreach: { trigger: "promise", reason: "x" } });
  const chats = [{ messages: [out(9, "a"), out(11, "b")] }, { messages: [out(10, "a"), { ...out(1, "a"), timestamp: new Date(2026, 10, 4, 22).toISOString() }] }];
  assert.deepEqual(sentToday(chats, new Date(2026, 10, 5, 15), "a"), { all: 3, mine: 2 }, "yesterday's is not counted");
});

test("they reach out in their most recent one-to-one chat, never a group", () => {
  const chats = [
    { id: "old", characterId: "r", updatedAt: t(8), messages: [] },
    { id: "new", characterId: "r", updatedAt: t(12), messages: [] },
    { id: "group", characterId: "r", memberIds: ["r", "f"], updatedAt: t(14), messages: [] },
  ];
  assert.equal(chatFor(chats, { id: "r" }).id, "new");
  assert.equal(chatFor(chats, { id: "nobody" }), undefined);
});
