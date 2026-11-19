/** Slack events (new requests, replies), buttons and forms, and the builder's report back. */
import {
  answerBlocks,
  cardBlocks,
  approvalBlocks,
  doneBlocks,
  failedBlocks,
  proposalBlocks,
  questionBlocks,
  summaryBlocks,
  textModal,
  type Built,
} from "./blocks";
import { APPROVER_EMAIL, NOTES_FILES, OWNER_EMAIL, appByKey, personByEmail } from "./config";
import { assess, type Image } from "./claude";
import { closeIssue, closePr, fileNow, mergePr, rebuild } from "./github";
import {
  allRequests,
  appOf,
  buildsRunning,
  dm,
  link,
  load,
  nameOf,
  postInThread,
  save,
  startBuild,
  threadLines,
  type Loaded,
} from "./actions";
import { enforce, notesBlock, transcript, turnPrompt, type Assessment } from "./prompt";
import { approvalMeta, cardMeta, decodeRef, encodeRef, newCard, reopensOnReply } from "./records";
import { report } from "./report";
import { channel as requestsChannel, fileBase64, slack, userEmail } from "./slack";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const MAX_IMAGE_BYTES = 3_500_000;

// ---------- Events ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleEvent(e: any): Promise<void> {
  if (e?.type !== "message" || e.channel !== requestsChannel()) return;
  if (e.bot_id || (e.subtype && e.subtype !== "file_share" && e.subtype !== "thread_broadcast")) return;
  const isNew = !e.thread_ts || e.thread_ts === e.ts;
  if (isNew) return newRequest(e.channel, e.ts, e.user);
  const l = await load(e.channel, e.thread_ts);
  if (!l || e.user !== l.card.requester || !reopensOnReply(l.card.stage)) return;
  return turn(l);
}

async function newRequest(channel: string, ts: string, user: string): Promise<void> {
  const person = personByEmail(await userEmail(user));
  if (!person) {
    await postInThread(channel, ts, "Only the FOMO team can ask for app changes here. Please ask Jamie.");
    return;
  }
  const card = newCard(user);
  const res = await slack<{ ts: string }>("chat.postMessage", {
    channel,
    thread_ts: ts,
    text: "Request status",
    blocks: cardBlocks(card, undefined),
    metadata: cardMeta(card),
  });
  const l = await load(channel, ts);
  if (!l || l.cardTs !== res.ts) throw new Error(`New request ${ts}: status card not found after posting it`);
  await turn(l);
}

async function images(l: Loaded): Promise<Image[]> {
  const out: Image[] = [];
  for (const m of l.messages) {
    if (m.user !== l.card.requester) continue;
    for (const f of m.files ?? []) {
      const type = IMAGE_TYPES.find((t) => t === f.mimetype);
      if (!type || !f.url_private || (f.size ?? 0) > MAX_IMAGE_BYTES || out.length >= 3) continue;
      out.push({ mediaType: type, data: await fileBase64(f.url_private) });
    }
  }
  return out;
}

async function notesFor(appKey: string): Promise<string> {
  const app = appByKey(appKey);
  if (!app) return notesBlock(undefined, []);
  const notes = await Promise.all(NOTES_FILES.map(async (path) => ({ path, text: await fileNow(app.repo, path) })));
  return notesBlock(app, notes);
}

/** One turn: Claude reads the thread, then asks questions, summarises, or answers. */
export async function turn(l: Loaded, now = Date.now()): Promise<void> {
  try {
    const thread = transcript(await threadLines(l));
    const pics = await images(l);
    const run = async (appKey: string) => assess({ notes: await notesFor(appKey), thread, turn: turnPrompt(l.card.round, appKey), images: pics });
    let a: Assessment = await run(l.card.app);
    // First time the app is known: read again, this time with that app's design notes.
    if (appByKey(a.app) && a.app !== l.card.app) {
      l.card.app = a.app;
      a = await run(a.app);
      if (appByKey(a.app)) l.card.app = a.app;
    }
    const app = appByKey(l.card.app);
    a = enforce(a, l.card.round, app);
    await act(l, a, now);
  } catch (err) {
    report(err, "turn", { thread: l.thread });
    await postInThread(l.channel, l.thread, "Sorry, something went wrong while I was reading this. Jamie has been told. Reply here to try again.").catch((e) =>
      report(e, "turn.apology"),
    );
  }
}

