/**
 * Slack is the database (same as What's new). Each request's state lives as metadata on the
 * bot's status message in the request's thread: one source of truth, nothing else to keep in sync.
 * Pure (de)serialisers, tested.
 */
import type { Need } from "./prompt";
import type { Meta } from "./slack";

export const CARD = "ar_request";
export const APPROVAL = "ar_approval";

export type Stage =
  | "reframe" // Claude said how it reads the request and its size; waiting for the requester's "Yes, that's it" (23 Nov 2026)
  | "gate" // a new idea (or one that stepped up): waiting for Sam's Grill it / Keep it small / Park
  | "grill" // getting the full grill in this thread (lib/grill); the spec goes to Jamie
  | "grilling" // Claude asked questions; waiting on the requester
  | "confirm" // summary posted; waiting for the requester's ✅
  | "answered" // the app already does it, or it was a question: no change needed
  | "looking" // a "why is the app doing this?" question: GitHub is reading the app's code (read only)
  | "explained" // the look-into-it verdict is posted; waiting for the requester's tap (or nothing)
  | "handed" // an app the team can't request changes to: passed to Jamie
  | "queued" // confirmed small fix, waiting for a free build slot
  | "building" // GitHub is building it
  | "approval" // built; waiting for Sam's (or Jamie's) tap
  | "proposal" // bigger: proposal waiting for Jamie
  | "parked" // Jamie: not now
  | "declined"
  | "deploying" // merged; waiting for the live deploy
  | "live"
  | "closed" // the requester went quiet for 3 working days
  | "failed"; // the build couldn't do it

export type Summary = {
  title: string; // short, plain English
  now: string; // what happens now
  should: string; // what should happen instead
  who: string; // who it affects and how often
  done: string; // what "done" looks like
  plan: string; // what Claude will do, in plain English
};

export type Card = {
  requester: string; // Slack user id
  app: string; // app key, "" until known
  stage: Stage;
  round: number; // grill rounds asked so far
  askedAt: number; // when Claude last asked the requester something (ms), 0 if not waiting
  nudged: boolean;
  tier: "small" | "bigger" | "";
  reasons: string; // why it's bigger
  size: string; // S, M or L for a bigger change
  contradiction: string; // the decision it contradicts, quoted with its date
  noDecision: boolean; // no recorded decision on the topic
  summary: Summary | null;
  approver: "sam" | "jamie" | "";
  issue: number;
  pr: number;
  prUrl: string;
  preview: string;
  approvalTs: string; // the approver's DM message
  approvalChannel: string;
  copyTs: string; // Sam's copy of a proposal
  copyChannel: string;
  samComment: string;
  pendingSince: number; // waiting on an approver since (ms)
  reminded: boolean;
  startedAt: number; // build started (ms)
  mergeSha: string;
  mergedAt: number;
  catchUps: number; // times rebuilt on top of other changes that went live first
  note: string; // last outcome, e.g. why a build failed
  looks: number; // times the app's code was looked into for this question
  lookIssue: number; // the GitHub issue that started the latest look
  lookedAt: number; // the latest look started (ms)
  verdict: "" | "as_designed" | "broken" | "should_change" | "unsure"; // what the latest look found
  fixing: boolean; // the requester tapped Fix it: the question is now a change request
  needs: Need[]; // what only a person can supply (e.g. a Rentman field's ID), with the answers given (23 Nov 2026)
  // Right-sized grilling (Jamie, 23 Nov 2026): how Claude read the request, its size, and Sam's call on a new idea.
  reframed: boolean; // the requester confirmed the reading
  after: string; // what Claude read the requester as really being after
  scope: Scope;
  scopeWhy: string;
  keepSmall: string; // on a step-up: what to drop to keep it a change
  gate: "" | "grill" | "small" | "parked";
  gateTs: string; // Sam's buttons in the thread
  gateDmChannel: string;
  gateDmTs: string;
  // Done elsewhere, spotted by the bot (Jamie, 24 Nov 2026).
  elsewhereSeen: number; // the newest merged pull request already checked against this request
  elsewhereMsg: string; // the newest of Jamie's thread replies already checked ("it's done/sorted" counts too)
  undo: string; // JSON of what the bot changed when it marked this done itself, so Undo can put it back; "" otherwise
  undoTs: string; // the bot's "looks done" message in the thread, with the Undo button
  liveDm: string; // "channel|ts" of the requester's "it's live" DM after a spotted done, so Undo can correct it (26 Nov 2026)
  // Requests that clash with or repeat another one (Jamie, 24 Nov 2026: "too many cooks").
  relatedKind: "" | "duplicate" | "clash";
  relatedUrl: string; // link to the other request's post
  relatedWhy: string; // one line: whose request, when, and how they overlap
};

export type Scope = "" | "quick_fix" | "change" | "new_idea";

export function newCard(requester: string): Card {
  return {
    requester,
    app: "",
    stage: "grilling",
    round: 0,
    askedAt: 0,
    nudged: false,
    tier: "",
    reasons: "",
    size: "",
    contradiction: "",
    noDecision: false,
    summary: null,
    approver: "",
    issue: 0,
    pr: 0,
    prUrl: "",
    preview: "",
    approvalTs: "",
    approvalChannel: "",
    copyTs: "",
    copyChannel: "",
    samComment: "",
    pendingSince: 0,
    reminded: false,
    startedAt: 0,
    mergeSha: "",
    mergedAt: 0,
    catchUps: 0,
    note: "",
    looks: 0,
    lookIssue: 0,
    lookedAt: 0,
    verdict: "",
    fixing: false,
    needs: [],
    reframed: false,
    after: "",
    scope: "",
    scopeWhy: "",
    keepSmall: "",
    gate: "",
    gateTs: "",
    gateDmChannel: "",
    gateDmTs: "",
    elsewhereSeen: 0,
    elsewhereMsg: "",
    undo: "",
    undoTs: "",
    liveDm: "",
    relatedKind: "",
    relatedUrl: "",
    relatedWhy: "",
  };
}

