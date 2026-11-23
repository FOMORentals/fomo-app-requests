/**
 * Sam's grill (Jamie, 23 Nov 2026): `/grill <idea>`, Sam only. The bot opens a thread in #app-requests and runs
 * Matt Pocock's grilling skill there, round by round. When the skill's frontier is empty, Sam confirms the shared
 * understanding, and the spec goes to Jamie only: a Slack DM with the .md, and a copy in this repo's specs/ folder.
 * Nothing goes into the build queue; Jamie decides what is built.
 *
 * Slack is the database, as for requests: the grill's state is metadata on the bot's first message in the thread.
 * External calls: Slack, GitHub (reads, and one file written to specs/ per spec), Anthropic. No new scheduled job.
 */
import { APPS, GRILLERS, OWNER, OWNER_EMAIL } from "../config";
import { botId, dm } from "../actions";
import { fileNow, gh } from "../github";
import { report } from "../report";
import { channel as requestsChannel, fileBase64, messageLink, replies, slack, userEmail, type Meta, type SlackMessage } from "../slack";
import { londonDate } from "../time";
import { grillRound, writeSpec, type Image } from "./claude";
import { CONTEXT_FILES, SKILL_FILE, clip, contextBlock, conversation, specPath, toSlack, type ThreadMsg } from "./prompt";

export const GRILL = "ar_grill"; // the thread's first message: the grill's state
export const ROUND = "ar_grill_round"; // a round (or the shared understanding) Claude wrote: part of the conversation

export type Stage = "grilling" | "thinking" | "confirm" | "writing" | "sent";
export type Grill = { by: string; idea: string; stage: Stage; title: string; spec: string };

export function grillMeta(g: Grill): Meta {
  return { event_type: GRILL, event_payload: { by: g.by, idea: g.idea, stage: g.stage, title: g.title, spec: g.spec } };
}

export function readGrill(m: Meta | undefined): Grill | null {
  if (m?.event_type !== GRILL) return null;
  const p = m.event_payload ?? {};
  if (!p.by || !p.idea) return null;
  const stage = (["grilling", "thinking", "confirm", "writing", "sent"] as const).find((s) => s === p.stage) ?? "grilling";
  return { by: p.by, idea: p.idea, stage, title: p.title ?? "", spec: p.spec ?? "" };
}

export const canGrill = (email: string) => GRILLERS.includes(email.trim().toLowerCase());

type G = { channel: string; thread: string; grill: Grill; messages: SlackMessage[] };

async function loadGrill(channel: string, thread: string): Promise<G | null> {
  const messages = await replies(channel, thread);
  const root = messages.find((m) => m.ts === thread);
  const me = await botId();
  if (!root || root.bot_id !== me) return null;
  const grill = readGrill(root.metadata);
  return grill ? { channel, thread, grill, messages } : null;
}

async function saveGrill(g: G): Promise<void> {
  await slack("chat.update", { channel: g.channel, ts: g.thread, text: rootText(g.grill), blocks: rootBlocks(g.grill), metadata: grillMeta(g.grill) });
}

function rootText(g: Grill): string {
  return `Grilling Sam's idea: ${g.idea}`;
}

function rootBlocks(g: Grill): object[] {
  const status =
    g.stage === "sent"
      ? `📄 Done: the spec${g.title ? ` "${g.title}"` : ""} went to Jamie. He decides whether it gets built.`
      : "Answer in the thread. Screenshots welcome. When we're done, the spec goes to Jamie. Nothing is built from here.";
  return [
    { type: "section", text: { type: "mrkdwn", text: `🔥 *Grilling Sam's idea:* ${clip(g.idea, 2500)}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: status }] },
  ];
}

const ref = (g: { channel: string; thread: string }) => JSON.stringify({ c: g.channel, t: g.thread });

function checkBlocks(title: string, understanding: string, g: { channel: string; thread: string }): object[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: `I think we've reached a shared understanding. Here's where we landed on *${title}*:` } },
    { type: "section", text: { type: "mrkdwn", text: clip(toSlack(understanding), 2900) } },
    { type: "section", text: { type: "mrkdwn", text: "Is that right? If so I'll write it up for Jamie." } },
    {
      type: "actions",
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Yes, write the spec" }, action_id: "grill_yes", value: ref(g) },
        { type: "button", text: { type: "plain_text", text: "Not yet" }, action_id: "grill_not_yet", value: ref(g) },
      ],
    },
  ];
}

// ---------- /grill ----------

type Result = { body?: object; after?: () => Promise<void> };

export async function handleGrillCommand(p: Record<string, string>): Promise<Result> {
  if (!canGrill(await userEmail(p.user_id)))
    return { body: { response_type: "ephemeral", text: "Grilling is just for Sam for now. Post your idea in #app-requests as a normal request and I'll ask you a few questions." } };
  const idea = (p.text ?? "").trim();
  if (!idea) return { body: { response_type: "ephemeral", text: "Tell me the idea after the command, for example: `/grill a morning report of upcoming quotes by bookie`." } };
  return {
    body: { response_type: "ephemeral", text: "Starting your grill in #app-requests…" },
    after: async () => {
      const ch = requestsChannel();
      const grill: Grill = { by: p.user_id, idea: clip(idea, 3000), stage: "grilling", title: "", spec: "" };
      const root = await slack<{ ts: string }>("chat.postMessage", { channel: ch, text: rootText(grill), blocks: rootBlocks(grill), metadata: grillMeta(grill), unfurl_links: false });
      const link = await messageLink(ch, root.ts);
      await fetch(p.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_type: "ephemeral", replace_original: true, text: `Your grill has started in #app-requests: <${link}|open the thread>.` }),
      }).catch((err) => report(err, "grill.command.respond"));
      const g = await loadGrill(ch, root.ts);
      if (!g) throw new Error(`Grill ${root.ts}: its first message wasn't found after posting it`);
      await round(g);
    },
  };
}

