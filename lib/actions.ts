/** Side effects shared by the handlers and the cron: load and save a request, read its thread, start a build. */
import { cardBlocks, type Block } from "./blocks";
import { APPROVER_EMAIL, MAX_BUILDS, OWNER_EMAIL, PEOPLE, appByKey, type App } from "./config";
import { fileNow, openBuildIssue } from "./github";
import { issueBody, issueTitle } from "./issue";
import type { Line } from "./prompt";
import { transcript } from "./prompt";
import { CARD, cardMeta, readCard, type Card } from "./records";
import { dmChannel, history, messageLink, replies, slack, userEmail, userIdByEmail, type SlackMessage } from "./slack";
import { londonDate } from "./time";

export type Loaded = { channel: string; thread: string; cardTs: string; card: Card; messages: SlackMessage[] };

let botIdCache: string | null = null;

export async function botId(): Promise<string> {
  botIdCache ??= (await slack<{ bot_id: string }>("auth.test", {})).bot_id;
  return botIdCache;
}

/** A request: its thread and its status card (the bot's message carrying the request's data). */
export async function load(channel: string, thread: string): Promise<Loaded | null> {
  const messages = await replies(channel, thread);
  const me = await botId();
  for (const m of messages) {
    if (m.bot_id !== me || m.metadata?.event_type !== CARD) continue;
    const card = readCard(m.metadata);
    if (card) return { channel, thread, cardTs: m.ts, card, messages };
  }
  return null;
}

/** Writes the request's data back onto its status card and redraws the status line. */
export async function save(l: Loaded): Promise<void> {
  const app = appByKey(l.card.app);
  await slack("chat.update", {
    channel: l.channel,
    ts: l.cardTs,
    text: "Request status",
    blocks: cardBlocks(l.card, app),
    metadata: cardMeta(l.card),
  });
}

export async function postInThread(channel: string, thread: string, text: string, blocks?: Block[]): Promise<string> {
  const res = await slack<{ ts: string }>("chat.postMessage", { channel, thread_ts: thread, text, blocks, unfurl_links: false });
  return res.ts;
}

export async function dm(email: string, text: string, blocks?: Block[], metadata?: unknown): Promise<{ channel: string; ts: string }> {
  const ch = await dmChannel(await userIdByEmail(email));
  const res = await slack<{ ts: string; channel: string }>("chat.postMessage", { channel: ch, text, blocks, metadata, unfurl_links: false });
  return { channel: res.channel, ts: res.ts };
}

export const ownerId = () => userIdByEmail(OWNER_EMAIL);
export const approverId = () => userIdByEmail(APPROVER_EMAIL);

/** A person's first name for the thread as Claude reads it. */
export async function nameOf(userId: string): Promise<string> {
  const email = await userEmail(userId).catch(() => "");
  return PEOPLE.find((p) => p.email === email)?.name ?? "someone";
}

/** The thread as Claude reads it: everything except the status card. */
export async function threadLines(l: Loaded): Promise<Line[]> {
  const me = await botId();
  const out: Line[] = [];
  for (const m of l.messages) {
    if (m.ts === l.cardTs) continue;
    const text = (m.text ?? "").trim();
    const files = (m.files ?? []).map((f) => `[attached: ${f.name ?? "a file"}]`).join(" ");
    if (!text && !files) continue;
    if (m.bot_id === me) out.push({ who: "Claude", role: "claude", text });
    else if (m.bot_id) continue;
    else out.push({ who: await nameOf(m.user ?? ""), role: m.user === l.card.requester ? "requester" : "other", text: [text, files].filter(Boolean).join("\n") });
  }
  return out;
}

export function link(l: { channel: string; thread: string }): Promise<string> {
  return messageLink(l.channel, l.thread);
}

/** Every request in the channel with activity in the last 30 days. */
export async function allRequests(channel: string, now: number): Promise<Loaded[]> {
  const top = await history(channel, now - 30 * 24 * 60 * 60_000);
  const out: Loaded[] = [];
  for (const m of top) {
    if (!m.reply_count) continue;
    const l = await load(channel, m.ts);
    if (l) out.push(l);
  }
  return out;
}

export function buildsRunning(all: Loaded[]): number {
  return all.filter((l) => l.card.stage === "building").length;
}

/**
 * Opens the build issue in the app's repo (its workflow then builds the change). Leaves the request
 * "queued" when MAX_BUILDS are already running; the cron starts it when a slot frees up.
 */
export async function startBuild(l: Loaded, approver: "sam" | "jamie", running: number, now: number): Promise<"started" | "queued"> {
  const app = appByKey(l.card.app);
  if (!app || app.mode === "not_offered") throw new Error(`startBuild: no buildable app for ${l.card.app}`);
  l.card.approver = approver;
  if (running >= MAX_BUILDS) {
    l.card.stage = "queued";
    await save(l);
    await postInThread(l.channel, l.thread, `Confirmed. ${MAX_BUILDS} changes are being built right now, so this one is next in the queue.`);
    return "queued";
  }
  const rules = (await fileNow("fomo-app-requests", "rules/FOMO-ENGINEERING-RULES.md")) ?? "";
  if (!rules) throw new Error("rules/FOMO-ENGINEERING-RULES.md is missing from fomo-app-requests");
  const body = issueBody({
    app,
    card: l.card,
    requesterName: await nameOf(l.card.requester),
    approverName: approver === "jamie" ? "Jamie" : "Sam",
    link: await link(l),
    thread: transcript(await threadLines(l)),
    channel: l.channel,
    threadTs: l.thread,
    rules,
    jamieApproved: approver === "jamie",
    today: londonDate(now),
  });
  const issue = await openBuildIssue(app.repo, issueTitle(l.card.summary!), body);
  l.card.issue = issue.number;
  l.card.stage = "building";
  l.card.startedAt = now;
  l.card.note = "";
  await save(l);
  await postInThread(l.channel, l.thread, "Building it now. This usually takes 10 to 20 minutes.");
  return "started";
}

export function appOf(l: Loaded): App {
  const app = appByKey(l.card.app);
  if (!app) throw new Error(`Request ${l.thread} has no known app (${l.card.app || "none"})`);
  return app;
}