async function act(l: Loaded, a: Assessment, now: number): Promise<void> {
  const c = l.card;
  const app = appByKey(c.app);
  if (a.next === "ask") {
    c.round += 1;
    c.stage = "grilling";
    c.askedAt = now;
    c.nudged = false;
    const text = a.questions.map((q, i) => `${i + 1}. ${q.q} (Suggested: ${q.suggested})`).join("\n");
    await postInThread(l.channel, l.thread, text, questionBlocks(c.requester, a, c.round));
  } else if (a.next === "summarise" && app) {
    c.stage = "confirm";
    c.askedAt = now;
    c.nudged = false;
    c.summary = a.summary;
    c.tier = a.tier;
    c.reasons = a.tier === "bigger" ? a.bigger_reasons.join("; ") : "";
    c.contradiction = a.contradiction.found
      ? `${a.contradiction.decision}${a.contradiction.decided_on ? ` (${a.contradiction.decided_on})` : ""}${a.contradiction.where ? ` [${a.contradiction.where}]` : ""}`
      : "";
    c.noDecision = !a.recorded_decision_found;
    c.size = a.size;
    const text = `Here's what I'll do: ${a.summary.title}. ${a.summary.plan}`;
    await postInThread(l.channel, l.thread, text, summaryBlocks(c.requester, a, app, encodeRef(l)));
  } else {
    const handed = !app || app.mode === "not_offered";
    c.stage = handed ? "handed" : "answered";
    c.askedAt = 0;
    const text = a.how_to || (handed ? "That one's for Jamie, so I've passed it to him." : "The app already does this.");
    await postInThread(l.channel, l.thread, text, answerBlocks(c.requester, text));
    if (handed) await dm(OWNER_EMAIL, `A request for you from ${await nameOf(c.requester)}: ${await link(l)}`);
  }
  await save(l);
}

// ---------- Buttons and forms ----------

type Who = { id: string; email: string; isOwner: boolean; isApprover: boolean };

async function who(userId: string): Promise<Who> {
  const email = await userEmail(userId);
  return { id: userId, email, isOwner: email === OWNER_EMAIL, isApprover: email === APPROVER_EMAIL };
}

async function ephemeral(channel: string, user: string, text: string): Promise<void> {
  await slack("chat.postEphemeral", { channel, user, text });
}

