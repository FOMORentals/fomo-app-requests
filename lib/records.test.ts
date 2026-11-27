import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_META_MAX, cardMeta, decodeRef, encodeRef, fitCard, metaBytes, newCard, readCard, reopensOnReply } from "./records";

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

test("what the team supplied (a Rentman field's ID) is kept on the request; older requests read as none", () => {
  const c = { ...newCard("U1"), needs: [{ what: "In house prep field ID", where: "Rentman", value: "54" }] };
  assert.deepEqual(readCard(cardMeta(c))?.needs, c.needs);
  const old = cardMeta(newCard("U1"));
  delete old.event_payload.needs;
  assert.deepEqual(readCard(old)?.needs, []);
});

test("a big card is trimmed to fit Slack's metadata, longest notes first, and still reads back (Will's Kit Prep request, 27 Nov 2026)", () => {
  const long = (n: number) => "x".repeat(n);
  const c = {
    ...newCard("U1"),
    stage: "confirm" as const,
    after: long(450),
    scopeWhy: long(250),
    relatedWhy: long(200),
    reasons: long(400),
    contradiction: long(300),
    summary: { title: "Kit Prep: cross-hire list", now: long(260), should: long(450), who: long(240), done: long(260), plan: long(560) },
  };
  assert.ok(metaBytes(cardMeta(c)) > CARD_META_MAX);
  const f = fitCard(c);
  assert.ok(metaBytes(cardMeta(f)) <= CARD_META_MAX);
  assert.equal(f.summary?.plan, c.summary.plan, "the summary is kept whole when the notes are enough");
  assert.ok(f.after.length <= 160 && f.after.endsWith("…"));
  assert.equal(readCard(cardMeta(f))?.stage, "confirm");
  assert.equal(c.after.length, 450, "the card in hand is not changed");
});

test("a small card is stored as it is", () => {
  const c = newCard("U1");
  assert.equal(fitCard(c), c);
});

test("a card too big even after the notes are trimmed shortens the summary too", () => {
  const long = (n: number) => "y".repeat(n);
  const c = { ...newCard("U1"), summary: { title: "T", now: long(1500), should: long(1500), who: long(800), done: long(800), plan: long(1500) } };
  const f = fitCard(c);
  assert.ok(metaBytes(cardMeta(f)) <= CARD_META_MAX);
  assert.equal(f.summary?.title, "T");
});

test("empty fields are left off the card and come back as their defaults", () => {
  const c = { ...newCard("U1"), stage: "confirm" as const, app: "board" };
  const meta = cardMeta(c);
  assert.deepEqual(Object.keys(meta.event_payload).sort(), ["app", "requester", "stage"]);
  assert.deepEqual(readCard(meta), c);
});
