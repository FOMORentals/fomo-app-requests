import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalBlocks, proposalBlocks, statusLine, summaryBlocks } from "./blocks";
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