// ---------- Replies in a grill thread ----------

/** A reply in #app-requests that isn't part of a request: is it in a grill thread? Returns false when not. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function grillReply(e: any): Promise<boolean> {
  const g = await loadGrill(e.channel, e.thread_ts);
  if (!g) return false;
  // Others can chip in (Claude reads it next round), but only Sam's replies move the grill on.
  if (e.user !== g.grill.by) return true;
  if (g.grill.stage === "thinking" || g.grill.stage === "writing") return true; // the running turn picks it up when it ends
  if (g.grill.stage === "sent") {
    await slack("chat.postMessage", { channel: g.channel, thread_ts: g.thread, text: "This grill is finished and the spec is with Jamie. Start a new one with `/grill` and your idea." });
    return true;
  }
  await round(g);
  return true;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const MAX_IMAGE_BYTES = 3_500_000;

async function threadMsgs(g: G, me: string): Promise<{ msgs: ThreadMsg[]; images: Image[] }> {
  const msgs: ThreadMsg[] = [];
  const files: { url: string; type: Image["mediaType"] }[] = [];
  for (const m of g.messages) {
    if (m.ts === g.thread) continue;
    if (m.bot_id) {
      if (m.bot_id === me && m.metadata?.event_type === ROUND) msgs.push({ who: "bot", name: "bot", text: m.text ?? "", images: 0 });
      continue; // status lines ("Looking into it", "Spec sent") aren't part of the conversation
    }
    const pics = (m.files ?? []).filter((f) => IMAGE_TYPES.some((t) => t === f.mimetype) && f.url_private && (f.size ?? 0) <= MAX_IMAGE_BYTES);
    if (m.user === g.grill.by) for (const f of pics) files.push({ url: f.url_private!, type: f.mimetype as Image["mediaType"] });
    const name = m.user === g.grill.by ? "Sam" : await nameFor(m.user ?? "");
    msgs.push({ who: m.user === g.grill.by ? "starter" : "other", name, text: m.text ?? "", images: pics.length });
  }
  // The three most recent screenshots Sam added.
  const images = await Promise.all(files.slice(-3).map(async (f) => ({ mediaType: f.type, data: await fileBase64(f.url) })));
  return { msgs, images };
}

async function nameFor(userId: string): Promise<string> {
  const email = await userEmail(userId).catch(() => "");
  return email ? email.split("@")[0].replace(/^./, (c) => c.toUpperCase()) : "Someone";
}

/** What the grill reads at every turn: the skill (word for word), the status file, the sales review, every app's notes. */
async function inputs(): Promise<{ skill: string; context: string }> {
  const skill = await fileNow("fomo-app-requests", SKILL_FILE);
  if (!skill?.trim()) throw new Error(`${SKILL_FILE} is missing from fomo-app-requests`);
  const [files, notes] = await Promise.all([
    Promise.all(CONTEXT_FILES.map(async (path) => ({ path, text: await fileNow("fomo-app-requests", path) }))),
    Promise.all(APPS.flatMap((a) => ["docs/DESIGN.md", "CLAUDE.md"].map(async (path) => ({ repo: a.repo, path, text: await fileNow(a.repo, path) })))),
  ]);
  return { skill, context: contextBlock(files, notes) };
}

