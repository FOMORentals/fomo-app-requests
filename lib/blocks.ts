/** Everything people see in Slack. Pure, tested. */
import type { App } from "./config";
import { MAX_ROUNDS } from "./config";
import { missingNeeds, type Assessment, type Need } from "./prompt";
import { encodeRef, type ApprovalRef, type Card, type Scope, type Stage, type Summary } from "./records";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Block = Record<string, any>;

export const STEPS = ["Received", "Questions", "Waiting for ✅", "Building", "Waiting for approval", "Live ✅"];

const STEP_OF: Partial<Record<Stage, number>> = {
  reframe: 1,
  grilling: 1,
  confirm: 2,
  queued: 3,
  building: 3,
  approval: 4,
  proposal: 4,
  deploying: 4,
  live: 5,
};

const ENDINGS: Partial<Record<Stage, string>> = {
  answered: "Answered, no change needed",
  explained: "Answered: I looked into the app",
  handed: "Passed to Jamie",
  parked: "Not now",
  gate: "Waiting for Sam: full grill?",
  grill: "Being grilled in full. The spec goes to Jamie",
  declined: "Declined",
  closed: "Closed (no reply). Reply here any time to reopen it",
  failed: "Couldn't build it",
};

/** The one status line Claude keeps updated at the top of the thread. */
export function statusLine(stage: Stage, waitingOn = ""): string {
  if (stage === "looking") return "*Status:* Received → *Looking into it* → Answered";
  if (stage === "queued") return `*Status:* ${STEPS.map((s, i) => (i === 3 ? "*In the queue to be built*" : s)).join(" → ")}`;
  const end = ENDINGS[stage];
  if (end) return `*Status:* ${end}`;
  const at = STEP_OF[stage] ?? 0;
  const steps = STEPS.map((s, i) => (i === at ? `*${i === 4 && waitingOn ? `Waiting for ${waitingOn}` : stage === "deploying" ? "Going live" : s}*` : s));
  return `*Status:* ${steps.join(" → ")}`;
}

/** Stages where Jamie can mark a request done because the work was finished outside the bot (23 Nov 2026). */
export const DONE_ELSEWHERE_FROM: Stage[] = ["handed", "proposal", "failed"];

export function cardBlocks(c: Card, app: App | undefined, ref?: ApprovalRef): Block[] {
  const waitingOn = c.stage === "approval" ? (c.approver === "jamie" ? "Jamie" : "Sam") : c.stage === "proposal" ? "Jamie" : "";
  const bits = [app ? app.name : "", c.tier === "small" ? "Small fix" : c.tier === "bigger" ? "Bigger: a proposal for Jamie" : ""].filter(Boolean);
  const blocks: Block[] = [{ type: "section", text: { type: "mrkdwn", text: statusLine(c.stage, waitingOn) } }];
  const ctx = [...bits];
  if (c.preview && c.stage === "approval") ctx.push(`<${c.preview}|Preview it>`);
  if (c.prUrl && (c.stage === "approval" || c.stage === "deploying" || c.stage === "live")) ctx.push(`<${c.prUrl}|The change>`);
  if (c.stage === "explained" && c.verdict) ctx.push(VERDICTS[c.verdict].label);
  if (c.stage === "failed" && c.note) ctx.push(c.note);
  if (c.stage === "declined" && c.note) ctx.push(`Why: ${c.note}`);
  if (ctx.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: ctx.join(" · ") }] });
  if (ref && DONE_ELSEWHERE_FROM.includes(c.stage))
    blocks.push({
      type: "actions",
      elements: [{ type: "button", action_id: "done_elsewhere", text: { type: "plain_text", text: "Done elsewhere (Jamie)" }, value: encodeRef(ref) }],
    });
  return blocks;
}

/**
 * What only a person can supply (a Rentman field's ID, say), asked for in so many words, never buried in a
 * question (Jamie, 23 Nov 2026).
 */
export function needsText(needs: Need[] | undefined): string {
  const missing = missingNeeds(needs);
  if (!missing.length) return "";
  const items = missing.map((n) => `• *${n.what}*${n.where ? `\n    _How:_ ${n.where}` : ""}`).join("\n");
  return `📌 *Before this can be built, I need you to:*\n${items}\nReply in this thread with ${missing.length === 1 ? "it" : "them"} (for a Rentman field, just the ID number). If you can't, say so and I'll ask Jamie.`;
}

