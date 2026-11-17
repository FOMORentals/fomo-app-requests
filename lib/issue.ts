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
  parts.push("", "<details><summary>The Slack thread</summary>", "", "```", o.thread.replace(/```/g, "'''"), "```", "", "</details>");
  parts.push("", "<details><summary>FOMO engineering rules</summary>", "", o.rules, "", "</details>");
  return parts.join("\n");
}
