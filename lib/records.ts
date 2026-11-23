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
  };
}

const NUMS = ["round", "askedAt", "issue", "pr", "pendingSince", "startedAt", "mergedAt", "catchUps", "looks", "lookIssue", "lookedAt"] as const;
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
  return { event_type: CARD, event_payload: p };
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

/** Stages where a build is using a slot. */
export function usesBuildSlot(s: Stage): boolean {
  return s === "building";
}

/** Stages where the requester's reply in the thread restarts the questions. */
export function reopensOnReply(s: Stage): boolean {
  return s === "reframe" || s === "grilling" || s === "confirm" || s === "answered" || s === "explained" || s === "closed";
}