const latestFromStarter = (g: G) => g.messages.filter((m) => m.user === g.grill.by && !m.bot_id && m.ts !== g.thread).map((m) => m.ts).sort().pop() ?? "";

/** One round: Claude looks into it and writes the next round, or shows the shared understanding, or writes the spec. */
async function round(g: G, again = 0): Promise<void> {
  const before = g.grill.stage;
  const seen = latestFromStarter(g);
  g.grill.stage = "thinking";
  await saveGrill(g);
  const holder = await slack<{ ts: string }>("chat.postMessage", { channel: g.channel, thread_ts: g.thread, text: "🔎 Looking into it…" });
  let next: Stage = before === "confirm" ? "confirm" : "grilling";
  try {
    const me = await botId();
    const { msgs, images } = await threadMsgs(g, me);
    const turns = conversation(g.grill.idea, "Sam", msgs);
    if (turns[turns.length - 1].role !== "user") throw new Error("Nothing new from Sam to answer");
    const r = await grillRound({ ...(await inputs()), turns, images });
    if (r.kind === "round") {
      await slack("chat.update", { channel: g.channel, ts: holder.ts, text: clip(toSlack(r.text)), metadata: { event_type: ROUND, event_payload: { kind: "round" } } });
      next = "grilling";
    } else if (r.kind === "check") {
      g.grill.title = r.title.slice(0, 120);
      // The text (what Claude reads back next turn) is the understanding; the blocks add the buttons.
      await slack("chat.update", {
        channel: g.channel,
        ts: holder.ts,
        text: clip(`I think we've reached a shared understanding on "${r.title}":\n${r.understanding}\nIs that right?`),
        blocks: checkBlocks(r.title, r.understanding, g),
        metadata: { event_type: ROUND, event_payload: { kind: "check" } },
      });
      next = "confirm";
    } else {
      await slack("chat.delete", { channel: g.channel, ts: holder.ts }).catch(() => {});
      // Sam confirmed in words: the shared understanding's buttons are no longer needed.
      const shown = g.messages.filter((m) => m.bot_id === me && m.metadata?.event_type === ROUND && m.metadata.event_payload?.kind === "check").pop();
      if (shown) {
        const kept = ((shown.blocks ?? []) as { type: string }[]).filter((b) => b.type !== "actions");
        await slack("chat.update", { channel: g.channel, ts: shown.ts, text: shown.text ?? "", blocks: [...kept, { type: "context", elements: [{ type: "mrkdwn", text: "✅ Confirmed. Writing the spec for Jamie…" }] }] });
      }
      g.grill.stage = "writing";
      await saveGrill(g);
      await deliver(g);
      return;
    }
  } catch (err) {
    report(err, "grill.round", { thread: g.thread });
    await slack("chat.update", { channel: g.channel, ts: holder.ts, text: "Sorry, something went wrong while I was thinking about this. Jamie has been told. Reply here to try again." }).catch((e) =>
      report(e, "grill.round.apology"),
    );
  }
  // Sam may have replied while Claude was thinking: answer that too, rather than leave it unread.
  const fresh = await loadGrill(g.channel, g.thread);
  if (!fresh) throw new Error(`Grill ${g.thread} disappeared`);
  fresh.grill.stage = next;
  fresh.grill.title = g.grill.title;
  await saveGrill(fresh);
  if (again < 2 && latestFromStarter(fresh) > seen) await round(fresh, again + 1);
}

// ---------- The spec ----------

async function deliver(g: G): Promise<void> {
  try {
    const fresh = (await loadGrill(g.channel, g.thread)) ?? g;
    const me = await botId();
    const { msgs } = await threadMsgs(fresh, me);
    const link = await messageLink(g.channel, g.thread);
    const date = londonDate(Date.now());
    const spec = await writeSpec({ ...(await inputs()), turns: conversation(g.grill.idea, "Sam", msgs), date, link });
    const saved = await saveSpec(date, spec.title, spec.markdown);
    await sendToJamie(spec, saved, link);
    g.grill.stage = "sent";
    g.grill.title = spec.title.slice(0, 120);
    g.grill.spec = saved.url;
    await saveGrill(g);
    await slack("chat.postMessage", { channel: g.channel, thread_ts: g.thread, text: `📄 Spec sent to Jamie: *${spec.title}*. He'll decide whether it gets built.` });
  } catch (err) {
    report(err, "grill.spec", { thread: g.thread });
    g.grill.stage = "confirm";
    await saveGrill(g).catch((e) => report(e, "grill.spec.save"));
    await slack("chat.postMessage", {
      channel: g.channel,
      thread_ts: g.thread,
      text: "Sorry, the spec didn't get written. Jamie has been told. Reply here (or tap Yes again) to try again.",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "Sorry, the spec didn't get written. Jamie has been told." } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Try again" }, action_id: "grill_yes", value: ref(g) }] },
      ],
    }).catch((e) => report(e, "grill.spec.apology"));
  }
}

