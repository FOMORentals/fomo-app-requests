/**
 * The Request tracker (Jamie, 23 Nov 2026): one row per request, grouped by who it's waiting on, in the
 * #app-requests channel canvas (the tab at the top of the channel). Jamie asked for it after Friday 20 Nov,
 * when requests came in faster than he could follow from away from his desk.
 *
 * Event driven, no timer of its own: whenever a request's card is saved, the bot redraws the whole canvas
 * from the cards (Slack is the database, lib/records.ts), so it can't drift. The 15-minute tick also redraws
 * it from the requests it has already read, which catches up after a failed redraw at no extra Slack calls.
 * A redraw that fails is reported (rule 1) and never blocks the request itself.
 *
 * The markdown is pure and tested; `refreshTracker` does the Slack calls.
 */
import { allRequests, cardsChanged, nameOf, type Loaded } from "./actions";
import { appByKey } from "./config";
import type { Card } from "./records";
import { report } from "./report";
import { channel as requestsChannel, messageLink, slack } from "./slack";

const DAY = 24 * 60 * 60_000;
/** Finished requests stay on the tracker this long after their last activity. */
export const DONE_DAYS = 14;
/** The line that marks the canvas as the bot's, so it never overwrites a canvas someone else wrote. */
export const MARKER = "Kept up to date by the App requests bot";

export type Group = "jamie" | "sam" | "requester" | "bot" | "failed" | "done";

export const GROUPS: { key: Group; heading: string }[] = [
  { key: "jamie", heading: ":raising_hand: Waiting on Jamie" },
  { key: "sam", heading: ":eyes: Waiting on Sam" },
  { key: "requester", heading: ":speech_balloon: Waiting on the person who asked" },
  { key: "bot", heading: ":gear: Bot working on it" },
  { key: "failed", heading: ":x: Failed" },
  { key: "done", heading: `:white_check_mark: Done in the last ${DONE_DAYS} days` },
];

export type Row = {
  title: string;
  who: string; // first name of the person who asked
  app: string; // the app's name, "" until known
  askedAt: number; // ms
  lastAt: number; // ms, latest message in the thread
  card: Card;
  threadUrl: string;
};

/** Who a request is waiting on. Pure. */
export function groupOf(c: Card): Group {
  switch (c.stage) {
    case "proposal":
    case "handed":
      return "jamie";
    case "approval":
      return c.approver === "jamie" ? "jamie" : "sam";
    case "grilling":
    case "confirm":
      return "requester";
    case "looking":
    case "queued":
    case "building":
    case "deploying":
      return "bot";
    case "failed":
      return "failed";
    default:
      return "done"; // answered, explained, live, closed, parked, declined
  }
}

const VERDICT: Record<Card["verdict"], string> = {
  "": "Answered",
  as_designed: "Answered: working as designed",
  broken: "Answered: looks broken",
  should_change: "Answered: could be better",
  unsure: "Answered: couldn't tell",
};

/** The status in plain English, with a coloured dot. Pure. */
export function statusOf(c: Card): string {
  switch (c.stage) {
    case "grilling":
      return ":speech_balloon: Answering questions";
    case "confirm":
      return ":ballot_box_with_check: Needs their ✅";
    case "answered":
      return ":bulb: Answered";
    case "looking":
      return ":mag: Looking into the app";
    case "explained":
      return `:bulb: ${VERDICT[c.verdict] ?? "Answered"}`;
    case "handed":
      return ":large_purple_circle: Passed to Jamie";
    case "queued":
      return ":large_blue_circle: Queued to build";
    case "building":
      return ":large_blue_circle: Building";
    case "approval":
      return ":large_yellow_circle: Built, needs approval";
    case "proposal":
      return ":large_purple_circle: Proposal for Jamie";
    case "parked":
      return ":double_vertical_bar: Parked";
    case "declined":
      return ":white_circle: Declined";
    case "deploying":
      return ":large_blue_circle: Going live";
    case "live":
      return `:large_green_circle: Live${c.mergedAt ? " " + shortDate(c.mergedAt) : ""}`;
    case "closed":
      return ":white_circle: Closed (no reply)";
    case "failed":
      return `:red_circle: Failed${c.note ? ` (${shortNote(c.note)})` : ""}`;
  }
}

/** A failure reason short enough for one cell: its first clause, at most 80 characters. The thread has the rest. Pure. */
export function shortNote(note: string): string {
  const first = note.split(/[.:;(]\s|\n/)[0].replace(/[.,:;\s]+$/, "").trim();
  return first.length > 80 ? first.slice(0, 77).replace(/\s+\S*$/, "") + "…" : first;
}

/** "Mon 23 Nov", London. Pure. */
export function shortDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
}

function londonTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

