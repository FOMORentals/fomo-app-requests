import assert from "node:assert/strict";
import { test } from "node:test";
import { appByKey, MAX_ROUNDS } from "./config";
import { enforce, hasAppCard, othersBlock, principlesBlock, RULES, transcript, type Assessment } from "./prompt";
import { relatedText } from "./blocks";

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
  needs: [],
  reframe: { after: "", exists: "", scope: "", why: "", keep_small: "" },
  reply_note: "",
  related: { kind: "", ts: "", why: "" },
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

// Jamie, 23 Nov 2026: Louis's In house prep request failed at build because nobody was asked for the Rentman field's ID.
const field = { what: "Create a Yes/No field called In house prep on Projects, and send its ID", where: "Rentman: Settings, Extra input fields", value: "" };

test("a missing Rentman field ID is asked for before the summary", () => {
  const a = enforce({ ...base, next: "summarise", questions: [], needs: [field] }, 1, appByKey("dashboard"));
  assert.equal(a.next, "ask");
});

test("it gets one extra round just for the ID, with no more numbered questions", () => {
  const a = enforce({ ...base, next: "ask", needs: [field] }, MAX_ROUNDS, appByKey("dashboard"));
  assert.equal(a.next, "ask");
  assert.equal(a.questions.length, 0);
});

test("still missing after that, it goes to Jamie as a proposal naming what's needed", () => {
  const a = enforce({ ...base, next: "summarise", needs: [field] }, MAX_ROUNDS + 1, appByKey("dashboard"));
  assert.equal(a.next, "summarise");
  assert.equal(a.tier, "bigger");
  assert.ok(a.bigger_reasons.some((r) => r.includes("In house prep")));
});

test("once the ID is given, it summarises as normal", () => {
  const a = enforce({ ...base, next: "summarise", needs: [{ ...field, value: "54" }] }, 1, appByKey("dashboard"));
  assert.equal(a.next, "summarise");
  assert.equal(a.tier, "small");
});

test("the rules say never to guess a Rentman field ID and how to find one", () => {
  assert.match(RULES, /must never guess it/);
  assert.match(RULES, /Extra input fields/);
});

test("a clash with another request goes to Jamie; a repeat is only pointed out (Jamie, 24 Nov 2026)", () => {
  const dash = appByKey("dashboard");
  const clash = enforce({ ...base, tier: "small", next: "summarise", related: { kind: "clash", ts: "1795.1", why: "Rosie asked to sort by client" } }, 2, dash);
  assert.equal(clash.tier, "bigger");
  assert.match(clash.bigger_reasons.join(";"), /pulls against another request \(Rosie asked to sort by client\)/);
  const dup = enforce({ ...base, tier: "small", next: "summarise", related: { kind: "duplicate", ts: "1795.1", why: "Will asked the same" } }, 2, dash);
  assert.equal(dup.tier, "small");
  // A claimed clash with no request named is dropped: the code needs the other request to link to it.
  assert.equal(enforce({ ...base, next: "summarise", related: { kind: "clash", ts: "", why: "x" } }, 2, dash).related.kind, "");
  const block = othersBlock([{ ts: "1795.1", who: "Rosie", date: "Mon 23 Nov", text: "Sort  the Kit\nPrep board by client" }]);
  assert.match(block, /id 1795\.1 · Rosie · Mon 23 Nov: Sort the Kit Prep board by client/);
  assert.match(othersBlock([]), /none/);
  assert.match(relatedText("clash", "Rosie asked to sort by client", "https://x"), /pulls against <https:\/\/x\|another request>/);
  assert.equal(relatedText("", "", ""), "");
});

test("Jamie's principles and each app's card are given to Claude when they exist (24 Nov 2026)", () => {
  assert.equal(principlesBlock(null), "");
  assert.equal(principlesBlock("  "), "");
  assert.match(principlesBlock("1. Start from the outcome."), /FOMO APP PRINCIPLES[\s\S]*Start from the outcome/);
  assert.equal(hasAppCard("# Team Dashboard: design decisions\n\n## App card\n- For: ..."), true);
  assert.equal(hasAppCard("# Client portal\n\n## Who sees what"), false);
  assert.equal(hasAppCard(null), false);
  assert.match(RULES, /must never do, treat that as a contradiction/);
  assert.match(RULES, /offer the better version as the suggested answer/);
});
