/** Right-sized grilling (Jamie, 23 Nov 2026): reframe first, size, Sam's gate, step up. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardBlocks, gateBlocks, questionBlocks, readingText, reframeBlocks, statusLine, stepUpBlocks, summaryBlocks } from "./blocks";
import { appByKey } from "./config";
import { interviewee, setting, specInstructions } from "./grill/prompt";
import { REFRAMED, enforce, needsReframe, turnPrompt, type Assessment, type Depth } from "./prompt";
import { cardMeta, newCard, readCard, reopensOnReply } from "./records";
import { due } from "./tick";
import { groupOf } from "./tracker";

const a: Assessment = {
  app: "dashboard",
  kind: "change",
  already_does_it: false,
  how_to: "",
  contradiction: { found: false, decision: "", decided_on: "", where: "" },
  recorded_decision_found: true,
  tier: "small",
  bigger_reasons: [],
  size: "S",
  next: "ask",
  questions: [
    { q: "a", suggested: "x" },
    { q: "b", suggested: "x" },
  ],
  summary: { title: "t", now: "", should: "", who: "", done: "", plan: "" },
  needs: [],
  reframe: { after: "knowing which quotes to chase", exists: "Quotes (Upcoming)", scope: "", why: "", keep_small: "" },
  reply_note: "",
};
const fresh: Depth = { reframed: false, scope: "", gate: "" };
const dash = appByKey("dashboard");

test("a new change request is reframed, with its first questions in the same message", () => {
  const out = enforce(a, 0, dash, false, fresh);
  assert.equal(out.next, "reframe");
  assert.equal(out.reframe.scope, "change"); // a size is always given
  assert.equal(out.questions.length, 2); // a change keeps its first questions (Jamie, 24 Nov 2026)
  assert.match(turnPrompt(0, "dashboard", false, fresh), /not confirmed yet/);
  const quick = enforce({ ...a, reframe: { ...a.reframe, scope: "quick_fix" } }, 0, dash, false, fresh);
  assert.equal(quick.questions.length, 1); // a quick fix: one at most
  const big = enforce({ ...a, reframe: { ...a.reframe, scope: "new_idea" } }, 0, dash, false, fresh);
  assert.equal(big.questions.length, 0); // a new idea is confirmed with a button before Sam is asked
});

test("the first message of a change is the reading plus the questions, with nothing to tap", () => {
  const read = readingText({ after: "knowing which quotes to chase", exists: "", scope: "change", why: "a filter" });
  const q = JSON.stringify(questionBlocks("U1", a, 1, read));
  assert.match(q, /Here's how I read this/);
  assert.match(q, /knowing which quotes to chase/);
  assert.match(q, /misread you/);
  assert.match(q, /1\.\* a/);
  assert.doesNotMatch(q, /"actions"/);
  const s = JSON.stringify(summaryBlocks("U1", { ...a, next: "summarise" }, dash!, "v", read));
  assert.match(s, /Here's how I read this/);
  assert.match(s, /Yes, build it/);
  assert.match(JSON.stringify(summaryBlocks("U1", { ...a, tier: "bigger" }, dash!, "v")), /Yes, send it to Jamie/);
});

test("progress shows in the status line instead of new messages", () => {
  assert.match(statusLine("queued"), /In the queue/);
  assert.match(statusLine("building"), /\*Building\*/);
  assert.match(statusLine("approval", "Sam"), /Waiting for Sam/);
  assert.match(statusLine("deploying"), /Going live/);
  const card = JSON.stringify(cardBlocks({ ...newCard("U1"), stage: "approval", approver: "sam", preview: "https://p", prUrl: "https://pr" }, dash));
  assert.match(card, /Preview it/);
});

test("no reframe for why-questions, Fix it, or requests already under way", () => {
  assert.equal(enforce({ ...a, kind: "question", next: "investigate" }, 0, dash, false, fresh).next, "investigate");
  assert.equal(needsReframe(0, true, fresh), false);
  assert.equal(needsReframe(1, false, fresh), false);
  assert.equal(enforce(a, 0, dash, false, REFRAMED).next, "ask"); // older requests and the old rules
  // Claude can't reframe once it's confirmed.
  assert.equal(enforce({ ...a, next: "reframe" }, 0, dash, false, { reframed: true, scope: "change", gate: "" }).next, "ask");
});

