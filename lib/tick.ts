/**
 * The 15-minute cron (vercel.json, at :07, :22, :37, :52; What's new and Overtime run at :00).
 * 1. Requesters who went quiet: one nudge after 1 working day, closed after 3.
 * 2. Approvals and proposals nobody has tapped: one reminder to Sam and Jamie at 9:00 London the next working morning.
 * 3. Queued builds start when a slot frees up.
 * 4. Builds that never reported back are marked failed (rule 1).
 * 5. Merged changes: checks the live deploy actually happened before saying "Live" (rule 5).
 * Runs at most 60 s (maxDuration) against a 15-minute interval, so two runs can't overlap and no lock is needed.
 * It stops itself at 50 s and logs INCOMPLETE (rule 2). One failure doesn't stop the rest; failures are counted (rule 1).
 */
import { allRequests, appOf, buildsRunning, dm, link, postInThread, save, startBuild, type Loaded } from "./actions";
import { APPROVER_EMAIL, OWNER_EMAIL } from "./config";
import { productionDeploy } from "./github";
import { report } from "./report";
import { channel } from "./slack";
import { addWorkingDays, isMorningSlot, londonDate } from "./time";

const BUILD_TIMEOUT = 2 * 60 * 60_000;
const DEPLOY_WARN = 45 * 60_000;
const BUDGET = 50_000;

export type TickResult = { nudged: number; closed: number; reminded: number; started: number; live: number; failures: number; incomplete: boolean };

/** What the cron should do with one request. Pure, tested. */
export function due(l: Loaded, now: number): "nudge" | "close" | "remind" | "start" | "timeout" | "check_deploy" | null {
  const c = l.card;
  if ((c.stage === "grilling" || c.stage === "confirm") && c.askedAt) {
    if (now >= addWorkingDays(c.askedAt, 3)) return "close";
    if (!c.nudged && now >= addWorkingDays(c.askedAt, 1)) return "nudge";
  }
  if ((c.stage === "approval" || c.stage === "proposal") && c.pendingSince && !c.reminded && isMorningSlot(now) && londonDate(c.pendingSince) < londonDate(now))
    return "remind";
  if (c.stage === "queued") return "start";
  if (c.stage === "building" && c.startedAt && now - c.startedAt > BUILD_TIMEOUT) return "timeout";
  if (c.stage === "deploying") return "check_deploy";
  return null;
}

export async function runTick(now = Date.now()): Promise<TickResult> {
  const r: TickResult = { nudged: 0, closed: 0, reminded: 0, started: 0, live: 0, failures: 0, incomplete: false };
  const all = await allRequests(channel(), now);
  let running = buildsRunning(all);
  for (const l of all) {
    if (Date.now() - now > BUDGET) {
      r.incomplete = true;
      console.log("INCOMPLETE tick stopped at its 50 s budget; the rest wait for the next run");
      report(new Error("Tick stopped at its 50 s budget"), "tick.incomplete", { requests: all.length });
      break;
    }
    try {
      const c = l.card;
      const what = due(l, now);
      if (!what) continue;
      if (what === "nudge") {
        await postInThread(l.channel, l.thread, `<@${c.requester}> just checking: I need your answers above to get this right. If I don't hear back in 2 working days I'll close it (you can reopen it by replying).`);
        c.nudged = true;
        await save(l);
        r.nudged++;
      } else if (what === "close") {
        c.stage = "closed";
        c.askedAt = 0;
        await save(l);
        await postInThread(l.channel, l.thread, `<@${c.requester}> I've closed this for now. Reply here any time to pick it up again.`);
        r.closed++;
      } else if (what === "remind") {
        const title = c.summary?.title ?? "a request";
        const what2 = c.stage === "proposal" ? `Jamie's decision on the proposal "${title}"` : `${c.approver === "jamie" ? "Jamie's" : "Sam's"} approval of "${title}"`;
        const text = `Reminder: still waiting for ${what2}. ${await link(l)}`;
        await dm(APPROVER_EMAIL, text);
        await dm(OWNER_EMAIL, text);
        c.reminded = true;
        await save(l);
        r.reminded++;
      } else if (what === "start") {
        if ((await startBuild(l, c.approver === "jamie" ? "jamie" : "sam", running, now)) === "started") {
          running++;
          r.started++;
        }
      } else if (what === "timeout") {
        c.stage = "failed";
        c.note = "The build didn't report back within 2 hours.";
        await save(l);
        await dm(OWNER_EMAIL, `A build didn't report back within 2 hours: "${c.summary?.title}". Check the "App request build" run on GitHub. ${await link(l)}`);
        r.failures++;
        report(new Error(`Build for ${l.card.app} #${c.issue} didn't report back`), "tick.build_timeout");
      } else if (what === "check_deploy") {
        const d = await productionDeploy(appOf(l).repo, c.mergeSha);
        if (d.state === "success") {
          c.stage = "live";
          await save(l);
          await postInThread(l.channel, l.thread, `<@${c.requester}> it's live ✅. What's new will tell the team.`);
          r.live++;
        } else if (d.state === "failure") {
          c.stage = "failed";
          c.note = "It merged but the live deploy failed.";
          await save(l);
          await dm(OWNER_EMAIL, `The live deploy failed for "${c.summary?.title}" (${appOf(l).name}). ${d.url} ${await link(l)}`);
          r.failures++;
        } else if (now - c.mergedAt > DEPLOY_WARN && !c.nudged) {
          c.nudged = true; // reused as "Jamie has been told the deploy is slow"
          await save(l);
          await dm(OWNER_EMAIL, `"${c.summary?.title}" was merged ${Math.round((now - c.mergedAt) / 60_000)} minutes ago and the live deploy hasn't shown up yet (${d.state}). ${await link(l)}`);
        }
      }
    } catch (err) {
      r.failures++;
      report(err, "tick.request", { thread: l.thread, stage: l.card.stage });
    }
  }
  return r;
}
