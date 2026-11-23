/** Thin Slack Web API wrapper. Every failure throws (FOMO engineering rule 1: nothing fails silently). */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://slack.com/api";

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN?.trim();
  if (!t) throw new Error("SLACK_BOT_TOKEN is not set");
  return t;
}

export function channel(): string {
  const c = process.env.REQUESTS_CHANNEL_ID?.trim();
  if (!c) throw new Error("REQUESTS_CHANNEL_ID is not set");
  return c;
}

export class SlackError extends Error {
  constructor(public method: string, public code: string) {
    super(`Slack ${method} failed: ${code}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function slack<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  // Form-encoded, because some read methods (users.info, users.lookupByEmail, chat.getPermalink)
  // ignore JSON bodies. Objects such as blocks and views go in as JSON strings, which Slack accepts.
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token()}` },
    body: form,
  });
  if (!res.ok) throw new SlackError(method, `HTTP ${res.status}`);
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) throw new SlackError(method, json.error ?? "unknown_error");
  return json as T;
}

/** Slack request signing check (https://api.slack.com/authentication/verifying-requests-from-slack). */
export function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null, now = Date.now()): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("SLACK_SIGNING_SECRET is not set");
  if (!timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 60 * 5) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Meta = { event_type: string; event_payload: Record<string, string> };
export type SlackFile = { id: string; name?: string; mimetype?: string; url_private?: string; size?: number };
export type SlackMessage = {
  ts: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  reply_count?: number;
  latest_reply?: string;
  files?: SlackFile[];
  metadata?: Meta;
  blocks?: unknown[];
};

/** Messages in a channel (newest first), with the app's metadata, back to `oldestMs`. */
export async function history(channelId: string, oldestMs: number, max = 1000): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const res = await slack<{ messages: SlackMessage[]; response_metadata?: { next_cursor?: string } }>("conversations.history", {
      channel: channelId,
      oldest: String(oldestMs / 1000),
      limit: 200,
      include_all_metadata: true,
      cursor,
    });
    out.push(...res.messages);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor && out.length < max);
  return out;
}

/** One message by its ts, with metadata. */
export async function getMessage(channelId: string, ts: string): Promise<SlackMessage | null> {
  const res = await slack<{ messages: SlackMessage[] }>("conversations.history", {
    channel: channelId,
    latest: ts,
    inclusive: true,
    limit: 1,
    include_all_metadata: true,
  });
  return res.messages.find((m) => m.ts === ts) ?? null;
}

/** Every message in a thread, oldest first, with the app's metadata. */
export async function replies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const res = await slack<{ messages: SlackMessage[]; response_metadata?: { next_cursor?: string } }>("conversations.replies", {
      channel: channelId,
      ts: threadTs,
      limit: 200,
      include_all_metadata: true,
      cursor,
    });
    out.push(...res.messages);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

const idCache = new Map<string, string>();
const emailCache = new Map<string, string>();

/** Slack user id for a fomorentals.co.uk address. */
export async function userIdByEmail(email: string): Promise<string> {
  const hit = idCache.get(email);
  if (hit) return hit;
  const u = await slack<{ user: { id: string } }>("users.lookupByEmail", { email });
  idCache.set(email, u.user.id);
  emailCache.set(u.user.id, email);
  return u.user.id;
}

/** The email on a Slack account ("" when it has none, e.g. a bot). */
export async function userEmail(userId: string): Promise<string> {
  const hit = emailCache.get(userId);
  if (hit !== undefined) return hit;
  const u = await slack<{ user: { profile?: { email?: string } } }>("users.info", { user: userId });
  const email = (u.user.profile?.email ?? "").toLowerCase();
  emailCache.set(userId, email);
  return email;
}

/** The bot's DM channel with a person. */
export async function dmChannel(userId: string): Promise<string> {
  const im = await slack<{ channel: { id: string } }>("conversations.open", { users: userId });
  return im.channel.id;
}

let teamUrlCache: string | null = null;

/** Link to a message, built from the workspace address (saves a chat.getPermalink call per message). */
export async function messageLink(channelId: string, ts: string, threadTs?: string): Promise<string> {
  if (!teamUrlCache) teamUrlCache = (await slack<{ url: string }>("auth.test", {})).url.replace(/\/$/, "");
  const base = `${teamUrlCache}/archives/${channelId}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${base}?thread_ts=${threadTs}&cid=${channelId}` : base;
}

/** A file someone attached, as base64, for Claude to look at. Throws on failure (rule 1). */
export async function fileBase64(url: string): Promise<string> {
  const t = process.env.SLACK_BOT_TOKEN?.trim();
  if (!t) throw new Error("SLACK_BOT_TOKEN is not set");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(`Slack file download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