export const SCOPE_LABEL: Record<Exclude<Scope, "">, string> = { quick_fix: "🟢 Quick fix", change: "🟡 Change", new_idea: "🔴 New idea" };

/** "Here's how I read this" (Jamie, 23 Nov 2026): the outcome, what exists, and the size, for the requester to confirm. */
export function reframeBlocks(o: { requester: string; after: string; exists: string; scope: Scope; why: string; value: string }): Block[] {
  const quote = readingText(o);
  return [
    { type: "section", text: { type: "mrkdwn", text: `<@${o.requester}> *Here's how I read this*\n${quote}`.slice(0, 2990) } },
    { type: "context", elements: [{ type: "mrkdwn", text: "Is that what you mean? If not, reply and tell me what I've got wrong." }] },
    { type: "actions", elements: [{ type: "button", style: "primary", action_id: "reframe_yes", text: { type: "plain_text", text: "Yes, that's it" }, value: o.value }] },
  ];
}

/** Sam's call on a team member's new idea: in his DM and in the thread (Jamie chose Sam, 23 Nov 2026). */
export function gateBlocks(o: { name: string; asked: string; after: string; why: string; link: string; value: string }): Block[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `🔥 *${o.name} has a bigger idea. Full grill?*` } },
    {
      type: "section",
      text: { type: "mrkdwn", text: [`*Asked:* ${o.asked}`, o.after ? `*Really after:* ${o.after}` : "", o.why ? `*Why it's big:* ${o.why}` : "", `<${o.link}|Open the thread>`].filter(Boolean).join("\n").slice(0, 2990) },
    },
    {
      type: "actions",
      elements: [
        { type: "button", style: "primary", action_id: "gate_grill", text: { type: "plain_text", text: "Grill it" }, value: o.value },
        { type: "button", action_id: "gate_small", text: { type: "plain_text", text: "Keep it small" }, value: o.value },
        { type: "button", action_id: "gate_park", text: { type: "plain_text", text: "Park" }, value: o.value },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Grill it:* ${o.name} gets the full grill in the thread; you can join in. The spec goes to Jamie (copy to you).\n*Keep it small:* the usual few questions, sized down.\n*Park:* ${o.name} is told it's parked for now.`,
        },
      ],
    },
  ];
}

/** A change that turned out bigger: tells the requester, and offers to keep it small. */
export function stepUpBlocks(o: { requester: string; why: string; keepSmall: string; value: string }): Block[] {
  const blocks: Block[] = [
    { type: "section", text: { type: "mrkdwn", text: `⬆️ *This is bigger than it looked.* ${o.why} A few questions won't get it right.`.slice(0, 2990) } },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `I've asked Sam whether to grill it fully.${o.keepSmall ? ` Or <@${o.requester}> can keep it small with the button below (${o.keepSmall}).` : ""}` }],
    },
  ];
  if (o.keepSmall)
    blocks.push({ type: "actions", elements: [{ type: "button", action_id: "keep_small", text: { type: "plain_text", text: `Keep it small (${o.keepSmall})`.slice(0, 75) }, value: o.value }] });
  return blocks;
}

/** The answers already given, so the requester can check them on the summary. */
export function givenText(needs: Need[] | undefined): string {
  const given = (needs ?? []).filter((n) => n.value.trim());
  return given.length ? `*Using:* ${given.map((n) => `${n.what}: *${n.value}*`).join("; ")}` : "";
}

/** How Claude read the request and its size, shown with the first questions (Jamie, 24 Nov 2026). Pure. */
export function readingText(r: { after: string; exists: string; scope: Scope; why: string }): string {
  const size = r.scope ? `${SCOPE_LABEL[r.scope]}${r.why ? `: ${r.why}` : ""}` : r.why;
  return [`*What you're after:* ${r.after}`, r.exists ? `*What exists:* ${r.exists}` : "", size ? `*Size:* ${size}` : ""]
    .filter(Boolean)
    .map((l) => `> ${l.replace(/\n/g, "\n> ")}`)
    .join("\n");
}

/**
 * The numbered questions. With `reading`, it's the first message of a quick fix or a change: how Claude read it
 * and its size, with the first questions, so the requester has one message to answer and nothing to tap
 * (Jamie, 24 Nov 2026).
 */
