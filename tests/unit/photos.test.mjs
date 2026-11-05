// Photo messages: the opt-in switches and reading a character's [photo: …].

import { test } from "node:test";
import assert from "node:assert/strict";

const { takePhotoMarkers } = await import("../../lib/chat/photos.ts");
const { mayOfferPhotos, cleanContactSettings, DEFAULT_CONTACT } = await import("../../lib/media/contact.ts");

test("everything is off by default; both switches must be on to offer photos", () => {
  assert.deepEqual(DEFAULT_CONTACT, { enabled: false, reviewMedia: true, paused: false, userStatus: "available", userNote: "", quietStart: 1380, quietEnd: 480, dailyLimit: 3, notifications: false });
  const c = cleanContactSettings({ enabled: "yes", reviewMedia: false, notifications: 1, userStatus: "busy", dailyLimit: 99, quietStart: 9999, extra: 1 });
  assert.equal(c.enabled, false, "only a real true turns it on");
  assert.equal(c.notifications, false);
  assert.equal(c.reviewMedia, false);
  assert.equal(c.userStatus, "available", "an unknown status is not stored");
  assert.equal(c.dailyLimit, 3, "an out-of-range limit falls back");
  assert.equal(c.quietStart, 1380);
  assert.equal("extra" in c, false);
  const on = { enabled: true, reviewMedia: true };
  assert.equal(mayOfferPhotos(on, { contact: { photos: true } }), true);
  assert.equal(mayOfferPhotos(on, { contact: {} }), false, "the character was not allowed");
  assert.equal(mayOfferPhotos({ ...on, enabled: false }, { contact: { photos: true } }), false, "the master switch is off");
  assert.equal(mayOfferPhotos(on, undefined), false);
});

test("a marker on its own line becomes the photo and leaves the text", () => {
  const r = takePhotoMarkers("Here, so you know I made it.\n[photo: standing by the boarded window, rain outside]\nDon't show anyone.");
  assert.equal(r.photo, "standing by the boarded window, rain outside");
  assert.equal(r.text, "Here, so you know I made it.\n\nDon't show anyone.");
  assert.equal(takePhotoMarkers("[Selfie: \"grinning at the camera\"]").photo, "grinning at the camera", "selfie and quotes accepted");
  assert.equal(takePhotoMarkers("[photo: a]\n[photo: b]").photo, "a", "one photo per reply");
  assert.equal(takePhotoMarkers("[photo: a]\n[photo: b]").text, "", "both markers are removed");
});

test("anything that is not a marker on its own line is left alone", () => {
  for (const t of ["I'd send a [photo: of me] but no.", "No markers here.", "[photograph: x]"]) {
    const r = takePhotoMarkers(t);
    assert.equal(r.photo, null, t);
    assert.equal(r.text, t);
  }
});
