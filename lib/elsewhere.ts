/**
 * Done elsewhere, spotted by the bot (Jamie, 24 Nov 2026). Some requests get finished outside the bot (another Claude
 * session builds them straight into the app), so the bot never hears they're done. On the existing 15-minute tick, for
 * each request waiting on Jamie or failed (the stages with the "Done elsewhere" button), it looks at the pull requests
 * merged into that app since the request was made. When one clearly does what was asked, it marks the request done and
 * says so in the thread with an Undo button. When it isn't sure, it leaves the request alone.
 *
 * Calls per tick: one GitHub list of recently closed pull requests per app with a candidate request, and one Claude call
 * per request only when a pull request newer than the last one checked has merged. At most MAX_PER_TICK Claude calls.
 * No Rentman. A failed check is reported (rule 1) and tried again next tick.
 */
import Anthropic from "@anthropic-ai/sdk";
import { nameOf, postInThread, save, threadLines, type Loaded } from "./actions";
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

export type Match = { pr: number; sure: boolean; why: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pr", "sure", "why"],
  properties: {
    pr: { type: "integer", description: "The number of the pull request that does what was asked, or 0 if none does." },
    sure: { type: "boolean", description: "true only if that pull request clearly delivers what the person asked for, not just something nearby." },
    why: { type: "string", description: "One short plain-English sentence for the team: what that change did. Empty when pr is 0." },
  },
} as const;

const RULES = `You check whether a team member's app request at FOMO has already been done outside the request bot.
You get the request's Slack thread and the pull requests merged into that app since it was asked.
Pick a pull request only if it clearly delivers what the person asked for. A change to the same screen or a related
fix is not enough. A message in the thread saying it's done or live (from Jamie, say) is strong evidence, but still
name the pull request that did it. If none clearly does it, answer pr 0. Being wrong is worse than missing one.`;

let client: Anthropic | null = null;

/** One Claude call: which of these pull requests, if any, did this request. Throws on any failure (rule 1). */
export async function findMatch(thread: string, prs: MergedPr[]): Promise<Match> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic();
  const list = prs.map((p) => `#${p.number}: ${p.title} (merged ${new Date(p.mergedAt).toISOString().slice(0, 10)})\n${p.body}`).join("\n\n---\n\n");
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
  if (typeof m.pr !== "number" || typeof m.sure !== "boolean") throw new Error(`Done-elsewhere check answered in the wrong shape: ${text.slice(0, 200)}`);
  return m;
}

/** What the bot changes when it marks a request done itself, and what Undo puts back. Pure, tested. */
export function markDone(c: Card, pr: MergedPr, why: string): void {
  c.undo = JSON.stringify({ stage: c.stage, prUrl: c.prUrl, mergedAt: c.mergedAt, note: c.note });
  c.stage = !c.summary && !c.tier ? "answered" : "live";
  c.prUrl = pr.url;
  c.mergedAt = pr.mergedAt;
  c.note = `Spotted live in pull request #${pr.number}${why ? `: ${why}` : ""}`;
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
export async function checkDoneElsewhere(all: Loaded[], budgetLeft: () => boolean, onError: (err: unknown, l: Loaded) => void): Promise<number> {
  const byRepo = new Map<string, MergedPr[]>();
  let calls = 0;
  let marked = 0;
  for (const l of all) {
    const c = l.card;
    if (!isCandidate(c)) continue;
    if (calls >= MAX_PER_TICK || !budgetLeft()) break;
    try {
      const repo = appByKey(c.app)!.repo;
      if (!byRepo.has(repo)) byRepo.set(repo, await recentMerged(repo));
      const fresh = unchecked(byRepo.get(repo)!, c, Number(l.thread) * 1000);
      if (!fresh.length) continue;
      calls++;
      const m = await findMatch(transcript(await threadLines(l)), fresh);
      c.elsewhereSeen = fresh[fresh.length - 1].number; // never ask about these again, whatever the answer
      const pr = m.sure ? fresh.find((p) => p.number === m.pr) : undefined;
      if (!pr) {
        await save(l);
        continue;
      }
      markDone(c, pr, m.why);
      const text = `<@${c.requester}> this looks done ✅ It went live in <${pr.url}|${pr.title.replace(/[<>|]/g, "")}>${m.why ? `: ${m.why}` : "."} I've marked it as done. If that's wrong, tap Undo.`;
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
