import assert from "node:assert/strict";
import { test } from "node:test";
import type { Loaded } from "./actions";
import { newCard, type Card } from "./records";
import { cardBlocks } from "./blocks";
import { due, needsDoneButton } from "./tick";

const req = (c: Partial<Card>): Loaded => ({ channel: "C", thread: "1", cardTs: "2", messages: [], card: { ...newCard("U1"), ...c } });
const at = (s: string) => Date.parse(s);

test("a quiet requester is nudged once after a working day, then closed after three", () => {
  const asked = at("2026-11-17T10:00:00Z"); // Tuesday
  assert.equal(due(req({ stage: "grilling", askedAt: asked }), at("2026-11-18T09:00:00Z")), null);
  assert.equal(due(req({ stage: "grilling", askedAt: asked }), at("2026-11-18T10:07:00Z")), "nudge");
  assert.equal(due(req({ stage: "grilling", askedAt: asked, nudged: true }), at("2026-11-19T10:07:00Z")), null);
  assert.equal(due(req({ stage: "confirm", askedAt: asked, nudged: true }), at("2026-11-20T10:07:00Z")), "close");
});

test("an untapped approval gets one reminder at 9:00 London the next working morning", () => {
  const pending = at("2026-11-17T15:00:00Z");
  assert.equal(due(req({ stage: "approval", pendingSince: pending }), at("2026-11-17T16:07:00Z")), null);
  assert.equal(due(req({ stage: "approval", pendingSince: pending }), at("2026-11-18T09:07:00Z")), "remind");
  assert.equal(due(req({ stage: "proposal", pendingSince: pending, reminded: true }), at("2026-11-19T09:07:00Z")), null);
});

test("queued builds start, stuck builds time out, merged changes are checked", () => {
  assert.equal(due(req({ stage: "queued" }), Date.now()), "start");
  assert.equal(due(req({ stage: "building", startedAt: at("2026-11-17T10:00:00Z") }), at("2026-11-17T12:30:00Z")), "timeout");
  assert.equal(due(req({ stage: "building", startedAt: at("2026-11-17T10:00:00Z") }), at("2026-11-17T11:00:00Z")), null);
  assert.equal(due(req({ stage: "deploying" }), Date.now()), "check_deploy");
});

test("cards waiting on Jamie get the Done elsewhere button once", () => {
  const ref = { channel: "C", thread: "1" };
  const old = (stage: Card["stage"]): Loaded => ({ ...req({ stage }), messages: [{ ts: "2", blocks: [{ type: "section" }] }] });
  assert.equal(needsDoneButton(old("proposal")), true);
  assert.equal(needsDoneButton(old("handed")), true);
  assert.equal(needsDoneButton(old("failed")), true);
  assert.equal(needsDoneButton(old("live")), false);
  const redrawn: Loaded = { ...req({ stage: "proposal" }), messages: [{ ts: "2", blocks: cardBlocks({ ...newCard("U1"), stage: "proposal" }, undefined, ref) }] };
  assert.equal(needsDoneButton(redrawn), false);
  const live = cardBlocks({ ...newCard("U1"), stage: "live" }, undefined, ref);
  assert.ok(!JSON.stringify(live).includes("done_elsewhere"));
});
