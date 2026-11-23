import assert from "node:assert/strict";
import { test } from "node:test";
import { newCard, type Card, type Stage } from "./records";
import { MARKER, cell, groupOf, statusOf, titleOf, trackerMarkdown, type Row } from "./tracker";

const NOW = Date.parse("2026-11-23T12:36:00Z");
const DAY = 24 * 60 * 60_000;

function card(stage: Stage, extra: Partial<Card> = {}): Card {
  return { ...newCard("U1"), stage, ...extra };
}

function row(title: string, c: Card, askedAt = NOW - DAY, lastAt = askedAt): Row {
  return { title, who: "Will", app: "Team Dashboard", askedAt, lastAt, card: c, threadUrl: "https://x.slack.com/archives/C1/p1" };
}

test("each request lands with whoever it's waiting on", () => {
  assert.equal(groupOf(card("proposal")), "jamie");
  assert.equal(groupOf(card("handed")), "jamie");
  assert.equal(groupOf(card("approval", { approver: "sam" })), "sam");
  assert.equal(groupOf(card("approval", { approver: "jamie" })), "jamie");
  assert.equal(groupOf(card("grilling")), "requester");
  assert.equal(groupOf(card("confirm")), "requester");
  assert.equal(groupOf(card("building")), "bot");
  assert.equal(groupOf(card("deploying")), "bot");
  assert.equal(groupOf(card("failed")), "failed");
  for (const s of ["answered", "explained", "live", "closed", "parked", "declined"] as const) assert.equal(groupOf(card(s)), "done");
});

test("every stage has a plain-English status", () => {
  const stages: Stage[] = ["grilling", "confirm", "answered", "looking", "explained", "handed", "queued", "building", "approval", "proposal", "parked", "declined", "deploying", "live", "closed", "failed"];
  for (const s of stages) assert.ok(statusOf(card(s)).length > 3, s);
  assert.match(statusOf(card("failed", { note: "The build didn't report back within 2 hours." })), /Failed \(The build didn't report back within 2 hours\)/);
  assert.match(statusOf(card("live", { mergedAt: Date.parse("2026-11-19T15:00:00Z") })), /Live Thu 19 Nov/);
});

test("cells can't break the table or turn into markdown", () => {
  assert.equal(cell("a | b\nc"), "a / b c");
  assert.equal(cell("- remove the footer"), "\\- remove the footer");
  assert.equal(cell("1. rename columns"), "1\\. rename columns");
  assert.equal(cell("see <https://x.com|the board>"), "see the board");
});

test("title is the summary's, else the start of the request", () => {
  assert.equal(titleOf(card("live", { summary: { title: "Bigger messaging panel", now: "", should: "", who: "", done: "", plan: "" } }), "whatever"), "Bigger messaging panel");
  const long = "on the kit prep board, under the dropped off column, any tiles that do not contain any cross hired items should be ordered";
  const t = titleOf(card("grilling"), long);
  assert.ok(t.length <= 71 && t.endsWith("…"), t);
});

test("the canvas groups requests, newest first, and drops old finished ones", () => {
  const md = trackerMarkdown(
    [
      row("Old one", card("live"), NOW - 20 * DAY),
      row("Proposal A", card("proposal"), NOW - 2 * DAY),
      row("Proposal B", card("proposal"), NOW - DAY),
      row("Needs Sam", card("approval", { approver: "sam", preview: "https://p", prUrl: "https://pr" })),
    ],
    NOW,
  );
  assert.ok(md.includes(MARKER));
  assert.ok(md.includes("Waiting on Jamie (2)"));
  assert.ok(md.includes("Waiting on Sam (1)"));
  assert.ok(md.indexOf("Proposal B") < md.indexOf("Proposal A"));
  assert.ok(!md.includes("Old one"));
  assert.ok(!md.includes("Done in the last"));
  assert.ok(md.includes("[Preview](https://p) · [PR](https://pr)"));
  assert.ok(md.includes("Last change Mon 23 Nov, 12:36 London time"));
});

test("an empty channel still gets a tracker", () => {
  assert.match(trackerMarkdown([], NOW), /No requests yet/);
});
