// When characters reach out: hard limits first, then a reason.

import { test } from "node:test";
import assert from "node:assert/strict";
const { decideOutreach, inQuietHours, toMinutes, fromMinutes } = await import("../../lib/outreach/rules.ts");

const at = (h, m = 0) => new Date(2026, 10, 5, h, m);
const S = { enabled: true, paused: false, userStatus: "available", quietStart: 23 * 60, quietEnd: 8 * 60, dailyLimit: 3 };
const C = { canContact: true, mode: "story" };
const quiet = (hoursAgo, extra = {}) => ({ lastUserAt: at(15).getTime() - hoursAgo * 3_600_000, sinceLastUser: 0, lastOutreachAt: null, unansweredQuestion: false, openPromise: null, ruptureNote: null, ...extra });
const none = { all: 0, mine: 0 };

test("every hard limit stops it, whatever the story says", () => {
  const ch = quiet(5, { openPromise: "get you on the shuttle" });
  assert.equal(decideOutreach(at(15), S, C, ch, none).send, true, "control: it would send");
  for (const [why, s, c, chat, sent, now] of [
    ["master off", { ...S, enabled: false }, C, ch, none, at(15)],
    ["paused", { ...S, paused: true }, C, ch, none, at(15)],
    ["do not disturb", { ...S, userStatus: "dnd" }, C, ch, none, at(15)],
    ["character not allowed", S, { ...C, canContact: false }, ch, none, at(15)],
    ["no character settings", S, undefined, ch, none, at(15)],
    ["quiet hours", S, C, quiet(5, { openPromise: "x", lastUserAt: at(23, 30).getTime() - 5 * 3_600_000 }), none, at(23, 30)],
    ["global limit", S, C, ch, { all: 3, mine: 0 }, at(15)],
    ["their own limit", S, { ...C, dailyLimit: 1 }, ch, { all: 1, mine: 1 }, at(15)],
    ["never talked", S, C, { ...ch, lastUserAt: null }, none, at(15)],
    ["not quiet long enough", S, C, quiet(1, { openPromise: "x" }), none, at(15)],
  ]) assert.equal(decideOutreach(now, s, c, chat, sent).send, false, why);
});

test("follow-ups wait longer each time and stop after the limit; replying resets them", () => {
  const sent1 = quiet(10, { openPromise: "x", sinceLastUser: 1, lastOutreachAt: at(15).getTime() - 3 * 3_600_000 });
  assert.equal(decideOutreach(at(15), S, C, sent1, none).send, false, "2 h wait ×2 = 4 h; only 3 h since the last");
  assert.equal(decideOutreach(at(15), S, C, { ...sent1, lastOutreachAt: at(15).getTime() - 5 * 3_600_000 }, none).send, true);
  assert.equal(decideOutreach(at(15), S, C, { ...sent1, sinceLastUser: 3, lastOutreachAt: 0 }, none).send, false, "past two follow-ups they wait for you");
  assert.equal(decideOutreach(at(15), S, C, quiet(3, { openPromise: "x" }), none).send, true, "after you reply the count starts again");
});

test("story reasons: repair outranks a promise; a question only once; absence after a day; each can be turned off", () => {
  const d = (chat, c = C) => decideOutreach(at(15), S, c, chat, none);
  assert.equal(d(quiet(3, { openPromise: "x", ruptureNote: "trust was broken" })).trigger, "repair");
  assert.match(d(quiet(3, { openPromise: "get you on the shuttle" })).reason, /promise they made you: get you on the shuttle/);
  assert.equal(d(quiet(3, { unansweredQuestion: true })).trigger, "question");
  assert.equal(d(quiet(3, { unansweredQuestion: true, sinceLastUser: 1, lastOutreachAt: 0 })).send, false, "a question is followed up once, not chased");
  assert.equal(d(quiet(3)).send, false, "nothing in the story: no message");
  assert.equal(d(quiet(30)).trigger, "absence");
  assert.match(d(quiet(30)).reason, /30 hours/);
  assert.equal(d(quiet(3, { openPromise: "x" }), { ...C, off: ["promise"] }).send, false);
});

test("timed: morning and evening check-ins; both modes share the limits; story still wins in Both", () => {
  const timed = { ...C, mode: "timed" };
  assert.equal(decideOutreach(at(8), S, timed, { ...quiet(3), lastUserAt: at(8).getTime() - 3 * 3_600_000 }, none).trigger, "morning");
  assert.equal(decideOutreach(at(21), S, timed, { ...quiet(3), lastUserAt: at(21).getTime() - 3 * 3_600_000 }, none).trigger, "evening");
  assert.equal(decideOutreach(at(15), S, timed, quiet(3, { openPromise: "x" }), none).trigger, "checkin", "Timed ignores the story");
  assert.equal(decideOutreach(at(15), S, { ...C, mode: "both" }, quiet(3, { openPromise: "x" }), none).trigger, "promise");
  assert.equal(decideOutreach(at(15), S, { ...C, mode: "both" }, quiet(3), { all: 3, mine: 0 }).send, false, "one limit for both");
});

test("quiet hours wrap midnight; times convert both ways", () => {
  assert.equal(inQuietHours(at(23, 30), 1380, 480), true);
  assert.equal(inQuietHours(at(7, 59), 1380, 480), true);
  assert.equal(inQuietHours(at(8), 1380, 480), false);
  assert.equal(inQuietHours(at(13), 720, 840), true, "a daytime window works too");
  assert.equal(inQuietHours(at(3), 0, 0), false, "start = end means none");
  assert.equal(toMinutes("23:00"), 1380); assert.equal(fromMinutes(480), "08:00"); assert.equal(toMinutes("nope"), null);
});

test("a character allowed to call phones about a rupture or a long silence, and texts otherwise", async () => {
  const { reachOutBy } = await import("../../lib/outreach/rules.ts");
  assert.equal(reachOutBy("repair", { canContact: true, calls: true }), "call");
  assert.equal(reachOutBy("absence", { canContact: true, calls: true }), "call");
  assert.equal(reachOutBy("promise", { canContact: true, calls: true }), "text", "a promise coming due is a text");
  assert.equal(reachOutBy("morning", { canContact: true, calls: true }), "text");
  assert.equal(reachOutBy("repair", { canContact: true }), "text", "not allowed to call: always a text");
  assert.equal(reachOutBy("repair", undefined), "text");
});

test("sounds are on by default and only an explicit false turns them off", async () => {
  const { cleanContactSettings, DEFAULT_CONTACT } = await import("../../lib/media/contact.ts");
  assert.equal(DEFAULT_CONTACT.sounds, true);
  assert.equal(cleanContactSettings({}).sounds, true, "settings saved before sounds existed get them");
  assert.equal(cleanContactSettings({ sounds: false }).sounds, false);
  assert.equal(cleanContactSettings({ sounds: "no" }).sounds, true);
});
