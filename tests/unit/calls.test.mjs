// Phone calls they make: ringing shows on the chat, and an unanswered call
// becomes a missed call after RING_MS, declining logs a declined call, and
// either one counts toward the character's daily outreach (it carries
// `outreach`) and marks the chat unread when you are elsewhere.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

globalThis.fetch = async (url) => {
  if (String(url).includes("/api/contact-settings")) return new Response(JSON.stringify({ enabled: true, sounds: false }), { status: 200 });
  return new Response("{}", { status: 200 });
};

const { ringIn, declineCall, RING_MS } = await import("../../lib/chat/calls.ts");
const { useFableStore } = await import("../../lib/store/index.ts");
const { useUiStore } = await import("../../lib/store/ui.ts");

const reason = { trigger: "repair", reason: "trust broke", silence: "a day" };

function freshChat() {
  const chatId = `chat-${Math.random().toString(36).slice(2)}`;
  useFableStore.setState((s) => ({
    chats: [...s.chats, { id: chatId, name: "Test", characterId: "char-x", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    activeChatId: null,
  }));
  return chatId;
}
const lastMessage = (chatId) => useFableStore.getState().chats.find((c) => c.id === chatId).messages.at(-1);

test("an unanswered call becomes a missed call after the ring time, counted and unread", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const chatId = freshChat();
    await ringIn(chatId, "char-x", reason);
    assert.equal(useUiStore.getState().call?.phase, "incoming");
    mock.timers.tick(RING_MS - 1);
    assert.equal(useUiStore.getState().call?.phase, "incoming", "still ringing just before the time");
    mock.timers.tick(2);
    assert.equal(useUiStore.getState().call, null);
    const m = lastMessage(chatId);
    assert.equal(m.callEvent.kind, "missed");
    assert.equal(m.role, "assistant", "they called");
    assert.equal(m.channel, "call");
    assert.deepEqual(m.outreach, { trigger: "repair", reason: "trust broke" }, "a missed call counts toward their daily limit");
    assert.equal(useUiStore.getState().unreadChats[chatId], 1);
  } finally {
    mock.timers.reset();
  }
});

test("declining logs a declined call and stops the ring; a second ring while one is going is ignored", async () => {
  const chatId = freshChat();
  await ringIn(chatId, "char-x", reason);
  const other = freshChat();
  await ringIn(other, "char-x", reason);
  assert.equal(useUiStore.getState().call.chatId, chatId, "one call at a time");
  declineCall();
  assert.equal(useUiStore.getState().call, null);
  assert.equal(lastMessage(chatId).callEvent.kind, "declined");
  assert.equal(lastMessage(other), undefined, "the ignored ring left nothing");
});
