/** Slack events (new requests, replies), buttons and forms, and the builder's report back. */
import { undoSpotted } from "./elsewhere";
import {
  DONE_ELSEWHERE_FROM,
  answerBlocks,
  cardBlocks,
  approvalBlocks,
  doneBlocks,
  failedBlocks,
  gateBlocks,
  lookingBlocks,
  proposalBlocks,
  questionBlocks,
  reframeBlocks,
  stepUpBlocks,
  summaryBlocks,
  needsText,
  textModal,
  verdictBlocks,
  type Built,
  type Verdict,
} from "./blocks";
import { APPROVER_EMAIL, MAX_CATCH_UPS, MAX_LOOKS, NOTES_FILES, OWNER_EMAIL, appByKey, canLookInto, personByEmail } from "./config";
import { assess, type Image } from "./claude";
import { closeIssue, closePr, fileNow, mergePr, openQuestionIssue, overlapSinceBuilt, rebuild } from "./github";
import { questionIssueBody, questionIssueTitle } from "./issue";
import {
  allRequests,
  appOf,
  buildsRunning,
  dm,
  link,
  load,
  markChanged,
  nameOf,
  postInThread,
  save,
  startBuild,
  threadLines,
  type Loaded,
} from "./actions";
import { enforce, missingNeeds, notesBlock, transcript, turnPrompt, type Assessment, type Depth } from "./prompt";
import { approvalMeta, cardMeta, decodeRef, encodeRef, newCard, reopensOnReply } from "./records";
import { grillFromMessage, grillReply, grillRequest } from "./grill/handlers";
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
  // Sam's grills (lib/grill, Jamie 23 Nov 2026) come first: "/grill idea" typed as a message, and replies in a grill.
  if (isNew) {
    if (await grillFromMessage(e.channel, e.ts, e.user, e.text)) return;
    return newRequest(e.channel, e.ts, e.user);
  }
  if (await grillReply(e)) return;
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
  markChanged();
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
    const depth: Depth = { reframed: l.card.reframed, scope: l.card.scope, gate: l.card.gate };
    const run = async (appKey: string) => assess({ notes: await notesFor(appKey), thread, turn: turnPrompt(l.card.round, appKey, l.card.fixing, depth), images: pics });
    let a: Assessment = await run(l.card.app);
    // First time the app is known: read again, this time with that app's design notes.
    if (appByKey(a.app) && a.app !== l.card.app) {
      l.card.app = a.app;
      a = await run(a.app);
      if (appByKey(a.app)) l.card.app = a.app;
    }
    const app = appByKey(l.card.app);
    a = enforce(a, l.card.round, app, l.card.fixing, depth);
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
  if (a.next === "reframe") {
    // How Claude reads it, and its size, for the requester to confirm before any questions (Jamie, 23 Nov 2026).
    c.stage = "reframe";
    c.scope = a.reframe.scope;
    c.scopeWhy = a.reframe.why;
    c.after = a.reframe.after;
    c.askedAt = now;
    c.nudged = false;
    const size = a.reframe.scope ? ` Size: ${a.reframe.scope.replace("_", " ")}${a.reframe.why ? ` (${a.reframe.why})` : ""}.` : "";
    await postInThread(l.channel, l.thread, `Here's how I read this: ${a.reframe.after}${a.reframe.exists ? ` What exists: ${a.reframe.exists}` : ""}${size}`, reframeBlocks({ requester: c.requester, ...a.reframe, value: encodeRef(l) }));
  } else if (a.next === "step_up") {
    // A change that turned out to be a new idea: Sam decides whether it gets the full grill.
    c.scopeWhy = a.reframe.why;
    c.keepSmall = a.reframe.keep_small;
    c.needs = a.needs;
    await toGate(l, now);
    return;
  } else if (a.next === "ask") {
    c.round += 1;
    c.stage = "grilling";
    c.askedAt = now;
    c.nudged = false;
    c.needs = a.needs;
    const text = [a.questions.map((q, i) => `${i + 1}. ${q.q} (Suggested: ${q.suggested})`).join("\n"), needsText(a.needs).replace(/\*/g, "")].filter(Boolean).join("\n");
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
    c.needs = a.needs;
    const text = `Here's what I'll do: ${a.summary.title}. ${a.summary.plan}`;
    await postInThread(l.channel, l.thread, text, summaryBlocks(c.requester, a, app, encodeRef(l)));
  } else if (a.next === "investigate" && canLookInto(app) && c.looks < MAX_LOOKS) {
    await startLook(l, app, a.how_to, now);
    return;
  } else {
    const handed = !app || app.mode === "not_offered" || a.next === "investigate";
    c.stage = handed ? "handed" : "answered";
    c.askedAt = 0;
    const cantLook =
      a.next !== "investigate"
        ? ""
        : !app
          ? "I couldn't work out which app this is about, so I've passed your question to Jamie."
          : c.looks >= MAX_LOOKS
            ? `I've already looked into ${app.name} twice for this, so I've passed it to Jamie to pick up.`
            : `I can't look inside ${app.name} myself yet, so I've passed your question to Jamie.`;
    const text = cantLook || a.how_to || (handed ? "That one's for Jamie, so I've passed it to him." : "The app already does this.");
    await postInThread(l.channel, l.thread, text, answerBlocks(c.requester, text));
    if (handed) await dm(OWNER_EMAIL, `A request for you from ${await nameOf(c.requester)}: ${await link(l)}`);
  }
  await save(l);
}

