/** The how-to on the channel's tab (Jamie, 24 Nov 2026). */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { SCOPE_LABEL, STEPS, questionBlocks, summaryBlocks } from "./blocks";
import { appByKey, MAX_QUESTIONS, MAX_ROUNDS } from "./config";
import { HOWTO_REVIEWED_FOR, howToMarkdown } from "./howto";
import type { Assessment } from "./prompt";
import { MARKER, canvasMarkdown } from "./tracker";

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
  next: "summarise",
  questions: [{ q: "q", suggested: "s" }],
  summary: { title: "t", now: "n", should: "s", who: "w", done: "d", plan: "p" },
  needs: [],
  reframe: { after: "", exists: "", scope: "", why: "", keep_small: "" },
  reply_note: "",
  related: { kind: "", ts: "", why: "" },
};

/** What the team sees of the flow: if any of this changes, the how-to text must be checked again. */
function flowFingerprint(): string {
  const flow = {
    STEPS,
    SCOPE_LABEL,
    MAX_QUESTIONS,
    MAX_ROUNDS,
    first: questionBlocks("U", a, 1, "> reading"),
    summary: summaryBlocks("U", a, appByKey("dashboard")!, "v"),
    bigger: summaryBlocks("U", { ...a, tier: "bigger" }, appByKey("dashboard")!, "v"),
  };
  return createHash("sha256").update(JSON.stringify(flow)).digest("hex").slice(0, 16);
}

test("the how-to was checked against the flow the team sees now", () => {
  assert.equal(
    HOWTO_REVIEWED_FOR,
    flowFingerprint(),
    "What the team sees in #app-requests has changed. Read lib/howto.ts, update its words if they no longer match, then set HOWTO_REVIEWED_FOR to the expected value shown.",
  );
});

test("the how-to takes its numbers from the bot's settings", () => {
  const md = howToMarkdown();
  assert.match(md, new RegExp(`up to ${MAX_QUESTIONS} questions at a time, up to ${MAX_ROUNDS} rounds`));
  for (const size of ["Quick fix", "Change", "New idea"]) assert.match(md, new RegExp(size));
  assert.match(md, /only tap/);
});

test("no list of apps and no /list-kit on the team's page (Jamie, 24 Nov 2026)", () => {
  const md = howToMarkdown();
  assert.doesNotMatch(md, /list-kit/i);
  for (const name of ["Team Dashboard", "Overtime", "Client portal", "Website", "Consignor portal", "Kit onboarding", "Inventory"]) assert.doesNotMatch(md, new RegExp(name));
  assert.doesNotMatch(md, /\/grill/);
});

test("the tab is the how-to on top, then the tracker, with the bot's marker kept", () => {
  const md = canvasMarkdown([], Date.UTC(2026, 10, 24, 9));
  assert.ok(md.indexOf("How #app-requests works") < md.indexOf("What's in progress"));
  assert.match(md, new RegExp(MARKER));
});
