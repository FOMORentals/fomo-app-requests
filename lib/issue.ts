/**
 * The GitHub issue that tells the builder what to build. The repo's "App request build" workflow
 * reads it. Pure, tested.
 */
import type { App } from "./config";
import type { Card, Summary } from "./records";
import { summaryText } from "./blocks";

export const REF_MARK = "ar-ref";

export function refMarker(channel: string, thread: string): string {
  return `<!-- ${REF_MARK}: ${channel}|${thread} -->`;
}

export function readRefMarker(body: string): { channel: string; thread: string } | null {
  const m = body.match(/<!--\s*ar-ref:\s*([A-Z0-9]+)\|([0-9.]+)\s*-->/);
  return m ? { channel: m[1], thread: m[2] } : null;
}

function plain(s: Summary): string {
  return summaryText(s).replace(/\*/g, "**");
}

export function issueTitle(s: Summary): string {
  return `App request: ${s.title}`.slice(0, 200);
}

export function issueBody(o: {
  app: App;
  card: Card;
  requesterName: string;
  approverName: string;
  link: string;
  thread: string; // the Slack thread as plain text (questions and answers)
  channel: string;
  threadTs: string;
  rules: string; // FOMO engineering rules, so the builder works by them
  jamieApproved: boolean;
  today: string;
}): string {
  const { card, app } = o;
  const s = card.summary;
  if (!s) throw new Error("issueBody: the request has no summary");
  const parts = [
    refMarker(o.channel, o.threadTs),
    `Requested by **${o.requesterName}** in Slack #app-requests: ${o.link}`,
    `App: **${app.name}**. ${card.tier === "small" ? "Small fix" : "Bigger change that Jamie said to build"}. Approves the finished change: **${o.approverName}**.`,
    "",
    "## What to build (confirmed by the requester)",
    plain(s),
  ];
  const given = (card.needs ?? []).filter((n) => n.value.trim());
  if (given.length) {
    parts.push("", "## Details the team supplied (use exactly these)", ...given.map((n) => `- ${n.what}: **${n.value}**`));
  }
  parts.push(
    "",
    "If the change needs a value this issue doesn't give and the code doesn't already have (for example the ID of a Rentman extra input field), never guess it: stop, and say exactly what someone has to create or look up and where.",
  );
  if (card.contradiction) {
    parts.push(
      "",
      "## This changes one of Jamie's recorded decisions",
      `> ${card.contradiction.replace(/\n/g, "\n> ")}`,
      "",
      o.jamieApproved
        ? `Jamie said to build it anyway on ${o.today}. Update the design notes (docs/DESIGN.md) to record the new decision, with today's date and "Jamie, via #app-requests".`
        : "Do not build this without Jamie's go-ahead.",
    );
  }
  if (card.noDecision) parts.push("", "_No recorded decision on this topic was found in the design notes._");
  if (card.reasons) parts.push("", `Why it was sorted as bigger: ${card.reasons}`);
  if (card.tier !== "small" && o.jamieApproved) {
    parts.push(
      "",
      "## Jamie's go-ahead",
      `Jamie read this as a proposal, with the reasons above, and pressed Build it on ${o.today}. That is his go-ahead for exactly what those reasons name (for example extra Rentman calls): build it and don't stop for them. Stop only for something the reasons don't mention, and say what it is.`,
    );
  }
  parts.push("", "<details><summary>The Slack thread</summary>", "", "```", o.thread.replace(/```/g, "'''"), "```", "", "</details>");
  parts.push("", "<details><summary>FOMO engineering rules</summary>", "", o.rules, "", "</details>");
  return parts.join("\n");
}

/** The question the "App question" workflow looks into. Same marker as a build, so its report finds the thread. */
export function questionIssueTitle(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  return `App question: ${q.length > 90 ? `${q.slice(0, 87)}...` : q}`;
}

export function questionIssueBody(o: {
  app: App;
  requesterName: string;
  link: string;
  focus: string; // what Claude said it would look into
  thread: string;
  channel: string;
  threadTs: string;
}): string {
  return [
    refMarker(o.channel, o.threadTs),
    `Asked by **${o.requesterName}** in Slack #app-requests: ${o.link}`,
    `App: **${o.app.name}**. This is a question, not a change: look, don't touch.`,
    "",
    "## What to look into",
    o.focus || "Why the app behaves the way the requester describes in the thread below.",
    "",
    "<details><summary>The Slack thread</summary>",
    "",
    "```",
    o.thread.replace(/```/g, "'''"),
    "```",
    "",
    "</details>",
  ].join("\n");
}