const NUMS = ["round", "askedAt", "issue", "pr", "pendingSince", "startedAt", "mergedAt", "catchUps", "looks", "lookIssue", "lookedAt", "elsewhereSeen"] as const;
const BOOLS = ["nudged", "noDecision", "reminded", "fixing", "reframed"] as const;
const JSONS = ["summary", "needs"] as const;

export function cardMeta(c: Card): Meta {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (k === "summary") p[k] = v ? JSON.stringify(v) : "";
    else if (k === "needs") p[k] = JSON.stringify(v);
    else if (typeof v === "boolean") p[k] = v ? "1" : "0";
    else p[k] = String(v);
  }
  // Empty fields are left out (readCard fills them back in): they were a fifth of a big card (27 Nov 2026).
  for (const [k, v] of Object.entries(p)) if (k !== "requester" && k !== "stage" && (v === "" || v === "0" || v === "[]")) delete p[k];
  return { event_type: CARD, event_payload: p };
}

/**
 * Slack quietly drops message metadata that is too big: the update still succeeds, the card looks right, but the
 * request's data is gone and every later tap says "not found" (Will's Kit Prep request, 27 Nov 2026, ~4.2 KB).
 * Empty fields are left out, and a card is kept under this size, trimming the longest free-text notes first. The full wording is still in the
 * thread's messages; only the card's copy is shortened.
 */
export const CARD_META_MAX = 3500;
/** The second try, if Slack still drops a card at CARD_META_MAX. */
export const CARD_META_TIGHT = 2500;

export function metaBytes(m: Meta): number {
  return Buffer.byteLength(JSON.stringify(m), "utf8");
}

// Least needed first. The summary goes last: it becomes Jamie's proposal and Sam's approval message.
const TRIM: { field: keyof Card; floor: number }[] = [
  { field: "after", floor: 160 },
  { field: "scopeWhy", floor: 160 },
  { field: "relatedWhy", floor: 160 },
  { field: "keepSmall", floor: 160 },
  { field: "samComment", floor: 240 },
  { field: "note", floor: 240 },
  { field: "reasons", floor: 240 },
  { field: "contradiction", floor: 240 },
];
const SUMMARY_TRIM: (keyof Summary)[] = ["now", "who", "done", "should", "plan"];

function cut(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/** The card, with its longest notes shortened until its metadata fits in `max` bytes. */
export function fitCard(c: Card, max = CARD_META_MAX): Card {
  if (metaBytes(cardMeta(c)) <= max) return c;
  const out: Card = { ...c, summary: c.summary ? { ...c.summary } : null };
  const rec = out as Record<string, unknown>;
  for (const { field, floor } of TRIM) {
    rec[field] = cut(String(rec[field] ?? ""), floor);
    if (metaBytes(cardMeta(out)) <= max) return out;
  }
  for (const floor of [500, 300, 160]) {
    if (!out.summary) break;
    for (const k of SUMMARY_TRIM) {
      out.summary[k] = cut(out.summary[k], floor);
      if (metaBytes(cardMeta(out)) <= max) return out;
    }
  }
  return out;
}

export function readCard(meta: Meta | undefined): Card | null {
  if (meta?.event_type !== CARD) return null;
  const p = meta.event_payload;
  if (!p.requester || !p.stage) return null;
  const c = newCard(p.requester) as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    const v = p[k];
    if (v === undefined) continue;
    if ((NUMS as readonly string[]).includes(k)) c[k] = Number(v) || 0;
    else if ((BOOLS as readonly string[]).includes(k)) c[k] = v === "1";
    else if ((JSONS as readonly string[]).includes(k)) {
      const empty = k === "needs" ? [] : null;
      try {
        c[k] = v ? JSON.parse(v) : empty;
      } catch {
        c[k] = empty;
      }
    } else c[k] = v;
  }
  return c as Card;
}

/** Approval and proposal DMs point back at the request: its channel and thread. */
export type ApprovalRef = { channel: string; thread: string };

export function approvalMeta(r: ApprovalRef): Meta {
  return { event_type: APPROVAL, event_payload: { channel: r.channel, thread: r.thread } };
}

/** Button values carry the request's thread ts; one encoding, so handlers can't disagree. */
export function encodeRef(r: ApprovalRef): string {
  return `${r.channel}|${r.thread}`;
}

export function decodeRef(v: string | undefined): ApprovalRef | null {
  const [channel, thread] = (v ?? "").split("|");
  return channel && thread ? { channel, thread } : null;
}

/**
 * A "why is the app doing this?" question rather than a change: no summary, no size, never reframed or grilled.
 * A grilled idea has no summary or size either, so without the last two checks it was marked "Answered, no change
 * needed" when it went live (Will's stock take, 26 Nov 2026). Pure, tested.
 */
export function isQuestion(c: Card): boolean {
  return !c.summary && !c.tier && !c.reframed && !c.gate;
}

/** Stages where a build is using a slot. */
export function usesBuildSlot(s: Stage): boolean {
  return s === "building";
}

/** Stages where the requester's reply in the thread restarts the questions. */
export function reopensOnReply(s: Stage): boolean {
  return s === "reframe" || s === "grilling" || s === "confirm" || s === "answered" || s === "explained" || s === "closed";
}
