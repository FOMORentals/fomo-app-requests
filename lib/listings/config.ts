/**
 * Website listings (`/list-kit`), agreed with Jamie on 23 Nov 2026 (docs/DESIGN.md "Website listings").
 * The team finishes a new purchase's website listing in Slack: the AI drafts the web fields, a person checks them,
 * an approver publishes.
 */
import { OWNER_EMAIL, personByEmail } from "../config";

/** Who can publish, go live now and take an item off the website (Jamie, 23 Nov 2026). */
export const LISTING_APPROVERS = [OWNER_EMAIL, "sam@fomorentals.co.uk", "will@fomorentals.co.uk"];

export function canPublish(email: string): boolean {
  return LISTING_APPROVERS.includes(email.trim().toLowerCase());
}

/** Anyone on the team can start and edit a draft. */
export function canDraft(email: string): boolean {
  return !!personByEmail(email);
}

/** "Go live now" runs the website sync straight away: 6 Rentman calls each, at most 3 a day (Jamie, 23 Nov 2026). */
export const GO_LIVE_PER_DAY = 3;
/** One reminder to a draft's owner after this long untouched. */
export const REMIND_AFTER_MS = 2 * 24 * 60 * 60_000;
/** "Recent ones": items created in Rentman in this many days that aren't on the website. */
export const RECENT_DAYS = 14;
/** The daily website sync runs at 05:41 London; a listing published before it should be live by this hour. */
export const LIVE_BY_HOUR = 8;
/** The AI drafting the copy and specs: Haiku, as kit onboarding (Jamie, 6 Oct 2026: simple work, people check it). */
export const LISTING_MODEL = "claude-haiku-5-5";

export function listingsChannel(): string {
  const c = process.env.LISTINGS_CHANNEL_ID?.trim();
  if (!c) throw new Error("LISTINGS_CHANNEL_ID is not set");
  return c;
}

export function websiteUrl(): string {
  return (process.env.WEBSITE_URL || "https://www.fomorentals.co.uk").replace(/\/$/, "");
}

/** The Rentman web app, for "fix it in Rentman" links. */
export const RENTMAN_APP = "https://fomorentals.rentmanapp.com";
export const rentmanLink = (id: number) => `${RENTMAN_APP}/#/equipment/${id}`;