/** A "why is the app doing this?" question: opens the issue that starts the app's read-only "App question" workflow. */
async function startLook(l: Loaded, app: NonNullable<ReturnType<typeof appByKey>>, focus: string, now: number): Promise<void> {
  const c = l.card;
  const thread = transcript(await threadLines(l));
  const first = l.messages.find((m) => m.ts === l.thread)?.text ?? focus;
  const issue = await openQuestionIssue(
    app.repo,
    questionIssueTitle(first),
    questionIssueBody({ app, requesterName: await nameOf(c.requester), link: await link(l), focus, thread, channel: l.channel, threadTs: l.thread }),
  );
  c.stage = "looking";
  c.looks += 1;
  c.lookIssue = issue.number;
  c.lookedAt = now;
  c.askedAt = 0;
  c.verdict = "";
  await save(l);
  await postInThread(l.channel, l.thread, `Looking into it. ${focus}`, lookingBlocks(c.requester, focus));
}

// ---------- Right-sized grilling (Jamie, 23 Nov 2026) ----------

const rootOf = (l: Loaded) => l.messages.find((m) => m.ts === l.thread)?.text ?? "";
const isStepUp = (l: Loaded) => l.card.scope !== "new_idea";

/** Sam's buttons for a request that's a new idea, or stepped up to one: in his DM, and in the thread. */
async function toGate(l: Loaded, now = Date.now()): Promise<void> {
  const c = l.card;
  c.stage = "gate";
  c.gate = "";
  c.askedAt = 0;
  const value = encodeRef(l);
  const name = await nameOf(c.requester);
  const gate = gateBlocks({ name, asked: rootOf(l).slice(0, 600), after: c.after, why: c.scopeWhy, link: await link(l), value });
  const posted = isStepUp(l)
    ? await postInThread(l.channel, l.thread, `This is bigger than it looked. ${c.scopeWhy}`, stepUpBlocks({ requester: c.requester, why: c.scopeWhy, keepSmall: c.keepSmall, value }))
    : await postInThread(l.channel, l.thread, `${name}'s idea: full grill?`, [
        { type: "section", text: { type: "mrkdwn", text: "This is a bigger idea, so I've asked Sam whether it should get the full grill. I'll carry on here once he's looked." } },
        ...gate,
      ]);
  c.gateTs = posted;
  const d = await dm(APPROVER_EMAIL, `${name} has a bigger idea. Full grill?`, gate);
  c.gateDmChannel = d.channel;
  c.gateDmTs = d.ts;
  c.pendingSince = now;
  await save(l);
}

