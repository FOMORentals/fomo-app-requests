import assert from "node:assert/strict";
import { test } from "node:test";
import { cutoutPhotos, cutoutSigned, MAX_PHOTOS, signCutout } from "./cutout";

const C = "C0LISTINGS";
const msg = (o: Record<string, unknown> = {}) => ({
  type: "message", subtype: "file_share", channel: C, ts: "2.0", thread_ts: "1.0", user: "U1",
  files: [{ id: "F1", name: "fx3.jpg", mimetype: "image/jpeg", size: 1000 }], ...o,
});

test("a photo dropped in a reply in #website-listings starts a cut-out", () => {
  assert.deepEqual(cutoutPhotos(msg(), C).map((f) => f.id), ["F1"]);
});

test("not a cut-out: another channel, the card itself, a bot, a PDF, an edit", () => {
  assert.equal(cutoutPhotos(msg({ channel: "C0OTHER" }), C).length, 0);
  assert.equal(cutoutPhotos(msg({ thread_ts: undefined }), C).length, 0);
  assert.equal(cutoutPhotos(msg({ thread_ts: "2.0" }), C).length, 0);
  assert.equal(cutoutPhotos(msg({ bot_id: "B1" }), C).length, 0);
  assert.equal(cutoutPhotos(msg({ files: [{ id: "F2", mimetype: "application/pdf" }] }), C).length, 0);
  assert.equal(cutoutPhotos(msg({ subtype: "message_changed" }), C).length, 0);
  assert.equal(cutoutPhotos(msg(), "").length, 0);
});

test("iPhone photos count, and at most three photos a message", () => {
  const files = Array.from({ length: 5 }, (_, i) => ({ id: `F${i}`, mimetype: i ? "image/heic" : "image/png" }));
  assert.equal(cutoutPhotos(msg({ files }), C).length, MAX_PHOTOS);
});

test("the workflow's calls must be signed with the shared secret", () => {
  const body = JSON.stringify({ action: "source", file: "F1" });
  assert.ok(cutoutSigned(body, signCutout(body, "s3cret"), "s3cret"));
  assert.ok(!cutoutSigned(body, signCutout(body, "other"), "s3cret"));
  assert.ok(!cutoutSigned(body + " ", signCutout(body, "s3cret"), "s3cret"));
  assert.ok(!cutoutSigned(body, null, "s3cret"));
});
