/**
 * Done elsewhere, spotted by the bot (Jamie, 24 Nov 2026). Some requests get finished outside the bot (another Claude
 * session builds them straight into the app), so the bot never hears they're done. On the existing 15-minute tick, for
 * each request waiting on Jamie or failed (the stages with the "Done elsewhere" button), it looks at the pull requests
 * merged into that app since the request was made, and at Jamie's replies in the thread. When a pull request clearly
 * does what was asked, or Jamie has said in the thread that it's done or sorted (some things are sorted without any
 * code change, Jamie 24 Nov 2026), it marks the request done and says so in the thread with an Undo button. When it
 * isn't sure, it leaves the request alone.
 *
 * Calls per tick: one GitHub list of recently closed pull requests per app with a candidate request, and one Claude call
 * per request only when a pull request newer than the last one checked has merged, or Jamie has replied since. At most MAX_PER_TICK Claude calls.
 * No Rentman. A failed check is reported (rule 1) and tried again next tick.
 */
import Anthropic from "@anthropic-ai/sdk";
import { nameOf, ownerId, postInThread, save, threadLines, type Loaded } from "./actions";
import { DONE_ELSEWHERE_FROM, type Block } from "./blocks";
import { OWNER, appByKey } from "./config";
import { gh } from "./github";
import { MODEL, transcript } from "./prompt";
import { encodeRef, type Card, type Stage } from "./records";
import { slack } from "./slack";

export const MAX_PER_TICK = 2;
const LOOKBACK = 30;

export type MergedPr = { number: number; title: string; body: string; url: string; mergedAt: number };

/** A request the bot should check: waiting on Jamie or failed, in an app with a repo. Pure, tested. */
export function isCandidate(c: Card): boolean {
  return DONE_ELSEWHERE_FROM.includes(c.stage) && !!appByKey(c.app)?.repo;
}

/** Pull requests merged after the request was made that haven't been checked against it yet, oldest first. Pure, tested. */
export function unchecked(prs: MergedPr[], c: Card, askedAtMs: number): MergedPr[] {
  return prs.filter((p) => p.mergedAt >= askedAtMs && p.number > c.elsewhereSeen && p.number !== c.pr).sort((a, b) => a.number - b.number);
}

/** The repo's recently merged pull requests (newest 30 closed ones). */
export async function recentMerged(repo: string): Promise<MergedPr[]> {
  const res = await gh(`/repos/${OWNER}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${LOOKBACK}`);
  const list = (await res.json()) as { number: number; title: string; body: string | null; html_url: string; merged_at: string | null }[];
  return list.filter((p) => p.merged_at).map((p) => ({ number: p.number, title: p.title, body: (p.body ?? "").slice(0, 1500), url: p.html_url, mergedAt: Date.parse(p.merged_at!) }));
}

/** Jamie's replies in the thread that haven't been checked yet. Pure, tested. */
export function newOwnerReplies(l: Pick<Loaded, "messages" | "thread" | "card">, owner: string): string[] {
  return l.messages
    .filter((m) => m.user === owner && m.ts !== l.thread && Number(m.ts) > Number(l.card.elsewhereMsg || 0))
    .map((m) => m.ts)
    .sort((a, b) => Number(a) - Number(b));
}

export type Match = { pr: number; sure: boolean; doneInThread: boolean; why: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pr", "sure", "doneInThread", "why"],
  properties: {
    pr: { type: "integer", description: "The number of the pull request that does what was asked, or 0 if none does." },
    sure: { type: "boolean", description: "true only if that pull request clearly delivers what the person asked for, not just something nearby." },
    doneInThread: { type: "boolean", description: "true only if Jamie says in the thread that this request is done, live or sorted (including 'nothing needed changing, it works now')." },
    why: { type: "string", description: "One short plain-English sentence for the team: what was done. Empty when neither applies." },
  },
} as const;

const RULES = `You check whether a team member's app request at FOMO has already been done outside the request bot.
You get the request's Slack thread and the pull requests merged into that app since it was asked.
Pick a pull request only if it clearly delivers what the person asked for. A change to the same screen or a related
fix is not enough. If none clearly does it, answer pr 0.
Separately, set doneInThread true only if Jamie has said in the thread that this request is done, live or sorted, or
that nothing needed changing and it now works. A question, a plan, or "I'll look at it" is not done.
Being wrong is worse than missing one.`;

let client: Anthropic | null = null;

