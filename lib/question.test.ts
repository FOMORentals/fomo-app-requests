/** "Why is the app doing this?" questions (Jamie, 20 Nov 2026). */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Loaded } from "./actions";
import { statusLine, verdictBlocks, VERDICTS } from "./blocks";
import { appByKey, canLookInto } from "./config";
import { questionIssueBody, questionIssueTitle, readRefMarker } from "./issue";
import { enforce, RULES, turnPrompt, type Assessment } from "./prompt";
import { cardMeta, newCard, readCard, reopensOnReply, type Card } from "./records";
import { due } from "./tick";

const q: Assessment = {
  app: "dashboard",
  kind: "question",
  already_does_it: false,
  how_to: "I'll check how often the Kit Prep board refreshes.",
  contradiction: { found: false, decision: "", decided_on: "", where: "" },
  recorded_decision_found: false,
  tier: "small",
  bigger_reasons: [],
  size: "S",
  next: "investigate",
  questions: [],
  summary: { title: "", now: "", should: "", who: "", done: "", plan: "" },
  reply_note: "",
};

test("Claude is told about why-questions and to look rather than guess", () => {
  assert.match(RULES, /WHY IS THE APP DOING THIS/);
  assert.match(RULES, /Do not guess at the cause/);
});

test("a why-question on an app with the look-into-it robot stays a look", () => {
  assert.equal(enforce(q, 0, appByKey("dashboard")).next, "investigate");
  assert.ok(canLookInto(appByKey("dashboard")));
  for (const k of ["portal", "website", "kit", "consignor", "requests", "overtime", "whatsnew", "inventory"]) assert.ok(canLookInto(appByKey(k)), k);
  for (const k of ["function", "rentmancore", "gmail", "status"]) assert.ok(!canLookInto(appByKey(k)), k);
});

test("no app known: ask which app first, while a round is left", () => {
  const a = enforce({ ...q, app: "unknown" }, 0, undefined);
  assert.equal(a.next, "ask");
  assert.equal(a.questions[0].q, "Which app is this about?");
});

test("an app not offered to the team is answered as one for Jamie, not looked into", () => {
  assert.equal(enforce({ ...q, app: "function" }, 0, appByKey("function")).next, "answer");
});

test("after Fix it, a question is a change: no more looking", () => {
  const a = enforce(q, 0, appByKey("dashboard"), true);
  assert.equal(a.next, "summarise");
  assert.equal(a.kind, "change");
  assert.match(turnPrompt(0, "dashboard", true), /tapped the button to get it fixed/);
  assert.doesNotMatch(turnPrompt(0, "dashboard"), /tapped the button/);
});

test("the question's state survives the round trip through Slack metadata", () => {
  const c: Card = { ...newCard("U1"), app: "dashboard", stage: "explained", looks: 1, lookIssue: 7, lookedAt: 1763600000000, verdict: "broken", fixing: true };
  assert.deepEqual(readCard(cardMeta(c)), c);
  assert.equal(reopensOnReply("explained"), true);
  assert.equal(reopensOnReply("looking"), false);
});

test("status line while looking", () => {
  assert.equal(statusLine("looking"), "*Status:* Received → *Looking into it* → Answered");
});

test("each verdict has its buttons; broken offers Fix it", () => {
  const ids = (v: keyof typeof VERDICTS) =>
    verdictBlocks({ requester: "U1", verdict: v, answer: "x", checked: "code", value: "C|1" })
      .filter((b) => b.type === "actions")
      .flatMap((b) => b.elements.map((e: { action_id: string }) => e.action_id));
  assert.deepEqual(ids("broken"), ["q_fix", "q_jamie"]);
  assert.deepEqual(ids("as_designed"), ["q_ok", "q_fix"]);
  assert.deepEqual(ids("should_change"), ["q_fix", "q_ok"]);
  assert.deepEqual(ids("unsure"), ["q_jamie", "q_ok"]);
});

test("the question issue points back at the thread and says look, don't touch", () => {
  const body = questionIssueBody({ app: appByKey("dashboard")!, requesterName: "Will", link: "https://x", focus: "Refresh times", thread: "a ``` b", channel: "C0ABC", threadTs: "1763400000.123456" });
  assert.deepEqual(readRefMarker(body), { channel: "C0ABC", thread: "1763400000.123456" });
  assert.match(body, /look, don't touch/);
  assert.ok(!body.includes("a ``` b"));
  assert.ok(questionIssueTitle("x".repeat(200)).length < 110);
});

test("a look that never reports back times out after 45 minutes", () => {
  const req = (c: Partial<Card>): Loaded => ({ channel: "C", thread: "1", cardTs: "2", messages: [], card: { ...newCard("U1"), ...c } });
  const t = Date.parse("2026-11-20T10:00:00Z");
  assert.equal(due(req({ stage: "looking", lookedAt: t }), t + 30 * 60_000), null);
  assert.equal(due(req({ stage: "looking", lookedAt: t }), t + 50 * 60_000), "look_timeout");
});
