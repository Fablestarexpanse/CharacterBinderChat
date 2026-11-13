// Comic-it: each page covers what happened since the last one.

import { test } from "node:test";
import assert from "node:assert/strict";

const { messagesSinceLastPage } = await import("../../lib/chat/comic.ts");

const m = (id, extra = {}) => ({ id, chatId: "c", role: "assistant", content: `line ${id}`, timestamp: "", ...extra });
const messages = [m("a"), m("b"), m("pic", { imageJobId: "j", content: "page" }), m("err", { error: true }), m("c"), m("d")];

test("the first page takes the whole chat; the next starts after where the last one ended", () => {
  assert.deepEqual(messagesSinceLastPage({ messages }).map((x) => x.id), ["a", "b", "c", "d"], "image cards and errors are not story");
  assert.deepEqual(messagesSinceLastPage({ messages, comic: { upTo: "b", recap: "" } }).map((x) => x.id), ["c", "d"]);
  assert.deepEqual(messagesSinceLastPage({ messages, comic: { upTo: "d", recap: "" } }), [], "nothing new");
});

test("a long stretch is cut to the earliest 16 messages, leaving the rest for the next page", () => {
  const many = Array.from({ length: 30 }, (_, i) => m(`m${i}`));
  const got = messagesSinceLastPage({ messages: many });
  assert.equal(got.length, 16);
  assert.equal(got[0].id, "m0");
});
