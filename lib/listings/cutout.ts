/**
 * Photo cut-outs for website listings (Jamie, 23 Nov 2026): drop a photo in a listing card's thread in
 * #website-listings and the cut-out comes back in the thread, ready to upload to the item in Rentman by hand
 * (Rentman's API can't take photos).
 *
 * The background remover is too big for Vercel, so the "Listing photo cut-out" workflow in this repo
 * (.github/workflows/listing-cutout.yml, GitHub Actions, about 2 minutes) does the work:
 *   1. here: a photo lands in a card's thread → repository_dispatch "listing-cutout" with the Slack file id
 *   2. workflow → POST /api/listings/cutout {action:"source"}  : this app streams the photo from Slack
 *   3. workflow cuts it out (scripts/cutout.py, the website's recipe: transparent, trimmed, soft shadow)
 *   4. workflow → {action:"upload"}: this app asks Slack for an upload address; the workflow sends the PNG straight there
 *   5. workflow → {action:"done"} (or {action:"failed"}): this app shares the file in the card's thread
 * The Slack token stays in Vercel; the workflow only holds APP_REQUESTS_CALLBACK_SECRET, which signs every call.
 * No Rentman calls.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { gh } from "../github";
import { report } from "../report";
import { slack, userEmail } from "../slack";
import { canDraft, listingsChannel } from "./config";
import { listingByCard } from "./store";

export const CUTOUT_REPO = "FOMORentals/fomo-app-requests";
export const CUTOUT_EVENT = "listing-cutout";
export const CUTOUT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
export const MAX_PHOTOS = 3;
export const MAX_BYTES = 25 * 1024 * 1024;

type SlackFileShare = { id: string; name?: string; mimetype?: string; size?: number };
export type FileShareEvent = { type?: string; subtype?: string; channel?: string; ts?: string; thread_ts?: string; user?: string; bot_id?: string; files?: SlackFileShare[] };

/** A photo dropped in a reply in #website-listings (not by a bot). Pure. */
export function cutoutPhotos(e: FileShareEvent | undefined, channel = listingsChannel()): SlackFileShare[] {
  if (e?.type !== "message" || !channel || e.channel !== channel) return [];
  if (e.bot_id || (e.subtype && e.subtype !== "file_share")) return [];
  if (!e.thread_ts || e.thread_ts === e.ts) return [];
  return (e.files ?? []).filter((f) => CUTOUT_TYPES.includes(f.mimetype ?? "")).slice(0, MAX_PHOTOS);
}

const say = (channel: string, thread: string, text: string) => slack("chat.postMessage", { channel, thread_ts: thread, text });

/** Starts a cut-out for each photo dropped in a listing card's thread. */
export async function startCutouts(e: FileShareEvent): Promise<void> {
  const photos = cutoutPhotos(e);
  if (!photos.length || !e.channel || !e.thread_ts || !e.user) return;
  const l = await listingByCard(e.channel, e.thread_ts);
  if (!l) return; // a reply under something that isn't a listing card
  if (!canDraft(await userEmail(e.user))) {
    await say(e.channel, e.thread_ts, "Only the FOMO team can use this. Please ask Jamie.");
    return;
  }
  for (const f of photos) {
    if ((f.size ?? 0) > MAX_BYTES) {
      await say(e.channel, e.thread_ts, `${f.name ?? "That photo"} is over 25 MB. Please send a smaller copy.`);
      continue;
    }
    await gh(`/repos/${CUTOUT_REPO}/dispatches`, {
      method: "POST",
      body: { event_type: CUTOUT_EVENT, client_payload: { file: f.id, name: f.name ?? "photo", channel: e.channel, thread: e.thread_ts, rentmanId: String(l.rentmanId), by: e.user } },
    });
    await say(e.channel, e.thread_ts, `✂️ Cutting out ${f.name ?? "the photo"}… it comes back here in about 2 minutes.`);
  }
}

export function signCutout(raw: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}

export function cutoutSigned(raw: string, sig: string | null, secret: string): boolean {
  if (!sig) return false;
  const want = Buffer.from(signCutout(raw, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type CutoutCall =
  | { action: "source"; file: string }
  | { action: "upload"; name: string; length: number }
  | { action: "done"; upload: string; channel: string; thread: string; name: string }
  | { action: "failed"; channel: string; thread: string; name?: string; reason: string; runUrl?: string };

const outName = (name: string) => `${name.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "-").slice(0, 80) || "photo"}-cutout.png`;

/** The workflow's calls. Returns a Response (the photo's bytes for "source", JSON otherwise). */
export async function handleCutoutCall(c: CutoutCall): Promise<Response> {
  const channel = listingsChannel();
  if ((c.action === "done" || c.action === "failed") && c.channel !== channel) return Response.json({ error: "not the listings channel" }, { status: 400 });
  switch (c.action) {
    case "source": {
      const info = await slack<{ file: { url_private_download?: string; mimetype?: string; size?: number; channels?: string[]; groups?: string[]; shares?: { public?: Record<string, unknown>; private?: Record<string, unknown> } } }>("files.info", { file: c.file });
      const f = info.file;
      const where = [...(f.channels ?? []), ...(f.groups ?? []), ...Object.keys(f.shares?.public ?? {}), ...Object.keys(f.shares?.private ?? {})];
      if (!where.includes(channel)) return Response.json({ error: "not shared in the listings channel" }, { status: 403 });
      if (!CUTOUT_TYPES.includes(f.mimetype ?? "") || (f.size ?? 0) > MAX_BYTES || !f.url_private_download) return Response.json({ error: "not a photo, or over 25 MB" }, { status: 400 });
      const res = await fetch(f.url_private_download, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN?.trim()}` } });
      if (!res.ok || !res.body) throw new Error(`Slack file download failed: HTTP ${res.status}`);
      // Streamed, so a large phone photo isn't held in memory or cut short.
      return new Response(res.body, { headers: { "Content-Type": f.mimetype ?? "application/octet-stream" } });
    }
    case "upload": {
      if (!(c.length > 0 && c.length <= MAX_BYTES)) return Response.json({ error: "bad length" }, { status: 400 });
      const r = await slack<{ upload_url: string; file_id: string }>("files.getUploadURLExternal", { filename: outName(c.name), length: c.length });
      return Response.json({ url: r.upload_url, upload: r.file_id });
    }
    case "done": {
      await slack("files.completeUploadExternal", {
        files: [{ id: c.upload, title: outName(c.name) }],
        channel_id: channel,
        thread_ts: c.thread,
        initial_comment: `Here's the cut-out of ${c.name}. Download it, add it to the item in Rentman (Images), then press *Check again* on the card.`,
      });
      return Response.json({ ok: true });
    }
    case "failed": {
      report(new Error(`Listing cut-out failed: ${c.reason}`), "listings.cutout", { thread: c.thread, run: c.runUrl ?? "" });
      await say(channel, c.thread, `Sorry, the cut-out of ${c.name ?? "that photo"} didn't work: ${c.reason}${c.runUrl ? ` (<${c.runUrl}|details>)` : ""}. Jamie has been told.`);
      return Response.json({ ok: true });
    }
  }
}