/** Replaces Sam's buttons (thread and DM) and the requester's "Keep it small" with what was decided. */
async function settleGate(l: Loaded, outcome: string): Promise<void> {
  const c = l.card;
  const name = await nameOf(c.requester);
  const value = encodeRef(l);
  const gate = gateBlocks({ name, asked: rootOf(l).slice(0, 600), after: c.after, why: c.scopeWhy, link: await link(l), value });
  const done = (blocks: object[]) => [...blocks.filter((b) => (b as { type: string }).type !== "actions"), { type: "context", elements: [{ type: "mrkdwn", text: outcome }] }];
  if (c.gateTs) {
    const text = isStepUp(l) ? `This is bigger than it looked. ${c.scopeWhy}` : `${name}'s idea: full grill?`;
    const thread = isStepUp(l)
      ? stepUpBlocks({ requester: c.requester, why: c.scopeWhy, keepSmall: c.keepSmall, value })
      : [{ type: "section", text: { type: "mrkdwn", text: "This is a bigger idea, so I asked Sam whether it should get the full grill." } }, ...gate];
    await slack("chat.update", { channel: l.channel, ts: c.gateTs, text: `${text} ${outcome}`, blocks: done(thread) }).catch((e) => report(e, "gate.settle.thread"));
  }
  if (c.gateDmChannel && c.gateDmTs) await slack("chat.update", { channel: c.gateDmChannel, ts: c.gateDmTs, text: outcome, blocks: done(gate) }).catch((e) => report(e, "gate.settle.dm"));
}

/** The full grill, in the request's own thread, with the requester as the interviewee. The spec goes to Jamie. */
async function fullGrill(l: Loaded): Promise<void> {
  const c = l.card;
  c.stage = "grill";
  c.gate = "grill";
  c.askedAt = 0;
  await save(l);
  const idea = [rootOf(l), c.after ? `(What they're after, as they confirmed it: ${c.after})` : ""].filter(Boolean).join("\n\n");
  await grillRequest(l.channel, l.thread, c.requester, idea);
}