/** Replace a DM's buttons with what happened. */
async function settle(channel: string, ts: string, title: string, outcome: string): Promise<void> {
  if (channel && ts) await slack("chat.update", { channel, ts, text: `${title}: ${outcome}`, blocks: doneBlocks(title, outcome) });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleInteraction(p: any): Promise<object | null> {
  if (p.type === "block_actions") {
    const action = p.actions?.[0];
    const ref = decodeRef(action?.value);
    if (!ref) return null;
    const l = await load(ref.channel, ref.thread);
    if (!l) throw new Error(`Button ${action.action_id}: request ${ref.thread} not found`);
    const u = await who(p.user.id);
    const where = p.channel?.id ?? ref.channel;
    const deny = (msg: string) => ephemeral(where, u.id, msg);
    const modal = (callbackId: string, title: string, label: string, submit: string) =>
      slack("views.open", { trigger_id: p.trigger_id, view: textModal({ callbackId, title, label, submit, value: action.value }) });

    switch (action.action_id) {
      case "confirm":
        if (u.id !== l.card.requester && !u.isOwner) { await deny("Only the person who asked can confirm this."); return null; }
        if (l.card.stage !== "confirm") return null;
        await slack("chat.update", { channel: p.channel.id, ts: p.message.ts, text: "Confirmed", blocks: [...p.message.blocks.filter((b: { type: string }) => b.type !== "actions"), { type: "context", elements: [{ type: "mrkdwn", text: `✅ Confirmed by <@${u.id}>` }] }] });
        await confirmed(l);
        return null;
      case "approve":
        if (!(u.isOwner || (u.isApprover && l.card.approver === "sam"))) { await deny(l.card.approver === "jamie" ? "Jamie approves this one." : "Only Sam or Jamie can approve this."); return null; }
        if (l.card.stage !== "approval") return null;
        await approve(l, u);
        return null;
      case "changes":
      case "reject":
        if (!(u.isOwner || (u.isApprover && l.card.approver === "sam"))) { await deny("Only the approver can do this."); return null; }
        if (l.card.stage !== "approval") return null;
        if (action.action_id === "changes") await modal("changes", "Ask for changes", "What should change?", "Send");
        else await modal("reject", "Reject", "Why? The requester will see this.", "Reject");
        return null;
      case "build_it":
      case "not_now":
      case "discuss":
      case "decline":
        if (!u.isOwner) { await deny("Jamie decides on proposals."); return null; }
        if (l.card.stage !== "proposal") return null;
        if (action.action_id === "decline") {
          await modal("decline", "Decline", "Why? The requester will see this.", "Decline");
          return null;
        }
        await proposalDecision(l, action.action_id, u);
        return null;
      case "sam_comment":
        if (!u.isApprover && !u.isOwner) return null;
        await modal("sam_comment", "Comment for Jamie", "Your comment", "Send");
        return null;
      case "retry":
      case "drop":
        if (!(u.isOwner || (u.isApprover && l.card.approver === "sam"))) { await deny("Only the approver can do this."); return null; }
        if (l.card.stage !== "failed") return null;
        if (action.action_id === "retry") {
          await rebuild(appOf(l).repo, l.card.issue, `Try again, asked by ${await nameOf(u.id)}.`);
          l.card.stage = "building";
          l.card.startedAt = Date.now();
          await save(l);
          await settle(p.channel.id, p.message.ts, l.card.summary?.title ?? "Request", "Trying again.");
          await postInThread(l.channel, l.thread, "Trying the build again.");
        } else {
          await closeIssue(appOf(l).repo, l.card.issue, "not_planned").catch((e) => report(e, "drop.close_issue"));
          l.card.stage = "declined";
          l.card.note = "the build didn't work and it was closed";
          await save(l);
          await settle(p.channel.id, p.message.ts, l.card.summary?.title ?? "Request", "Closed.");
          await postInThread(l.channel, l.thread, `<@${l.card.requester}> I couldn't build this one, so it's been closed. Jamie can pick it up another way.`);
        }
        return null;
    }
    return null;
  }

  if (p.type === "view_submission") {
    const ref = decodeRef(p.view?.private_metadata);
    if (!ref) return null;
    const text: string = p.view.state.values?.text?.text?.value?.trim() ?? "";
    if (!text) return { response_action: "errors", errors: { text: "Please write a few words." } };
    // Slack wants an answer within 3 seconds; the work runs after (see the route).
    return { after: () => submitted(p.view.callback_id, ref, text, p.user.id) };
  }
  return null;
}

async function confirmed(l: Loaded): Promise<void> {
  const app = appOf(l);
  const now = Date.now();
  if (l.card.tier === "small" && app.mode === "build") {
    const running = buildsRunning(await allRequests(l.channel, now));
    await startBuild(l, "sam", running, now);
    return;
  }
  await sendProposal(l);
  await postInThread(l.channel, l.thread, "Thanks. This is with Jamie as a proposal. Nothing is built until he says so.");
}

/** Bigger: a proposal for Jamie, with a copy for Sam. */
async function sendProposal(l: Loaded, now = Date.now()): Promise<void> {
  const app = appOf(l);
  l.card.stage = "proposal";
  l.card.pendingSince = now;
  l.card.reminded = false;
  const base = { app, requester: l.card.requester, summary: l.card.summary!, card: l.card, size: l.card.size || "M", link: await link(l), value: encodeRef(l) };
  const title = `Proposal: ${l.card.summary!.title}`;
  const j = await dm(OWNER_EMAIL, title, proposalBlocks({ ...base, forSam: false }), approvalMeta(l));
  const s = await dm(APPROVER_EMAIL, title, proposalBlocks({ ...base, forSam: true }), approvalMeta(l));
  l.card.approvalChannel = j.channel;
  l.card.approvalTs = j.ts;
  l.card.copyChannel = s.channel;
  l.card.copyTs = s.ts;
  await save(l);
}

async function approve(l: Loaded, u: Who): Promise<void> {
  const app = appOf(l);
  const name = await nameOf(u.id);
  let sha: string;
  try {
    sha = await mergePr(app.repo, l.card.pr);
  } catch (err) {
    report(err, "approve.merge", { repo: app.repo, pr: l.card.pr });
    await dm(u.email, `I couldn't ship "${l.card.summary?.title}": GitHub wouldn't merge it (${String(err).slice(0, 200)}). Tap "Ask for changes" to have it rebuilt, or tell Jamie.`);
    return;
  }
  l.card.stage = "deploying";
  l.card.mergeSha = sha;
  l.card.mergedAt = Date.now();
  l.card.nudged = false;
  await save(l);
  await settle(l.card.approvalChannel, l.card.approvalTs, l.card.summary?.title ?? "Change", `Approved by ${name}. Going live now.`);
  await postInThread(l.channel, l.thread, `Approved by ${name}. Going live now; I'll post here when it is.`);
}

async function proposalDecision(l: Loaded, action: string, u: Who): Promise<void> {
  const title = l.card.summary?.title ?? "Proposal";
  if (action === "build_it") {
    const running = buildsRunning(await allRequests(l.channel, Date.now()));
    await settle(l.card.approvalChannel, l.card.approvalTs, title, "You said build it. I'll send you the finished change to approve.");
    await settle(l.card.copyChannel, l.card.copyTs, title, "Jamie said build it.");
    await startBuild(l, "jamie", running, Date.now());
  } else if (action === "not_now") {
    l.card.stage = "parked";
    await save(l);
    await settle(l.card.approvalChannel, l.card.approvalTs, title, "Parked (not now).");
    await settle(l.card.copyChannel, l.card.copyTs, title, "Jamie: not now.");
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> Jamie says not now, so this is parked.`);
  } else if (action === "discuss") {
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> <@${u.id}> would like to talk this through. Carry on here.`);
  }
}