export function questionBlocks(requester: string, a: Assessment, round: number, reading = ""): Block[] {
  const ask = a.questions.length
    ? `A few quick questions so this comes out right (round ${round} of ${MAX_ROUNDS}). Reply in this thread, e.g. "1 yes", or tell me if I've misread you.`
    : "Reply in this thread, or tell me if I've misread you.";
  const intro = reading
    ? `<@${requester}> *Here's how I read this*\n${reading}\n\n${ask}`
    : round > MAX_ROUNDS
      ? `<@${requester}> thanks. One last thing before I can write this up.`
      : round === 1
        ? `<@${requester}> thanks. A few quick ${a.questions.length ? "questions" : "things"} so this comes out right (round ${round} of ${MAX_ROUNDS}). Reply in this thread${a.questions.length ? ', e.g. "1 yes, 2 b"' : ""}.`
        : `<@${requester}> thanks, nearly there (round ${round} of ${MAX_ROUNDS}). Reply in this thread.`;
  const blocks: Block[] = [];
  if (a.reply_note) blocks.push({ type: "section", text: { type: "mrkdwn", text: a.reply_note } });
  blocks.push({ type: "section", text: { type: "mrkdwn", text: intro.slice(0, 2990) } });
  if (a.contradiction.found) blocks.push(contradictionBlock(a));
  a.questions.forEach((q, i) => {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${i + 1}.* ${q.q}\n➡️ _Suggested:_ ${q.suggested}` } });
  });
  const needs = needsText(a.needs);
  if (needs) blocks.push({ type: "section", text: { type: "mrkdwn", text: needs } });
  return blocks;
}

function contradictionBlock(a: Assessment): Block {
  const when = a.contradiction.decided_on ? ` (${a.contradiction.decided_on})` : "";
  return {
    type: "section",
    text: { type: "mrkdwn", text: `⚠️ *This would change something Jamie decided${when}:*\n>${a.contradiction.decision.replace(/\n/g, "\n>")}\nSo it will go to Jamie as a proposal.` },
  };
}

export function summaryText(s: Summary): string {
  return [`*${s.title}*`, `*Now:* ${s.now}`, `*Should:* ${s.should}`, `*Who and how often:* ${s.who}`, `*Done looks like:* ${s.done}`, `*What I'll do:* ${s.plan}`].join("\n");
}

/** The line about another request this repeats or clashes with (Jamie, 24 Nov 2026). Pure. */
export function relatedText(kind: "" | "duplicate" | "clash", why: string, url: string): string {
  if (!kind) return "";
  const other = url ? `<${url}|another request>` : "another request";
  return kind === "clash"
    ? `⚖️ *This pulls against ${other}:* ${why || "they ask for different things on the same screen"}. Both people's needs have to be weighed, so it goes to Jamie (Sam sees it too).`
    : `🔁 *Much the same as ${other}:* ${why}`;
}

export function summaryBlocks(requester: string, a: Assessment, app: App, value: string, reading = "", relatedUrl = ""): Block[] {
  const route =
    a.tier === "small"
      ? `This is a *small fix*. Once you tap ✅ I'll build it, and ${app.mode === "build_jamie" ? "Jamie" : "Sam"} will check it before it goes live.`
      : `This is a *bigger* one (${a.bigger_reasons.join("; ") || "a new feature"}), so once you tap ✅ it goes to Jamie as a proposal. Nothing is built until he says so.`;
  const blocks: Block[] = [];
  if (a.reply_note) blocks.push({ type: "section", text: { type: "mrkdwn", text: a.reply_note } });
  if (reading) blocks.push({ type: "section", text: { type: "mrkdwn", text: `<@${requester}> *Here's how I read this*\n${reading}`.slice(0, 2990) } });
  blocks.push({ type: "section", text: { type: "mrkdwn", text: `${reading ? "" : `<@${requester}> `}here's what I'll do on *${app.name}*:` } });
  blocks.push({ type: "section", text: { type: "mrkdwn", text: summaryText(a.summary) } });
  const given = givenText(a.needs);
  if (given) blocks.push({ type: "section", text: { type: "mrkdwn", text: given } });
  const missing = missingNeeds(a.needs);
  if (missing.length)
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `📌 *Still needed before it can be built:* ${missing.map((n) => n.what).join("; ")}. Jamie will be asked for ${missing.length === 1 ? "it" : "them"} before anything is built.` } });
  if (a.contradiction.found) blocks.push(contradictionBlock(a));
  const rel = a.related ? relatedText(a.related.kind, a.related.why, relatedUrl) : "";
  if (rel) blocks.push({ type: "section", text: { type: "mrkdwn", text: rel.slice(0, 2990) } });
  if (!a.recorded_decision_found) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "There's no recorded decision on this, so it wasn't checked against one." }] });
  blocks.push({ type: "section", text: { type: "mrkdwn", text: route } });
  blocks.push({
    type: "actions",
    elements: [{ type: "button", style: "primary", action_id: "confirm", text: { type: "plain_text", text: a.tier === "small" ? "✅ Yes, build it" : "✅ Yes, send it to Jamie" }, value }],
  });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Not quite right? Reply in this thread and I'll redo the summary." }] });
  return blocks;
}