/** One Claude call: which of these pull requests, if any, did this request. Throws on any failure (rule 1). */
export async function findMatch(thread: string, prs: MergedPr[]): Promise<Match> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic();
  const list = !prs.length ? "(none)" : prs.map((p) => `#${p.number}: ${p.title} (merged ${new Date(p.mergedAt).toISOString().slice(0, 10)})\n${p.body}`).join("\n\n---\n\n");
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: RULES,
    messages: [{ role: "user", content: `THE REQUEST'S SLACK THREAD:\n\n${thread}\n\nPULL REQUESTS MERGED SINCE:\n\n${list}` }],
  });
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`Done-elsewhere check stopped early (${res.stop_reason})`);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const m = JSON.parse(text) as Match;
  if (typeof m.pr !== "number" || typeof m.sure !== "boolean" || typeof m.doneInThread !== "boolean") throw new Error(`Done-elsewhere check answered in the wrong shape: ${text.slice(0, 200)}`);
  return m;
}

/** What the bot changes when it marks a request done itself, and what Undo puts back. Pure, tested. */
export function markDone(c: Card, pr: MergedPr | null, why: string, now: number): void {
  c.undo = JSON.stringify({ stage: c.stage, prUrl: c.prUrl, mergedAt: c.mergedAt, note: c.note });
  c.stage = !c.summary && !c.tier ? "answered" : "live";
  if (pr) c.prUrl = pr.url;
  c.mergedAt = pr ? pr.mergedAt : now;
  c.note = pr ? `Spotted live in pull request #${pr.number}${why ? `: ${why}` : ""}` : `Jamie said in the thread it's sorted${why ? `: ${why}` : ""}`;
}

export function undoDone(c: Card): boolean {
  if (!c.undo) return false;
  const u = JSON.parse(c.undo) as { stage: Stage; prUrl: string; mergedAt: number; note: string };
  c.stage = u.stage;
  c.prUrl = u.prUrl;
  c.mergedAt = u.mergedAt;
  c.note = u.note;
  c.undo = "";
  return true;
}

export function spottedBlocks(text: string, value: string): Block[] {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "actions", elements: [{ type: "button", action_id: "undo_elsewhere", text: { type: "plain_text", text: "Undo" }, value }] },
  ];
}

/**
 * Checks the candidate requests and marks the clear matches done. Returns how many it marked.
 * `budgetLeft` says whether the tick still has time for another Claude call.
 */
export async function checkDoneElsewhere(all: Loaded[], budgetLeft: () => boolean, onError: (err: unknown, l: Loaded) => void, now = Date.now()): Promise<number> {
  const byRepo = new Map<string, MergedPr[]>();
  let owner = "";
  let calls = 0;
  let marked = 0;
  for (const l of all) {
    const c = l.card;
    if (!isCandidate(c)) continue;
    if (calls >= MAX_PER_TICK || !budgetLeft()) break;
    try {
      owner ||= await ownerId();
      const repo = appByKey(c.app)!.repo;
      if (!byRepo.has(repo)) byRepo.set(repo, await recentMerged(repo));
      const fresh = unchecked(byRepo.get(repo)!, c, Number(l.thread) * 1000);
      const replies = newOwnerReplies(l, owner);
      if (!fresh.length && !replies.length) continue;
      calls++;
      const m = await findMatch(transcript(await threadLines(l)), fresh);
      // Never ask about these again, whatever the answer.
      if (fresh.length) c.elsewhereSeen = fresh[fresh.length - 1].number;
      if (replies.length) c.elsewhereMsg = replies[replies.length - 1];
      const pr = m.sure ? fresh.find((p) => p.number === m.pr) : undefined;
      if (!pr && !m.doneInThread) {
        await save(l);
        continue;
      }
      markDone(c, pr ?? null, m.why, now);
      const why = m.why ? ` ${m.why.replace(/[.\s]+$/, "")}.` : "";
      const text = pr
        ? `<@${c.requester}> this looks done ✅ It went live in <${pr.url}|${pr.title.replace(/[<>|]/g, "")}>.${why} I've marked it as done. If that's wrong, tap Undo.`
        : `<@${c.requester}> this looks sorted ✅ Jamie said so above.${why} I've marked it as done. If that's wrong, tap Undo.`;
      c.undoTs = await postInThread(l.channel, l.thread, text, spottedBlocks(text, encodeRef({ channel: l.channel, thread: l.thread })));
      await save(l);
      marked++;
    } catch (err) {
      onError(err, l);
    }
  }
  return marked;
}

/** The Undo button: puts the request back where it was and says who undid it. */
export async function undoSpotted(l: Loaded, userId: string): Promise<boolean> {
  const c = l.card;
  if (!undoDone(c)) return false;
  const ts = c.undoTs;
  c.undoTs = "";
  await save(l);
  if (ts) await slack("chat.update", { channel: l.channel, ts, text: `Undone by ${await nameOf(userId)}: not done yet.`, blocks: [] });
  return true;
}
