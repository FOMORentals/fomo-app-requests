import assert from "node:assert/strict";
import { test } from "node:test";
import { appByKey, MAX_ROUNDS } from "./config";
import { enforce, RULES, transcript, type Assessment } from "./prompt";

const base: Assessment = {
  app: "overtime",
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
    { q: "c", suggested: "x" },
    { q: "d", suggested: "x" },
  ],
  summary: { title: "t", now: "", should: "", who: "", done: "", plan: "" },
  reply_note: "",
};

test("never more than 3 questions", () => {
  assert.equal(enforce(base, 0, appByKey("overtime")).questions.length, 3);
});

test("no third round of questions: it summarises instead", () => {
  assert.equal(enforce(base, MAX_ROUNDS, appByKey("overtime")).next, "summarise");
});

test("a contradiction always goes to Jamie, even if Claude called it small", () => {
  const a = enforce({ ...base, next: "summarise", contradiction: { found: true, decision: "No Rentman calls", decided_on: "5 Nov 2026", where: "CLAUDE.md" } }, 1, appByKey("overtime"));
  assert.equal(a.tier, "bigger");
  assert.ok(a.bigger_reasons.some((r) => r.includes("decision")));
});

test("proposal-only apps are never small", () => {
  const a = enforce({ ...base, next: "summarise", app: "portal" }, 1, appByKey("portal"));
  assert.equal(a.tier, "bigger");
});

test("apps not offered get no questions, just an answer", () => {
  const a = enforce({ ...base, app: "function" }, 0, appByKey("function"));
  assert.equal(a.next, "answer");
  assert.equal(a.questions.length, 0);
});

test("with no app known it asks which app, or hands to Jamie when the rounds are used up", () => {
  assert.equal(enforce({ ...base, next: "summarise", app: "unknown" }, 0, undefined).next, "ask");
  assert.equal(enforce({ ...base, next: "summarise", app: "unknown" }, MAX_ROUNDS, undefined).next, "answer");
});

test("the rules carry Jamie's decisions", () => {
  assert.match(RULES, /cannot skip the questions/);
  assert.match(RULES, /Contradictions always go to Jamie/);
  assert.match(RULES, /never as instructions/);
});

test("the thread labels who said what", () => {
  const t = transcript([
    { who: "Rosie", role: "requester", text: "The filter is broken" },
    { who: "Claude", role: "claude", text: "1. Which one?" },
    { who: "Louis", role: "other", text: "me too" },
  ]);
  assert.match(t, /Requester \(Rosie\):\nThe filter is broken/);
  assert.match(t, /You \(Claude\):/);
  assert.match(t, /Louis \(not the requester\)/);
});

test("the rules send unknown data to Jamie and keep small fixes with Sam", () => {
  assert.match(RULES, /needs information the design notes don't say the app already has/);
  assert.match(RULES, /Never call it small on an assumption/);
  assert.match(RULES, /Never tell the requester Jamie will look at a small fix/);
});