export function answerBlocks(requester: string, text: string): Block[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `<@${requester}> ${text}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: "Not what you meant? Reply in this thread." }] },
  ];
}

export type Verdict = "as_designed" | "broken" | "should_change" | "unsure";

/** How each finding is labelled, and the buttons the requester gets (Jamie, 20 Nov 2026). */
export const VERDICTS: Record<Verdict, { label: string; buttons: { id: string; text: string; primary?: boolean }[] }> = {
  as_designed: {
    label: "🔵 Working as designed",
    buttons: [
      { id: "q_ok", text: "👍 That answers it", primary: true },
      { id: "q_fix", text: "That's not how it should work: suggest a change" },
    ],
  },
  broken: {
    label: "🔴 Looks broken",
    buttons: [
      { id: "q_fix", text: "🔧 Fix it", primary: true },
      { id: "q_jamie", text: "Just tell Jamie" },
    ],
  },
  should_change: {
    label: "🟠 Works, but could be better",
    buttons: [
      { id: "q_fix", text: "Make it a request", primary: true },
      { id: "q_ok", text: "Leave it as it is" },
    ],
  },
  unsure: {
    label: "⚪ Couldn't tell from the code",
    buttons: [
      { id: "q_jamie", text: "Ask Jamie", primary: true },
      { id: "q_ok", text: "Leave it" },
    ],
  },
};

/** While the app's code is being looked into. */
export function lookingBlocks(requester: string, focus: string): Block[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `<@${requester}> good question. ${focus ? `${focus} ` : ""}I'm looking into the app now (read only, nothing changes). This usually takes 5 to 15 minutes.` } },
  ];
}

