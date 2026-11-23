import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalBlocks, proposalBlocks, questionBlocks, statusLine, summaryBlocks, textModal } from "./blocks";
import { appByKey } from "./config";
import { newCard } from "./records";
import type { Assessment } from "./prompt";

const summary = { title: "Fix the filter", now: "It shows nothing", should: "It shows the right jobs", who: "Rosie, daily", done: "Filter works", plan: "Fix the filter" };

test("the status line bolds where the request is", () => {
  assert.equal(statusLine("grilling"), "*Status:* Received → *Questions* → Waiting for ✅ → Building → Waiting for approval → Live ✅");
  assert.match(statusLine("approval", "Sam"), /\*Waiting for Sam\*/);
  assert.match(statusLine("deploying"), /\*Going live\*/);
  assert.equal(statusLine("closed"), "*Status:* Closed (no reply). Reply here any time to reopen it");
});

test("the summary has one ✅ button, and says who checks a small fix", () => {
  const a = { tier: "small", bigger_reasons: [], summary, contradiction: { found: false }, recorded_decision_found: true, reply_note: "" } as unknown as Assessment;
  const blocks = summaryBlocks("U1", a, appByKey("overtime")!, "C|1");
  const buttons = blocks.filter((b) => b.type === "actions").flatMap((b) => b.elements);
  assert.deepEqual(buttons.map((b) => b.action_id), ["confirm"]);
  assert.ok(JSON.stringify(blocks).includes("Sam will check it"));
});

test("a summary with no recorded decision says so", () => {
  const a = { tier: "small", bigger_reasons: [], summary, contradiction: { found: false }, recorded_decision_found: false, reply_note: "" } as unknown as Assessment;
  assert.ok(JSON.stringify(summaryBlocks("U1", a, appByKey("overtime")!, "C|1")).includes("no recorded decision"));
});

test("an approval has Approve, Ask for changes and Reject", () => {
  const blocks = approvalBlocks({ app: appByKey("overtime")!, requester: "U1", summary, built: { changed: "x", checks: "passed", preview: "", prUrl: "https://github.com/x" }, link: "https://slack/x", noDecision: true, value: "C|1" });
  const ids = blocks.filter((b) => b.type === "actions").flatMap((b) => b.elements.map((e: { action_id: string }) => e.action_id));
  assert.deepEqual(ids, ["approve", "changes", "reject"]);
  assert.ok(JSON.stringify(blocks).includes("No recorded decision"));
});

test("Jamie's proposal has four choices; Sam's copy can only comment", () => {
  const card = { ...newCard("U1"), reasons: "a new feature", contradiction: "No Rentman calls (5 Nov 2026)" };
  const base = { app: appByKey("portal")!, requester: "U1", summary, card, size: "M", link: "x", value: "C|1" };
  const ids = (forSam: boolean) => proposalBlocks({ ...base, forSam }).filter((b) => b.type === "actions").flatMap((b) => b.elements.map((e: { action_id: string }) => e.action_id));
  assert.deepEqual(ids(false), ["build_it", "discuss", "not_now", "decline"]);
  assert.deepEqual(ids(true), ["sam_comment"]);
  assert.ok(JSON.stringify(proposalBlocks({ ...base, forSam: false })).includes("No Rentman calls"));
});

test("questions spell out what only a person can supply, separately from the numbered ones", () => {
  const a = { questions: [], needs: [{ what: "Create a Yes/No field called In house prep on Projects", where: "Rentman: Settings, Extra input fields. The ID is the first column.", value: "" }], contradiction: { found: false }, reply_note: "" } as unknown as Assessment;
  const text = JSON.stringify(questionBlocks("U1", a, 1));
  assert.ok(text.includes("Before this can be built, I need you to"));
  assert.ok(text.includes("In house prep"));
  assert.ok(text.includes("just the ID number"));
});

test("the summary shows the ID it will use; Jamie's proposal shows what's still missing", () => {
  const a = { tier: "small", bigger_reasons: [], summary, contradiction: { found: false }, recorded_decision_found: true, reply_note: "", needs: [{ what: "In house prep field ID", where: "", value: "54" }] } as unknown as Assessment;
  assert.ok(JSON.stringify(summaryBlocks("U1", a, appByKey("dashboard")!, "C|1")).includes("In house prep field ID: *54*"));
  const card = { ...newCard("U1"), needs: [{ what: "In house prep field ID", where: "Rentman", value: "" }] };
  const p = JSON.stringify(proposalBlocks({ app: appByKey("dashboard")!, requester: "U1", summary, card, size: "S", link: "x", value: "C|1", forSam: false }));
  assert.ok(p.includes("Needed before it can be built"));
  assert.ok(p.includes("Build it will ask you for this first"));
});

test("Try again's form can be left empty", () => {
  const m = textModal({ callbackId: "retry", title: "Try again", label: "x", submit: "Try again", value: "C|1", optional: true });
  assert.equal(m.blocks[0].optional, true);
});