async function submitted(callbackId: string, ref: { channel: string; thread: string }, text: string, userId: string): Promise<void> {
  const l = await load(ref.channel, ref.thread);
  if (!l) throw new Error(`Form ${callbackId}: request ${ref.thread} not found`);
  const name = await nameOf(userId);
  const title = l.card.summary?.title ?? "Request";
  const app = appOf(l);
  if (callbackId === "changes" && l.card.stage === "approval") {
    await rebuild(app.repo, l.card.issue, `Changes asked by ${name}:\n\n${text}`);
    l.card.stage = "building";
    l.card.startedAt = Date.now();
    await save(l);
    await settle(l.card.approvalChannel, l.card.approvalTs, title, `Changes asked: ${text}`);
    await postInThread(l.channel, l.thread, `${name} asked for changes: "${text}". Rebuilding.`);
  } else if (callbackId === "reject" && l.card.stage === "approval") {
    await closePr(app.repo, l.card.pr).catch((e) => report(e, "reject.close_pr"));
    await closeIssue(app.repo, l.card.issue, "not_planned").catch((e) => report(e, "reject.close_issue"));
    l.card.stage = "declined";
    l.card.note = text;
    await save(l);
    await settle(l.card.approvalChannel, l.card.approvalTs, title, `Rejected: ${text}`);
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> ${name} didn't ship this one: "${text}"`);
  } else if (callbackId === "decline" && l.card.stage === "proposal") {
    l.card.stage = "declined";
    l.card.note = text;
    await save(l);
    await settle(l.card.approvalChannel, l.card.approvalTs, title, `Declined: ${text}`);
    await settle(l.card.copyChannel, l.card.copyTs, title, `Jamie declined: ${text}`);
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> Jamie has decided against this one: "${text}"`);
  } else if (callbackId === "sam_comment" && l.card.stage === "proposal") {
    l.card.samComment = text;
    await save(l);
    const base = { app, requester: l.card.requester, summary: l.card.summary!, card: l.card, size: l.card.size || "M", link: await link(l), value: encodeRef(l) };
    await slack("chat.update", { channel: l.card.approvalChannel, ts: l.card.approvalTs, text: `Proposal: ${title}`, blocks: proposalBlocks({ ...base, forSam: false }) });
    await settle(l.card.copyChannel, l.card.copyTs, title, `Your comment went to Jamie: "${text}"`);
  }
}

// ---------- The builder's report ----------

export type BuildReport = {
  channel: string;
  thread: string;
  repo: string;
  issue: number;
  outcome: "built" | "failed" | "bigger"; // bigger: the builder found it touches something only Jamie decides
  pr?: number;
  prUrl?: string;
  changed?: string;
  checks?: "passed" | "failed";
  preview?: string;
  reason?: string;
  runUrl: string;
};

export async function handleBuildReport(r: BuildReport, now = Date.now()): Promise<void> {
  const l = await load(r.channel, r.thread);
  if (!l) throw new Error(`Build report for ${r.repo}#${r.issue}: request not found`);
  if (l.card.issue !== r.issue || appOf(l).repo.toLowerCase() !== r.repo.toLowerCase()) throw new Error(`Build report for ${r.repo}#${r.issue} doesn't match the request`);
  if (l.card.stage !== "building") return; // e.g. a late report after it was closed
  const title = l.card.summary?.title ?? "Request";
  const approverEmail = l.card.approver === "jamie" ? OWNER_EMAIL : APPROVER_EMAIL;
  const approverName = l.card.approver === "jamie" ? "Jamie" : "Sam";
  if (r.outcome === "built" && r.pr && r.prUrl) {
    const built: Built = { changed: r.changed || "See the change.", checks: r.checks ?? "failed", preview: r.preview ?? "", prUrl: r.prUrl };
    const d = await dm(
      approverEmail,
      `Ready to ship: ${title}`,
      approvalBlocks({ app: appOf(l), requester: l.card.requester, summary: l.card.summary!, built, link: await link(l), noDecision: l.card.noDecision, value: encodeRef(l) }),
      approvalMeta(l),
    );
    Object.assign(l.card, { stage: "approval", pr: r.pr, prUrl: r.prUrl, preview: r.preview ?? "", approvalChannel: d.channel, approvalTs: d.ts, pendingSince: now, reminded: false });
    await save(l);
    await postInThread(l.channel, l.thread, `Built. ${approverName} will check it before it goes live.`);
  } else if (r.outcome === "bigger" && l.card.approver !== "jamie") {
    // Only for a small fix: a build Jamie already said yes to never goes back to him as a proposal (it looped, 19 Nov 2026).
    // Safety net (design): a "small" build that turns out to touch a Bigger area stops and becomes a proposal.
    await closeIssue(appOf(l).repo, r.issue, "not_planned").catch((e) => report(e, "bigger.close_issue"));
    l.card.tier = "bigger";
    l.card.reasons = [l.card.reasons, r.reason || "the builder found it touches something only Jamie decides"].filter(Boolean).join("; ");
    l.card.size ||= "M";
    await sendProposal(l, now);
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> while building this I found it's bigger than it looked (${r.reason || "it touches something only Jamie decides"}), so it's gone to Jamie as a proposal instead.`);
  } else {
    l.card.stage = "failed";
    l.card.note = (r.reason || "the build didn't finish").slice(0, 300);
    await save(l);
    await dm(approverEmail, `Couldn't build: ${title}`, failedBlocks({ title, reason: l.card.note, link: await link(l), runUrl: r.runUrl, value: encodeRef(l) }));
    if (approverEmail !== OWNER_EMAIL) await dm(OWNER_EMAIL, `FYI: a build failed: ${title}. ${await link(l)}`);
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> I couldn't build this one first time. ${approverName} has been told and can ask me to try again.`);
  }
}