test("a quick fix gets one question at most", () => {
  assert.equal(enforce(a, 0, dash, false, { reframed: true, scope: "quick_fix", gate: "" }).questions.length, 1);
  assert.match(turnPrompt(0, "dashboard", false, { reframed: true, scope: "quick_fix", gate: "" }), /At most one question/);
  assert.match(turnPrompt(1, "dashboard", false, { reframed: true, scope: "change", gate: "" }), /misread them, go with their correction/);
});

test("a confirmed change can step up, unless it was kept small", () => {
  const up = { ...a, next: "step_up" as const };
  assert.equal(enforce(up, 1, dash, false, { reframed: true, scope: "change", gate: "" }).next, "step_up");
  assert.equal(enforce(up, 1, dash, false, { reframed: true, scope: "change", gate: "small" }).next, "ask");
  assert.equal(enforce(up, 1, dash, false, { reframed: true, scope: "new_idea", gate: "grill" }).next, "ask");
  assert.equal(enforce({ ...up, questions: [] }, 1, dash, false, { reframed: false, scope: "", gate: "" }).next, "summarise");
});

test("the new card fields survive Slack metadata, and the new stages show up right", () => {
  const c = { ...newCard("U1"), reframed: true, after: "chase quotes", scope: "new_idea" as const, scopeWhy: "new routine", keepSmall: "no emails", gate: "grill" as const, gateTs: "1.2", gateDmChannel: "D1", gateDmTs: "3.4" };
  assert.deepEqual(readCard(cardMeta(c)), c);
  assert.equal(reopensOnReply("reframe"), true);
  assert.equal(reopensOnReply("gate"), false);
  assert.equal(reopensOnReply("grill"), false);
  assert.match(statusLine("gate"), /Waiting for Sam/);
  assert.equal(groupOf({ ...c, stage: "gate" }), "sam");
  assert.equal(groupOf({ ...c, stage: "grill" }), "requester");
  const now = Date.UTC(2026, 10, 30, 10);
  assert.equal(due({ channel: "C", thread: "1", cardTs: "2", messages: [], card: { ...newCard("U1"), stage: "reframe", askedAt: now - 10 * 86400_000 } }, now), "close");
});

test("the cards say what was asked, and only Sam's card has his three buttons", () => {
  const r = JSON.stringify(reframeBlocks({ requester: "U1", after: "knowing which quotes to chase", exists: "Quotes list", scope: "new_idea", why: "new routine", value: "v" }));
  assert.match(r, /Here's how I read this/);
  assert.match(r, /New idea/);
  assert.match(r, /reframe_yes/);
  const g = JSON.stringify(gateBlocks({ name: "Rosie", asked: "an export", after: "chase", why: "HubSpot data", link: "https://x", value: "v" }));
  for (const id of ["gate_grill", "gate_small", "gate_park"]) assert.match(g, new RegExp(id));
  assert.match(g, /Rosie has a bigger idea/);
  assert.match(JSON.stringify(stepUpBlocks({ requester: "U1", why: "Emailing clients is new.", keepSmall: "no emails", value: "v" })), /keep_small/);
  assert.doesNotMatch(JSON.stringify(stepUpBlocks({ requester: "U1", why: "x", keepSmall: "", value: "v" })), /keep_small/);
});

test("the grill interviews whoever asked", () => {
  const rosie = interviewee("Rosie");
  assert.equal(rosie.full, "Rosie Femminile");
  assert.match(setting(rosie), /interviewing is Rosie Femminile, Bookings Coordinator/);
  assert.match(setting(rosie), /Rosie answers by replying/);
  assert.match(specInstructions(rosie), /\*\*Asked by:\*\* Rosie Femminile/);
  assert.match(setting(interviewee("Sam")), /Sam Knight, Operations Director/);
  assert.equal(interviewee("Bob").full, "Bob");
});
