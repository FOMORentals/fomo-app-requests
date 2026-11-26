import assert from "node:assert/strict";
import { test } from "node:test";
import { isCandidate, markDone, newOwnerReplies, undoDone, unchecked, type MergedPr } from "./elsewhere";
import { cardMeta, newCard, readCard, type Card, type Stage } from "./records";

const ASKED = Date.parse("2026-11-20T10:00:00Z");

function card(stage: Stage, extra: Partial<Card> = {}): Card {
  return { ...newCard("U1"), app: "dashboard", stage, ...extra };
}
function pr(number: number, mergedAt: number): MergedPr {
  return { number, title: `PR ${number}`, body: "", url: `https://github.com/FOMORentals/fomo-bookings-board-v2/pull/${number}`, mergedAt };
}

test("only requests waiting on Jamie or failed, in an app with a repo, are checked", () => {
  assert.ok(isCandidate(card("handed")));
  assert.ok(isCandidate(card("proposal")));
  assert.ok(isCandidate(card("failed")));
  assert.ok(!isCandidate(card("approval")));
  assert.ok(!isCandidate(card("live")));
  assert.ok(!isCandidate(card("handed", { app: "" })));
});

test("only pull requests merged after the request, not yet checked and not the bot's own build", () => {
  const prs = [pr(170, ASKED - 1000), pr(175, ASKED + 1000), pr(173, ASKED + 500), pr(176, ASKED + 2000), pr(180, ASKED + 3000)];
  assert.deepEqual(unchecked(prs, card("failed", { pr: 180 }), ASKED).map((p) => p.number), [173, 175, 176]);
  assert.deepEqual(unchecked(prs, card("failed", { elsewhereSeen: 175 }), ASKED).map((p) => p.number), [176, 180]);
});

test("marking done can be undone exactly, and survives being saved on the card", () => {
  const c = card("failed", { summary: { title: "In-house prep", now: "", should: "", who: "", done: "", plan: "" }, note: "needed the field ID", prUrl: "" });
  markDone(c, pr(175, ASKED + 1000), "shows In-house prep jobs on Kit Prep", ASKED + 5000);
  assert.equal(c.stage, "live");
  assert.match(c.prUrl, /pull\/175$/);
  assert.match(c.note, /#175: shows In-house prep/);
  const saved = readCard(cardMeta(c))!;
  assert.ok(undoDone(saved));
  assert.equal(saved.stage, "failed");
  assert.equal(saved.note, "needed the field ID");
  assert.equal(saved.prUrl, "");
  assert.equal(saved.mergedAt, 0);
  assert.ok(!undoDone(saved));
});

test("a question (no summary) is marked answered, not live", () => {
  const c = card("handed");
  markDone(c, pr(175, ASKED + 1000), "", ASKED);
  assert.equal(c.stage, "answered");
});

test("Jamie saying it's sorted, with no pull request, marks it done and keeps the old PR link", () => {
  const c = card("handed", { summary: { title: "Cross-hire supplier", now: "", should: "", who: "", done: "", plan: "" }, prUrl: "" });
  markDone(c, null, "it was the sync timing", ASKED + 9000);
  assert.equal(c.stage, "live");
  assert.equal(c.prUrl, "");
  assert.equal(c.mergedAt, ASKED + 9000);
  assert.match(c.note, /Jamie said in the thread it's sorted: it was the sync timing/);
});

test("only Jamie's replies since the last check count", () => {
  const l = {
    thread: "100.0",
    card: card("handed", { elsewhereMsg: "200.0" }),
    messages: [
      { ts: "100.0", user: "UJ" },
      { ts: "150.0", user: "UJ" },
      { ts: "250.0", user: "UW" },
      { ts: "300.0", user: "UJ" },
    ],
  };
  assert.deepEqual(newOwnerReplies(l, "UJ"), ["300.0"]);
  assert.deepEqual(newOwnerReplies({ ...l, card: card("handed") }, "UJ"), ["150.0", "300.0"]);
});

test("a grilled or reframed idea spotted done goes Live, a question goes Answered", () => {
  const grilled = card("handed", { gate: "grill", after: "see progress" });
  markDone(grilled, null, "", ASKED);
  assert.equal(grilled.stage, "live");
  const reframed = card("proposal", { reframed: true });
  markDone(reframed, null, "", ASKED);
  assert.equal(reframed.stage, "live");
  const question = card("handed");
  markDone(question, null, "", ASKED);
  assert.equal(question.stage, "answered");
});
