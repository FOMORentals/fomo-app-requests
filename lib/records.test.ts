import assert from "node:assert/strict";
import { test } from "node:test";
import { cardMeta, decodeRef, encodeRef, newCard, readCard, reopensOnReply } from "./records";

test("a request's data survives the round trip through Slack metadata", () => {
  const c = { ...newCard("U1"), app: "overtime", stage: "approval" as const, round: 2, nudged: true, tier: "small" as const, pr: 42, summary: { title: "T", now: "a", should: "b", who: "c", done: "d", plan: "e" } };
  const meta = cardMeta(c);
  assert.ok(Object.values(meta.event_payload).every((v) => typeof v === "string"));
  assert.deepEqual(readCard(meta), c);
});

test("other metadata is not a request", () => {
  assert.equal(readCard({ event_type: "wn_draft", event_payload: {} }), null);
  assert.equal(readCard(undefined), null);
});

test("button values point back at the request", () => {
  assert.deepEqual(decodeRef(encodeRef({ channel: "C123", thread: "1700000000.000100" })), { channel: "C123", thread: "1700000000.000100" });
  assert.equal(decodeRef("nonsense"), null);
});

test("a reply reopens questions, a summary, an answer or a closed request, but not a build", () => {
  assert.equal(reopensOnReply("closed"), true);
  assert.equal(reopensOnReply("confirm"), true);
  assert.equal(reopensOnReply("building"), false);
  assert.equal(reopensOnReply("approval"), false);
});
