import assert from "node:assert/strict";
import { test } from "node:test";
import { appByKey } from "./config";
import { issueBody, readRefMarker, refMarker } from "./issue";
import { newCard } from "./records";

const summary = { title: "Fix the filter", now: "a", should: "b", who: "c", done: "d", plan: "e" };

test("the issue points back at the Slack thread", () => {
  assert.deepEqual(readRefMarker(`x\n${refMarker("C0ABC", "1763400000.123456")}\ny`), { channel: "C0ABC", thread: "1763400000.123456" });
});

test("a contradiction Jamie approved tells the builder to record the new decision", () => {
  const card = { ...newCard("U1"), tier: "bigger" as const, summary, contradiction: "No Rentman calls (5 Nov 2026)" };
  const body = issueBody({ app: appByKey("overtime")!, card, requesterName: "Rosie", approverName: "Jamie", link: "https://x", thread: "t", channel: "C1", threadTs: "1.2", rules: "RULES", jamieApproved: true, today: "2026-11-17" });
  assert.match(body, /Update the design notes/);
  assert.match(body, /No Rentman calls/);
  assert.match(body, /Approves the finished change: \*\*Jamie\*\*/);
});

test("no summary, no issue", () => {
  assert.throws(() => issueBody({ app: appByKey("overtime")!, card: newCard("U1"), requesterName: "", approverName: "", link: "", thread: "", channel: "", threadTs: "", rules: "", jamieApproved: false, today: "" }));
});

test("a proposal Jamie said to build carries his go-ahead for the reasons it was bigger", () => {
  const card = { ...newCard("U1"), tier: "bigger" as const, summary, reasons: "needs extra Rentman calls" };
  const body = issueBody({ app: appByKey("dashboard")!, card, requesterName: "Will", approverName: "Jamie", link: "https://x", thread: "t", channel: "C1", threadTs: "1.2", rules: "RULES", jamieApproved: true, today: "2026-11-19" });
  assert.match(body, /## Jamie's go-ahead/);
  assert.match(body, /don't stop for them/);
  const small = issueBody({ app: appByKey("dashboard")!, card: { ...card, tier: "small" as const }, requesterName: "Will", approverName: "Sam", link: "https://x", thread: "t", channel: "C1", threadTs: "1.2", rules: "RULES", jamieApproved: false, today: "2026-11-19" });
  assert.doesNotMatch(small, /Jamie's go-ahead/);
});

test("the builder gets the details the team supplied, and is told never to guess one", () => {
  const card = { ...newCard("U1"), tier: "bigger" as const, summary, needs: [{ what: "The In house prep field's ID", where: "Rentman", value: "54" }] };
  const body = issueBody({ app: appByKey("dashboard")!, card, requesterName: "Louis", approverName: "Jamie", link: "https://x", thread: "t", channel: "C1", threadTs: "1.2", rules: "RULES", jamieApproved: true, today: "2026-11-23" });
  assert.match(body, /## Details the team supplied/);
  assert.match(body, /In house prep field's ID: \*\*54\*\*/);
  assert.match(body, /never guess it/);
});