/** A copy in this repo's specs/ folder, never overwriting one already there. */
async function saveSpec(date: string, title: string, markdown: string): Promise<{ path: string; url: string }> {
  const base = specPath(date, title).replace(/\.md$/, "");
  for (let n = 1; n <= 20; n++) {
    const path = n === 1 ? `${base}.md` : `${base}-${n}.md`;
    const at = `/repos/${OWNER}/fomo-app-requests/contents/${path}`;
    if ((await gh(at, { allow404: true })).status !== 404) continue;
    const res = await gh(at, { method: "PUT", body: { message: `Spec from Sam's grill: ${title}`, content: Buffer.from(markdown, "utf8").toString("base64") } });
    const json = (await res.json()) as { content: { html_url: string } };
    return { path, url: json.content.html_url };
  }
  throw new Error(`Couldn't find a free name for ${base}.md`);
}

async function sendToJamie(spec: { title: string; apps: string; started_as: string; ended_as: string; markdown: string }, saved: { path: string; url: string }, link: string): Promise<void> {
  const head = [
    `📄 *Sam's spec is ready: ${spec.title}*`,
    `*Started as:* ${spec.started_as}`,
    `*Ended as:* ${spec.ended_as}`,
    `*App:* ${spec.apps} · <${link}|Slack thread> · <${saved.url}|Saved in GitHub>`,
    "Not in the build queue. Bring it to Claude to review, and it gets built from there.",
  ].join("\n");
  const { channel } = await dm(OWNER_EMAIL, head, [{ type: "section", text: { type: "mrkdwn", text: clip(head, 2900) } }]);
  const bytes = Buffer.from(spec.markdown, "utf8");
  const filename = saved.path.split("/").pop()!;
  const up = await slack<{ upload_url: string; file_id: string }>("files.getUploadURLExternal", { filename, length: String(bytes.length) });
  const put = await fetch(up.upload_url, { method: "POST", body: bytes });
  if (!put.ok) throw new Error(`Slack file upload failed: HTTP ${put.status}`);
  await slack("files.completeUploadExternal", { files: [{ id: up.file_id, title: filename }], channel_id: channel });
}

// ---------- Buttons ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isGrillAction(p: any): boolean {
  return p?.type === "block_actions" && typeof p.actions?.[0]?.action_id === "string" && p.actions[0].action_id.startsWith("grill_");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleGrillInteraction(p: any): Promise<{ after?: () => Promise<void> } | null> {
  const action = p.actions[0];
  let r: { c?: string; t?: string } = {};
  try {
    r = JSON.parse(action.value ?? "{}");
  } catch {
    /* handled below */
  }
  if (!r.c || !r.t) throw new Error(`Grill button ${action.action_id}: bad value`);
  const g = await loadGrill(r.c, r.t);
  if (!g) throw new Error(`Grill button ${action.action_id}: grill ${r.t} not found`);
  const email = await userEmail(p.user.id);
  if (p.user.id !== g.grill.by && email !== OWNER_EMAIL) {
    await slack("chat.postEphemeral", { channel: r.c, user: p.user.id, text: "Only Sam can answer this one." });
    return null;
  }
  if (g.grill.stage !== "confirm") return null; // already pressed, or the grill moved on
  const kept = (p.message?.blocks ?? []).filter((b: { type: string }) => b.type !== "actions");
  if (action.action_id === "grill_yes") {
    g.grill.stage = "writing";
    await saveGrill(g);
    await slack("chat.update", { channel: r.c, ts: p.message.ts, text: p.message.text ?? "Confirmed", blocks: [...kept, { type: "context", elements: [{ type: "mrkdwn", text: `✅ Confirmed by <@${p.user.id}>. Writing the spec for Jamie…` }] }] });
    return { after: () => deliver(g) };
  }
  if (action.action_id === "grill_not_yet") {
    g.grill.stage = "grilling";
    await saveGrill(g);
    await slack("chat.update", { channel: r.c, ts: p.message.ts, text: p.message.text ?? "Not yet", blocks: [...kept, { type: "context", elements: [{ type: "mrkdwn", text: "Not yet." }] }] });
    await slack("chat.postMessage", { channel: r.c, thread_ts: r.t, text: "What's not right yet? Reply here and I'll carry on." });
    return null;
  }
  return null;
}
