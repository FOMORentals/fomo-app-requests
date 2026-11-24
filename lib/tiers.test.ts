/** The "built, Jamie checks" tier (Jamie, 24 Nov 2026): newer apps build small fixes only once their app card is approved. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryBlocks } from "./blocks";
import { APPS, appByKey } from "./config";
import { REFRAMED, enforce, hasAppCard, type Assessment } from "./prompt";

const a: Assessment = {
  app: "portal",
  kind: "change",
  already_does_it: false,
  how_to: "",
  contradiction: { found: false, decision: "", decided_on: "", where: "" },
  recorded_decision_found: true,
  tier: "small",
  bigger_reasons: [],
  size: "S",
  next: "summarise",
  questions: [],
  summary: { title: "t", now: "", should: "", who: "", done: "", plan: "" },
  needs: [],
  reframe: { after: "", exists: "", scope: "", why: "", keep_small: "" },
  reply_note: "",
  related: { kind: "", ts: "", why: "" },
};

test("the four newer apps are 'built, Jamie checks'", () => {
  assert.deepEqual(APPS.filter((x) => x.mode === "build_jamie").map((x) => x.key).sort(), ["consignor", "kit", "portal", "website"]);
});

test("without an approved app card a small fix stays a proposal", () => {
  const out = enforce(a, 1, appByKey("portal"), false, REFRAMED, false);
  assert.equal(out.tier, "bigger");
  assert.match(out.bigger_reasons.join(";"), /no approved app card/);
});

test("with an approved app card a small fix stays small", () => {
  assert.equal(enforce(a, 1, appByKey("portal"), false, REFRAMED, true).tier, "small");
});

test("the card flag changes nothing on the older build apps", () => {
  assert.equal(enforce({ ...a, app: "dashboard" }, 1, appByKey("dashboard"), false, REFRAMED, false).tier, "small");
});

test("an app card is a '## App card' heading in the design notes", () => {
  assert.equal(hasAppCard("# Design\n\n## App card\nWhat it is for"), true);
  assert.equal(hasAppCard("# Design\nNo card here. ## App card in prose"), false);
  assert.equal(hasAppCard(null), false);
});

test("the summary names Jamie as the checker on these apps", () => {
  assert.match(JSON.stringify(summaryBlocks("U1", a, appByKey("portal")!, "v")), /Jamie will check it/);
  assert.match(JSON.stringify(summaryBlocks("U1", a, appByKey("dashboard")!, "v")), /Sam will check it/);
});