/** Sam (or the requester, on a step-up) chose to keep it a change: the usual few questions. */
async function keepSmall(l: Loaded, said: string): Promise<void> {
  const c = l.card;
  c.gate = "small";
  c.scope = "change";
  c.stage = "grilling";
  await save(l);
  await postInThread(l.channel, l.thread, said);
  await turn(l);
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
    const modal = (callbackId: string, title: string, label: string, submit: string, optional = false) =>
      slack("views.open", { trigger_id: p.trigger_id, view: textModal({ callbackId, title, label, submit, value: action.value, optional }) });

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
        // Something only a person can supply is still missing (a Rentman field's ID, say): ask for it before building,
        // rather than letting the build fail on it (Jamie, 23 Nov 2026).
        if (action.action_id === "build_it" && missingNeeds(l.card.needs).length) {
          const list = missingNeeds(l.card.needs).map((n) => `${n.what}${n.where ? ` (${n.where})` : ""}`).join("; ");
          await modal("build_needs", "Build it", `Before I build this I need: ${list}. Type ${missingNeeds(l.card.needs).length === 1 ? "it" : "them"} here (for a Rentman field, just the ID number).`, "Build it");
          return null;
        }
        await proposalDecision(l, action.action_id, u);
        return null;
      case "q_ok":
      case "q_fix":
      case "q_jamie": {
        if (u.id !== l.card.requester && !u.isOwner && !u.isApprover) { await deny("Only the person who asked can choose this."); return null; }
        if (l.card.stage !== "explained") return null;
        const chose = action.action_id === "q_ok" ? "👍 Answered" : action.action_id === "q_fix" ? "🔧 Asked for a fix" : "Passed to Jamie";
        await slack("chat.update", { channel: p.channel.id, ts: p.message.ts, text: chose, blocks: [...p.message.blocks.filter((b: { type: string }) => b.type !== "actions"), { type: "context", elements: [{ type: "mrkdwn", text: `${chose} by <@${u.id}>` }] }] });
        if (action.action_id === "q_ok") {
          l.card.stage = "answered";
          await save(l);
          return null;
        }
        if (action.action_id === "q_jamie") {
          l.card.stage = "handed";
          await save(l);
          await dm(OWNER_EMAIL, `A question for you from ${await nameOf(l.card.requester)}, after I looked into the app: ${await link(l)}`);
          await postInThread(l.channel, l.thread, "I've passed this to Jamie with what I found.");
          return null;
        }
        // Fix it: the question becomes a change request, with the findings already in the thread (Jamie, 20 Nov 2026).
        l.card.fixing = true;
        l.card.round = 0;
        l.card.stage = "grilling";
        await save(l);
        await postInThread(l.channel, l.thread, "Turning this into a request, using what I found.");
        return { after: () => turn(l) };
      }
      case "reframe_yes": {
        if (u.id !== l.card.requester && !u.isOwner) { await deny("Only the person who asked can confirm this."); return null; }
        if (l.card.stage !== "reframe") return null;
        // The text stays: it's how Claude sees its own reading in the thread next turn.
        await slack("chat.update", { channel: p.channel.id, ts: p.message.ts, text: `${p.message.text ?? ""} (Confirmed: yes, that's it.)`, blocks: [...p.message.blocks.filter((b: { type: string }) => b.type !== "actions" && b.type !== "context"), { type: "context", elements: [{ type: "mrkdwn", text: `✅ <@${u.id}>: yes, that's it` }] }] });
        l.card.reframed = true;
        l.card.stage = "grilling";
        await save(l);
        if (l.card.scope !== "new_idea") return { after: () => turn(l) };
        // A new idea: Sam's and Jamie's own go straight to the full grill; the team's need Sam's tap (Jamie chose, 23 Nov 2026).
        const own = [APPROVER_EMAIL, OWNER_EMAIL].includes(await userEmail(l.card.requester));
        return { after: () => (own ? fullGrill(l) : toGate(l)) };
      }
      case "gate_grill":
      case "gate_small":
      case "gate_park": {
        if (!u.isApprover && !u.isOwner) { await deny("Sam decides whether this gets the full grill."); return null; }
        if (l.card.stage !== "gate") return null;
        const name = await nameOf(u.id);
        if (action.action_id === "gate_grill") {
          await settleGate(l, `🔥 ${name} chose the full grill.`);
          return { after: () => fullGrill(l) };
        }
        if (action.action_id === "gate_small") {
          await settleGate(l, `${name} chose to keep it small.`);
          return { after: () => keepSmall(l, `${name} wants to keep this small${l.card.keepSmall ? ` (${l.card.keepSmall})` : ""}: a few questions, then the usual route.`) };
        }
        l.card.stage = "parked";
        l.card.gate = "parked";
        l.card.note = `Parked by ${name}`;
        await save(l);
        await settleGate(l, `⏸ Parked by ${name}.`);
        await postInThread(l.channel, l.thread, `<@${l.card.requester}> ${name} has parked this for now, so nothing will be built from it yet. Talk to ${name} if you'd like to go through it.`);
        return null;
      }
      case "keep_small":
        if (u.id !== l.card.requester && !u.isOwner && !u.isApprover) { await deny("Only the person who asked can choose this."); return null; }
        if (l.card.stage !== "gate" || !l.card.keepSmall) return null;
        await settleGate(l, `<@${u.id}> kept it small (${l.card.keepSmall}).`);
        return { after: () => keepSmall(l, `Keeping it small: ${l.card.keepSmall}. I'll carry on with that part left out.`) };
      case "done_elsewhere":
        // The work was finished outside the bot (another thread built it): Jamie marks it done, nothing is built (23 Nov 2026).
        if (!u.isOwner) { await deny("Only Jamie can mark this as done elsewhere."); return null; }
        if (!DONE_ELSEWHERE_FROM.includes(l.card.stage)) return null;
        await modal("done_elsewhere", "Done elsewhere", "Where was it done? A pull request link or a few words. The person who asked will see this.", "Mark done", true);
        return null;
      case "undo_elsewhere":
        // The bot marked this done itself after spotting a pull request (24 Nov 2026); Jamie, Sam or the requester can undo it.
        if (u.id !== l.card.requester && !u.isOwner && !u.isApprover) { await deny("Only Jamie, Sam or the person who asked can undo this."); return null; }
        await undoSpotted(l, u.id);
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
          // A form, so whatever the build said it was missing (a Rentman field's ID, say) can go with the retry (23 Nov 2026).
          await modal("retry", "Try again", "Anything the build needs this time? For example the ID of a Rentman field, or what to do differently. Leave it empty to just try again.", "Try again", true);
          // The form's answer settles this DM (older failed DMs weren't recorded on the request).
          l.card.approvalChannel = p.channel.id;
          l.card.approvalTs = p.message.ts;
          await save(l);
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
    if (!text && p.view.callback_id !== "retry" && p.view.callback_id !== "done_elsewhere") return { response_action: "errors", errors: { text: "Please write a few words." } };
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

/** Rebuilds an approved change on top of what went live since, instead of merging it (Jamie, 19 Nov 2026). */
async function catchUp(l: Loaded, name: string, why: string): Promise<void> {
  const app = appOf(l);
  l.card.catchUps++;
  await rebuild(
    app.repo,
    l.card.issue,
    `${name} approved this, but ${why}. The branch now includes what went live since: make sure this change still does what was asked alongside it, keep the other changes intact, and run the checks again. Change nothing else.`,
  );
  l.card.stage = "building";
  l.card.startedAt = Date.now();
  await save(l);
  const title = l.card.summary?.title ?? "Change";
  await settle(l.card.approvalChannel, l.card.approvalTs, title, "Another change to the same screen went live first, so I'm rebuilding this on top of it. You'll get it to approve again in about 15 minutes.");
  await postInThread(l.channel, l.thread, "Another change to the same screen went live first, so I'm rebuilding this on top of it before it goes live. It'll come back for approval in about 15 minutes.");
}

async function approve(l: Loaded, u: Who): Promise<void> {
  const app = appOf(l);
  const name = await nameOf(u.id);
  // Another change to the same code went live after this one was built: rebuild it on top first, so the two
  // can't undo or break each other. Twice at most, then it merges as it is.
  const canCatchUp = l.card.catchUps < MAX_CATCH_UPS;
  if (canCatchUp) {
    let clash: string[] = [];
    try {
      clash = await overlapSinceBuilt(app.repo, l.card.pr);
    } catch (err) {
      report(err, "approve.overlap", { repo: app.repo, pr: l.card.pr }); // the merge below still refuses a real conflict
    }
    if (clash.length) {
      await catchUp(l, name, `another change to the same files went live after it was built (${clash.slice(0, 5).join(", ")})`);
      return;
    }
  }
  let sha: string;
  try {
    sha = await mergePr(app.repo, l.card.pr);
  } catch (err) {
    report(err, "approve.merge", { repo: app.repo, pr: l.card.pr });
    if (canCatchUp) {
      await catchUp(l, name, "it no longer merges cleanly with what went live since it was built");
      return;
    }
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
  if (callbackId === "done_elsewhere" && DONE_ELSEWHERE_FROM.includes(l.card.stage)) {
    if ((await userEmail(userId)) !== OWNER_EMAIL) return;
    const wasQuestion = !l.card.summary && !l.card.tier;
    if (l.card.stage === "failed" && l.card.issue) await closeIssue(app.repo, l.card.issue, "completed").catch((e) => report(e, "done_elsewhere.close_issue"));
    l.card.stage = wasQuestion ? "answered" : "live";
    l.card.note = text;
    const pr = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
    if (pr) l.card.prUrl = pr[0];
    if (!wasQuestion) l.card.mergedAt = Date.now();
    await save(l);
    const outcome = text ? `Done elsewhere: ${text}` : "Done elsewhere.";
    await settle(l.card.approvalChannel, l.card.approvalTs, title, outcome);
    await settle(l.card.copyChannel, l.card.copyTs, title, outcome);
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> this is done ✅ ${name} sorted it outside this thread${text ? `: ${text}` : "."}`);
  } else if (callbackId === "retry" && l.card.stage === "failed") {
    await rebuild(app.repo, l.card.issue, text ? `Try again, asked by ${name}, who adds:\n\n${text}` : `Try again, asked by ${name}.`);
    l.card.stage = "building";
    l.card.startedAt = Date.now();
    await save(l);
    await settle(l.card.approvalChannel, l.card.approvalTs, title, text ? `Trying again with: "${text}"` : "Trying again.");
    await postInThread(l.channel, l.thread, text ? `Trying the build again. ${name} added: "${text}"` : "Trying the build again.");
  } else if (callbackId === "build_needs" && l.card.stage === "proposal") {
    if ((await userEmail(userId)) !== OWNER_EMAIL) return;
    const missing = missingNeeds(l.card.needs);
    for (const n of missing) n.value = missing.length === 1 ? text : `${name}: ${text}`;
    await postInThread(l.channel, l.thread, `${name} supplied what was needed: "${text}"`);
    await proposalDecision(l, "build_it", { id: userId, email: OWNER_EMAIL, isOwner: true, isApprover: false });
  } else if (callbackId === "changes" && l.card.stage === "approval") {
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
    const d = await dm(approverEmail, `Couldn't build: ${title}`, failedBlocks({ title, reason: l.card.note, link: await link(l), runUrl: r.runUrl, value: encodeRef(l) }));
    // Try again opens a form; its answer settles this DM.
    l.card.approvalChannel = d.channel;
    l.card.approvalTs = d.ts;
    await save(l);
    if (approverEmail !== OWNER_EMAIL) await dm(OWNER_EMAIL, `FYI: a build failed: ${title}. ${await link(l)}`);
    await postInThread(l.channel, l.thread, `<@${l.card.requester}> I couldn't build this one first time. ${approverName} has been told and can ask me to try again.`);
  }
}


// ---------- The look-into-it report ----------

export type QuestionReport = {
  channel: string;
  thread: string;
  repo: string;
  issue: number;
  outcome: "answered" | "failed";
  verdict?: Verdict;
  answer?: string;
  checked?: string;
  reason?: string;
  runUrl: string;
};

const VERDICT_KEYS: Verdict[] = ["as_designed", "broken", "should_change", "unsure"];

export async function handleQuestionReport(r: QuestionReport): Promise<void> {
  const l = await load(r.channel, r.thread);
  if (!l) throw new Error(`Question report for ${r.repo}#${r.issue}: request not found`);
  if (l.card.lookIssue !== r.issue || appOf(l).repo.toLowerCase() !== r.repo.toLowerCase()) throw new Error(`Question report for ${r.repo}#${r.issue} doesn't match the request`);
  if (l.card.stage !== "looking") return; // a late report
  const verdict = r.verdict && VERDICT_KEYS.includes(r.verdict) ? r.verdict : null;
  if (r.outcome === "answered" && verdict && r.answer?.trim()) {
    l.card.stage = "explained";
    l.card.verdict = verdict;
    await save(l);
    const answer = r.answer.trim().slice(0, 2800);
    await postInThread(l.channel, l.thread, answer, verdictBlocks({ requester: l.card.requester, verdict, answer, checked: (r.checked ?? "").trim().slice(0, 400), value: encodeRef(l) }));
    // Something broken goes to Jamie too, whatever the requester taps (rule 1: nothing fails silently).
    if (verdict === "broken") await dm(OWNER_EMAIL, `FYI: ${await nameOf(l.card.requester)} asked about ${appOf(l).name} and I found something that looks broken. ${await link(l)}`);
    return;
  }
  l.card.stage = "handed";
  l.card.note = (r.reason || "the look into the app didn't finish").slice(0, 300);
  await save(l);
  await dm(OWNER_EMAIL, `I couldn't finish looking into a question about ${appOf(l).name}: ${l.card.note}. ${r.runUrl} ${await link(l)}`);
  await postInThread(l.channel, l.thread, `<@${l.card.requester}> I couldn't get to the bottom of this one, so I've passed it to Jamie.`);
}