/** What the look found, with the requester's next step. */
export function verdictBlocks(o: { requester: string; verdict: Verdict; answer: string; checked: string; value: string }): Block[] {
  const v = VERDICTS[o.verdict];
  const blocks: Block[] = [{ type: "section", text: { type: "mrkdwn", text: `<@${o.requester}> *${v.label}*\n${o.answer}` } }];
  if (o.checked) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Checked: ${o.checked}` }] });
  blocks.push({
    type: "actions",
    elements: v.buttons.map((b) => ({ type: "button", action_id: b.id, text: { type: "plain_text", text: b.text }, value: o.value, ...(b.primary ? { style: "primary" } : {}) })),
  });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Still not clear? Reply in this thread." }] });
  return blocks;
}

export type Built = { changed: string; checks: "passed" | "failed"; preview: string; prUrl: string };

/** To Sam (small fixes) or Jamie (bigger ones he said to build): the finished change. */
export function approvalBlocks(o: { app: App; requester: string; summary: Summary; built: Built; link: string; noDecision: boolean; value: string; related?: string }): Block[] {
  const blocks: Block[] = [
    { type: "section", text: { type: "mrkdwn", text: `*Ready to ship: ${o.summary.title}*\n${o.app.name} · asked by <@${o.requester}> · <${o.link}|the request>` } },
    { type: "section", text: { type: "mrkdwn", text: `*What was asked:* ${o.summary.should}\n*Done looks like:* ${o.summary.done}` } },
    { type: "section", text: { type: "mrkdwn", text: `*What changed:* ${o.built.changed}` } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          o.built.checks === "passed" ? "✅ Checks passed (tests, lint, build)" : "❌ Checks failed",
          o.built.preview ? `<${o.built.preview}|Try it before it goes live (preview)>` : "No preview link (open the change to see the picture)",
          `<${o.built.prUrl}|The change, with its picture>`,
        ].join("\n"),
      },
    },
  ];
  if (o.related) blocks.push({ type: "section", text: { type: "mrkdwn", text: o.related.slice(0, 2990) } });
  if (o.noDecision) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "No recorded decision on this: it wasn't checked against one." }] });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", style: "primary", action_id: "approve", text: { type: "plain_text", text: "Approve and ship" }, value: o.value },
      { type: "button", action_id: "changes", text: { type: "plain_text", text: "Ask for changes" }, value: o.value },
      { type: "button", style: "danger", action_id: "reject", text: { type: "plain_text", text: "Reject" }, value: o.value },
    ],
  });
  return blocks;
}

/** To Jamie: a bigger request, proposal only. Sam gets a copy with a comment button. */
export function proposalBlocks(o: { app: App; requester: string; summary: Summary; card: Card; size: string; link: string; value: string; forSam: boolean }): Block[] {
  const blocks: Block[] = [
    { type: "section", text: { type: "mrkdwn", text: `*Proposal: ${o.summary.title}*\n${o.app.name} · asked by <@${o.requester}> · size ${o.size} · <${o.link}|the request>` } },
    { type: "section", text: { type: "mrkdwn", text: summaryText(o.summary) } },
    { type: "section", text: { type: "mrkdwn", text: `*Why it's bigger:* ${o.card.reasons || "a new feature"}` } },
  ];
  const given = givenText(o.card.needs);
  if (given) blocks.push({ type: "section", text: { type: "mrkdwn", text: given } });
  const missing = missingNeeds(o.card.needs);
  if (missing.length)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📌 *Needed before it can be built:*\n${missing.map((n) => `• ${n.what}${n.where ? ` (${n.where})` : ""}`).join("\n")}${o.forSam ? "" : "\nBuild it will ask you for this first."}` },
    });
  const rel = relatedText(o.card.relatedKind, o.card.relatedWhy, o.card.relatedUrl);
  if (rel) blocks.push({ type: "section", text: { type: "mrkdwn", text: rel.slice(0, 2990) } });
  if (o.card.contradiction) blocks.push({ type: "section", text: { type: "mrkdwn", text: `⚠️ *It would change your decision:*\n>${o.card.contradiction.replace(/\n/g, "\n>")}` } });
  if (o.card.noDecision) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "No recorded decision on this: it wasn't checked against one." }] });
  if (o.card.samComment) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Sam:* ${o.card.samComment}` } });
  if (o.forSam) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Jamie decides. Add a comment if it helps him." }] });
    blocks.push({ type: "actions", elements: [{ type: "button", action_id: "sam_comment", text: { type: "plain_text", text: "Add a comment" }, value: o.value }] });
  } else {
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", style: "primary", action_id: "build_it", text: { type: "plain_text", text: "Build it" }, value: o.value },
        { type: "button", action_id: "discuss", text: { type: "plain_text", text: "Discuss" }, value: o.value },
        { type: "button", action_id: "not_now", text: { type: "plain_text", text: "Not now" }, value: o.value },
        { type: "button", style: "danger", action_id: "decline", text: { type: "plain_text", text: "Decline" }, value: o.value },
      ],
    });
  }
  return blocks;
}

/** What an approval or proposal DM becomes once someone has acted on it. */
export function doneBlocks(title: string, outcome: string): Block[] {
  return [{ type: "section", text: { type: "mrkdwn", text: `*${title}*\n${outcome}` } }];
}

export function failedBlocks(o: { title: string; reason: string; link: string; runUrl: string; value: string }): Block[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `*Couldn't build it: ${o.title}*\n${o.reason}\n<${o.link}|The request> · <${o.runUrl}|What happened on GitHub>` } },
    {
      type: "actions",
      elements: [
        { type: "button", style: "primary", action_id: "retry", text: { type: "plain_text", text: "Try again" }, value: o.value },
        { type: "button", action_id: "drop", text: { type: "plain_text", text: "Close the request" }, value: o.value },
      ],
    },
  ];
}

/** A modal that asks for a few words (why, what to change, a comment). */
export function textModal(o: { callbackId: string; title: string; label: string; submit: string; value: string; optional?: boolean }): Block {
  return {
    type: "modal",
    callback_id: o.callbackId,
    private_metadata: o.value,
    title: { type: "plain_text", text: o.title.slice(0, 24) },
    submit: { type: "plain_text", text: o.submit },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "text",
        optional: !!o.optional,
        label: { type: "plain_text", text: o.label.slice(0, 2000) },
        element: { type: "plain_text_input", action_id: "text", multiline: true },
      },
    ],
  };
}
