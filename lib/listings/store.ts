/**
 * Where website listings live: Firestore fomo-bookings-board-v2 (Slack metadata is too small for a long description).
 *   website_listings/<rentmanId>          one listing per Rentman item (so a second /list-kit finds the first)
 *   website_listings_meta/folders         Rentman's equipment folders, refreshed at most once a day
 *   website_listings_meta/style           ~12 live descriptions the AI copies, refreshed at most once a week
 *   website_listings_meta/golive-<date>   "go live now" runs that London day (at most 3)
 *   onboarding_locks/rentman-writer       the one Rentman writer lease shared with kit onboarding (rule 2)
 *   website_search_index/current          written by the website sync after each run: what the site shows
 */
import type { FolderRow } from "@fomo/rentman-core/rentman-types";
import type { Listing } from "./draft";
import { db } from "./gcp";
import type { StyleRow } from "./rentman";

const LISTINGS = "website_listings";
const META = "website_listings_meta";

const clean = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export async function getListing(rentmanId: number): Promise<Listing | null> {
  const s = await db().collection(LISTINGS).doc(String(rentmanId)).get();
  return s.exists ? (s.data() as Listing) : null;
}

/** The listing whose card is this Slack message (a photo dropped in the card's thread). */
export async function listingByCard(channel: string, cardTs: string): Promise<Listing | null> {
  const q = await db().collection(LISTINGS).where("cardTs", "==", cardTs).limit(5).get();
  const hit = q.docs.map((d) => d.data() as Listing).find((l) => l.channel === channel);
  return hit ?? null;
}

export async function saveListing(l: Listing): Promise<void> {
  await db().collection(LISTINGS).doc(String(l.rentmanId)).set(clean(l));
}

/**
 * Starts a listing only if none is open for this item (two people pressing at once get one listing).
 * Returns the open one instead when it exists.
 */
export async function createListing(l: Listing): Promise<{ created: boolean; listing: Listing }> {
  const ref = db().collection(LISTINGS).doc(String(l.rentmanId));
  return db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as Listing | undefined;
    if (cur && !["live", "removed", "discarded"].includes(cur.stage)) return { created: false, listing: cur };
    tx.set(ref, clean(l));
    return { created: true, listing: l };
  });
}

/** Moves a listing from one stage to another only if it's still in `from` (a double press does nothing). */
export async function claimStage(rentmanId: number, from: Listing["stage"][], to: Listing["stage"]): Promise<Listing | null> {
  const ref = db().collection(LISTINGS).doc(String(rentmanId));
  return db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as Listing | undefined;
    if (!cur || !from.includes(cur.stage)) return null;
    const next = { ...cur, stage: to, updatedAt: Date.now() };
    tx.set(ref, clean(next));
    return next;
  });
}

/** Listings the cron looks at: drafts (reminders) and published ones (did it go live?). */
export async function openListings(): Promise<Listing[]> {
  const snap = await db().collection(LISTINGS).where("stage", "in", ["draft", "published"]).get();
  return snap.docs.map((d) => d.data() as Listing);
}

async function cached<T>(id: string, maxAgeMs: number, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const ref = db().collection(META).doc(id);
  const s = (await ref.get()).data() as { at?: number; rows?: T } | undefined;
  if (s?.rows && s.at && now - s.at < maxAgeMs) return s.rows;
  const rows = await load();
  await ref.set({ at: now, rows: clean(rows) });
  return rows;
}

export async function folders(load: () => Promise<FolderRow[]>, fresh = false): Promise<FolderRow[]> {
  return cached("folders", fresh ? 0 : 24 * 3600_000, load);
}

/** Keeps a dozen examples, two per category folder where possible, so the cached document stays small. */
export async function styleExamples(load: () => Promise<StyleRow[]>): Promise<StyleRow[]> {
  return cached("style", 7 * 24 * 3600_000, async () => (await load()).slice(0, 40));
}

/** Counts one "go live now" for a London day; false (and nothing counted) when the day's limit is used up. */
export async function countGoLive(day: string, limit: number, by: string): Promise<boolean> {
  const ref = db().collection(META).doc(`golive-${day}`);
  return db().runTransaction(async (tx) => {
    const cur = ((await tx.get(ref)).data() as { runs?: { by: string; at: number }[] } | undefined)?.runs ?? [];
    if (cur.length >= limit) return false;
    tx.set(ref, { runs: [...cur, { by, at: Date.now() }] });
    return true;
  });
}

const WRITER = () => db().collection("onboarding_locks").doc("rentman-writer");

/** The one Rentman writer lease (kit onboarding uses the same document), so two writers never interleave. */
export async function claimWriter(owner: string, ms: number): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const cur = (await tx.get(WRITER())).data() as { owner?: string; leaseUntil?: number } | undefined;
    if (cur?.owner && (cur.leaseUntil ?? 0) > Date.now()) return false;
    tx.set(WRITER(), { owner, leaseUntil: Date.now() + ms, at: Date.now(), by: "app-requests website listing" });
    return true;
  });
}

export async function releaseWriter(owner: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const cur = (await tx.get(WRITER())).data() as { owner?: string } | undefined;
    if (cur?.owner === owner) tx.delete(WRITER());
  });
}

export type LiveEntry = { rentmanId: number; slug: string; name: string };

/** What the website is showing, as the last sync wrote it (one Firestore read). */
export async function liveIndex(): Promise<{ updatedAt: number; entries: LiveEntry[] }> {
  const d = (await db().collection("website_search_index").doc("current").get()).data() as { updatedAt?: unknown; entries?: LiveEntry[] } | undefined;
  if (!d) throw new Error("website_search_index/current is missing: has the website sync ever run?");
  const u = d.updatedAt as { toMillis?: () => number } | string | number | undefined;
  const updatedAt = typeof u === "object" && u?.toMillis ? u.toMillis() : typeof u === "string" ? Date.parse(u) : Number(u) || 0;
  return { updatedAt, entries: d.entries ?? [] };
}