/** Text safe for one table cell: one line, no pipes, nothing read as markdown at its start. Pure. */
export function cell(s: string): string {
  const one = s
    .replace(/<[^>|]+\|([^>]+)>/g, "$1") // Slack links <url|label> → label
    .replace(/<([^>]+)>/g, "$1")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  return one.replace(/^([#>\-+*]|:::|\d+\.)/, (m) => (/^\d+\.$/.test(m) ? m.replace(".", "\\.") : "\\" + m));
}

/** A short title: the summary's, or the start of the request. Pure. */
export function titleOf(c: Card, firstText: string): string {
  if (c.summary?.title) return c.summary.title;
  const t = cell(firstText);
  if (!t) return "(no text)";
  return t.length > 70 ? t.slice(0, 67).replace(/\s+\S*$/, "") + "…" : t;
}

function links(r: Row): string {
  const out = [`[Thread](${r.threadUrl})`];
  if (r.card.preview && (r.card.stage === "approval" || r.card.stage === "proposal")) out.push(`[Preview](${r.card.preview})`);
  if (r.card.prUrl) out.push(`[PR](${r.card.prUrl})`);
  return out.join(" · ");
}

/** The whole canvas. Pure, tested. Newest first within each group; empty groups are left out. */
export function trackerMarkdown(rows: Row[], now: number): string {
  const shown = rows.filter((r) => groupOf(r.card) !== "done" || now - r.lastAt <= DONE_DAYS * DAY);
  const out: string[] = [
    "# :clipboard: Request tracker",
    `${MARKER} whenever a request moves on. Last change ${shortDate(now)}, ${londonTime(now)} London time. Requests from the last 30 days; tap Thread to open one.`,
  ];
  for (const g of GROUPS) {
    const inGroup = shown.filter((r) => groupOf(r.card) === g.key).sort((a, b) => b.askedAt - a.askedAt);
    if (!inGroup.length) continue;
    out.push("", `## ${g.heading} (${inGroup.length})`, "", "|Request|Asked by|App|Asked|Status|Links|", "|---|---|---|---|---|---|");
    for (const r of inGroup)
      out.push(`|${cell(r.title)}|${cell(r.who)}|${cell(r.app) || "–"}|${shortDate(r.askedAt)}|${cell(statusOf(r.card))}|${links(r)}|`);
  }
  if (!shown.length) out.push("", "No requests yet. Ask for a change by posting in the channel.");
  return out.join("\n");
}

// ---------- Slack side ----------

/** Redraws the tracker if a card changed since the last redraw. Never throws: a failed redraw is reported (rule 1). */
export async function refreshTrackerIfChanged(now = Date.now()): Promise<void> {
  if (!cardsChanged(false)) return;
  await refreshTracker(undefined, now);
}

/**
 * Redraws the tracker from every request. `all` lets the tick pass the requests it has already read.
 * Slack calls: the requests' threads (skipped when `all` is given), a first-name lookup per person,
 * conversations.info, and one canvas edit (plus a one-off create the first time).
 */
export async function refreshTracker(all?: Loaded[], now = Date.now()): Promise<boolean> {
  cardsChanged(true); // a card saved while this runs marks it again, and that request redraws afterwards
  try {
    const ch = requestsChannel();
    const requests = all ?? (await allRequests(ch, now));
    const names = new Map<string, string>();
    const rows: Row[] = [];
    for (const l of requests) {
      if (!names.has(l.card.requester)) names.set(l.card.requester, await nameOf(l.card.requester));
      const first = l.messages.find((m) => m.ts === l.thread);
      const last = l.messages.reduce((t, m) => Math.max(t, Number(m.ts) * 1000), Number(l.thread) * 1000);
      rows.push({
        title: titleOf(l.card, first?.text ?? ""),
        who: names.get(l.card.requester) ?? "someone",
        app: appByKey(l.card.app)?.name ?? "",
        askedAt: Number(l.thread) * 1000,
        lastAt: last,
        card: l.card,
        threadUrl: await messageLink(ch, l.thread),
      });
    }
    await writeCanvas(ch, trackerMarkdown(rows, now));
    return true;
  } catch (err) {
    report(err, "tracker.refresh");
    return false;
  }
}

export const CANVAS_TITLE = "Request tracker";
let titled = false;

/** Names the canvas (its tab label), once per server start: Slack calls a new channel canvas "Untitled canvas". */
async function nameCanvas(id: string): Promise<void> {
  if (titled) return;
  await slack("canvases.edit", { canvas_id: id, changes: [{ operation: "rename", title_content: { type: "markdown", markdown: CANVAS_TITLE } }] });
  titled = true;
}

/** Writes the channel canvas, creating it the first time. Refuses to overwrite a canvas someone else wrote. */
async function writeCanvas(ch: string, markdown: string): Promise<void> {
  const document_content = { type: "markdown", markdown };
  const info = await slack<{ channel: { properties?: { canvas?: { file_id?: string; is_empty?: boolean } } } }>("conversations.info", { channel: ch });
  const existing = info.channel.properties?.canvas;
  if (!existing?.file_id) {
    const made = await slack<{ canvas_id: string }>("conversations.canvases.create", { channel_id: ch, document_content });
    await nameCanvas(made.canvas_id);
    return;
  }
  if (!existing.is_empty) {
    const found = await slack<{ sections: unknown[] }>("canvases.sections.lookup", { canvas_id: existing.file_id, criteria: { contains_text: MARKER } });
    if (!found.sections?.length) throw new Error(`#app-requests already has a canvas (${existing.file_id}) that the bot didn't write; not overwriting it`);
  }
  await slack("canvases.edit", { canvas_id: existing.file_id, changes: [{ operation: "replace", document_content }] });
  await nameCanvas(existing.file_id);
}
