import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canGrill, grillMeta, grillText, isGrillAction, readGrill } from "./handlers";
import { SKILL_FILE, SLACK_PART, contextBlock, conversation, slugify, specPath, splitForSlack, toSlack } from "./prompt";

test("the grill uses Matt Pocock's grilling skill, as shipped (grill-me just points to it)", () => {
  const me = readFileSync("grill/skills/grill-me/SKILL.md", "utf8");
  assert.match(me, /^---\nname: grill-me\n/);
  assert.match(me, /Call the Skill tool with "grilling"\./);
  const skill = readFileSync(SKILL_FILE, "utf8");
  assert.match(skill, /^---\nname: grilling\n/);
  assert.match(skill, /Interview the user relentlessly until you reach a shared understanding\./);
  assert.match(skill, /The session is done when the frontier is empty/);
});

test("only Sam can grill", () => {
  assert.equal(canGrill("sam@fomorentals.co.uk"), true);
  assert.equal(canGrill(" Sam@FOMORentals.co.uk "), true);
  for (const e of ["louis@fomorentals.co.uk", "rosie@fomorentals.co.uk", "will@fomorentals.co.uk", "", "sam@example.com"]) assert.equal(canGrill(e), false, e);
});

test("a grill's state survives the round trip through Slack metadata", () => {
  const g = { by: "U1", name: "Rosie", idea: "A report", stage: "confirm" as const, title: "Morning pipeline", spec: "" };
  const meta = grillMeta(g);
  assert.ok(Object.values(meta.event_payload).every((v) => typeof v === "string"));
  assert.deepEqual(readGrill(meta), g);
  assert.equal(readGrill({ event_type: "ar_request", event_payload: { by: "U1", idea: "x" } }), null);
  assert.equal(readGrill(undefined), null);
  assert.equal(readGrill({ event_type: "ar_grill", event_payload: { by: "U1", idea: "x", stage: "nonsense" } })?.stage, "grilling");
});

test("grill buttons are told apart from the request and listing buttons", () => {
  assert.equal(isGrillAction({ type: "block_actions", actions: [{ action_id: "grill_yes" }] }), true);
  assert.equal(isGrillAction({ type: "block_actions", actions: [{ action_id: "confirm" }] }), false);
  assert.equal(isGrillAction({ type: "block_actions", actions: [{ action_id: "lk_publish" }] }), false);
  assert.equal(isGrillAction({ type: "view_submission" }), false);
});

test("the thread becomes alternating turns, starting with the idea", () => {
  const turns = conversation("A downloadable report", "Sam", [
    { who: "bot", name: "bot", text: "Q1 ...", images: 0 },
    { who: "starter", name: "Sam", text: "1 yes", images: 0 },
    { who: "starter", name: "Sam", text: "", images: 2 },
    { who: "other", name: "Louis", text: "we use the TV", images: 0 },
  ]);
  assert.deepEqual(
    turns.map((t) => t.role),
    ["user", "assistant", "user"],
  );
  assert.match(turns[0].text, /^Sam's idea, to grill: A downloadable report/);
  assert.match(turns[2].text, /1 yes/);
  assert.match(turns[2].text, /\[2 screenshots attached\]/);
  assert.match(turns[2].text, /Louis, not Sam, chipped in/);
});

test("the first round is the idea alone", () => {
  assert.deepEqual(conversation("X", "Sam", []), [{ role: "user", text: "Sam's idea, to grill: X" }]);
});

test("the skill's markdown is shown properly in Slack", () => {
  const md = "❓ **Q1** - **Which notes?**: the body\n\n➡️ yes\n\n---\n\n## Heading\n[link](https://x.y/z)";
  assert.equal(toSlack(md), "❓ *Q1* - *Which notes?*: the body\n\n➡️ yes\n\n──────────\n\n*Heading*\n<https://x.y/z|link>");
});

test("spec file names", () => {
  assert.equal(slugify("Morning pipeline view: by bookie!"), "morning-pipeline-view-by-bookie");
  assert.equal(slugify("???"), "spec");
  assert.equal(specPath("2026-11-24", "Morning pipeline view"), "specs/2026-11-24-morning-pipeline-view.md");
});

test("context leaves out empty design notes and keeps the status file", () => {
  const c = contextBlock([{ path: "grill/context/where-we-are.md", text: "STATUS" }, { path: "grill/context/x.md", text: null }], [
    { repo: "fomo-overtime", path: "docs/DESIGN.md", text: "" },
    { repo: "fomo-bookings-board-v2", path: "docs/DESIGN.md", text: "BOARD NOTES" },
  ]);
  assert.match(c, /STATUS/);
  assert.match(c, /fomo-bookings-board-v2\/docs\/DESIGN.md/);
  assert.doesNotMatch(c, /fomo-overtime\/docs\/DESIGN.md/);
  assert.doesNotMatch(c, /grill\/context\/x.md/);
});

test('"/grill idea" typed as a message is recognised, however Slack formats it', () => {
  assert.equal(grillText("/grill a morning view"), "a morning view");
  assert.equal(grillText("`/grill` each morning, I'd like\nto sit down"), "each morning, I'd like\nto sit down");
  assert.equal(grillText("  /GRILL   x"), "x");
  assert.equal(grillText("/grill"), "");
  assert.equal(grillText("/grilling is fun"), null);
  assert.equal(grillText("please /grill this"), null);
  assert.equal(grillText(undefined), null);
});

test("a long round is split into messages Slack accepts, losing nothing (msg_too_long, 23 Nov 2026)", () => {
  const paras = Array.from({ length: 12 }, (_, i) => `❓ *Q${i + 1}* ${"word ".repeat(150)}`.trim());
  const text = paras.join("\n\n");
  const parts = splitForSlack(text);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= SLACK_PART, String(p.length));
  assert.equal(parts.join("\n\n"), text); // split only at blank lines here
  assert.deepEqual(splitForSlack("short"), ["short"]);
  const long = "x".repeat(SLACK_PART * 2 + 10); // one huge line still fits, in hard cuts
  assert.equal(splitForSlack(long).join(""), long);
  assert.ok(splitForSlack(long).every((p) => p.length <= SLACK_PART));
  const lines = Array.from({ length: 200 }, (_, i) => `- line ${i} ${"y".repeat(30)}`).join("\n"); // one long paragraph
  assert.equal(splitForSlack(lines).join("\n"), lines);
});
