/**
 * Who can ask, who approves, and which apps can be built from a request.
 * Agreed with Jamie on 17 Nov 2026 (docs/DESIGN.md). To change it, edit this file and redeploy.
 */

export type Role = "approver" | "owner" | "team";
export type Person = { email: string; name: string; role: Role };

export const PEOPLE: Person[] = [
  { email: "jamie@fomorentals.co.uk", name: "Jamie", role: "owner" },
  { email: "sam@fomorentals.co.uk", name: "Sam", role: "approver" },
  { email: "louis@fomorentals.co.uk", name: "Louis", role: "team" },
  { email: "rosie@fomorentals.co.uk", name: "Rosie", role: "team" },
  { email: "will@fomorentals.co.uk", name: "Will", role: "team" },
  { email: "margarita@fomorentals.co.uk", name: "Margarita", role: "team" },
];

export const OWNER_EMAIL = "jamie@fomorentals.co.uk";
export const APPROVER_EMAIL = "sam@fomorentals.co.uk";

export function personByEmail(email: string | null | undefined): Person | null {
  const e = (email ?? "").trim().toLowerCase();
  return PEOPLE.find((p) => p.email === e) ?? null;
}

/**
 * build:     small fixes are built, then Sam approves.
 * proposal:  every request is a written proposal; Jamie decides (customers see it, or it writes to Rentman).
 * not_offered: behind the scenes, or only Jamie uses it. Claude says it's one for Jamie.
 */
export type Mode = "build" | "proposal" | "not_offered";

export type App = {
  key: string;
  repo: string; // GitHub repo under OWNER
  name: string; // what the team calls it
  mode: Mode;
  about: string; // one line, used to work out which app a request is about
};

export const OWNER = "FOMORentals";

export const APPS: App[] = [
  { key: "dashboard", repo: "fomo-bookings-board-v2", name: "Team Dashboard", mode: "build", about: "the bookings board: tickets, enquiries, Order Tracker, Kit Prep, Applications, Accounts Receivable, conversation window, warehouse TV (team-dashboard.fomorentals.co.uk)" },
  { key: "overtime", repo: "fomo-overtime", name: "Overtime", mode: "build", about: "overtime slots in Slack #rentals_overtime, /overtime, claiming and giving away slots, the admin page and CSV" },
  { key: "whatsnew", repo: "fomo-whats-new", name: "What's new", mode: "build", about: "the #whats-new channel, /whatsnew, the history page, idea votes" },
  { key: "inventory", repo: "fomo-inventory-dashboard", name: "Inventory dashboard", mode: "build", about: "fleet and kit charts and KPIs: Overview, Explore, buy and sell decisions, cross-hire, data pages (its Onboarding section is Kit onboarding, below)" },
  { key: "portal", repo: "fomo-client-portal", name: "Client portal", mode: "proposal", about: "what clients see: quotes, invoices, Pay now, kit builder, packing checklist" },
  { key: "website", repo: "fomo-rentals-website-rebuild", name: "Website", mode: "proposal", about: "the public website fomorentals.co.uk, the Open Account form, the rate card" },
  { key: "kit", repo: "fomo-kit-onboarding", name: "Kit onboarding", mode: "proposal", about: "adding new kit to Rentman: the Onboarding section of the inventory dashboard (batches, goods in, push to Rentman) and the job behind it" },
  { key: "consignor", repo: "fomo-consignor-portal", name: "Consignor portal", mode: "proposal", about: "what consignors (kit owners such as FKF One) see about their kit and commission" },
  { key: "requests", repo: "fomo-app-requests", name: "App requests", mode: "proposal", about: "this #app-requests channel itself: the questions, approvals and builds" },
  { key: "status", repo: "fomo-status-dashboard", name: "Status dashboard", mode: "not_offered", about: "Jamie's traffic-light view of every system" },
  { key: "function", repo: "fomo-cloud-function", name: "Rentman-HubSpot link (Cloud Function)", mode: "not_offered", about: "behind the scenes: Rentman to HubSpot deal sync, KPI sheet, Xero export, invoice reminders" },
  { key: "rentmancore", repo: "fomo-rentman-core", name: "Rentman core", mode: "not_offered", about: "behind the scenes: the shared Rentman library" },
  { key: "gmail", repo: "fomo-gmail-mcp", name: "Gmail connector", mode: "not_offered", about: "Jamie's own Gmail connector for Claude" },
];

export function appByKey(key: string | null | undefined): App | undefined {
  const k = (key ?? "").trim().toLowerCase();
  return APPS.find((a) => a.key === k);
}

/** The files Claude reads, fresh from GitHub at every request, to check a request against Jamie's decisions. */
export const NOTES_FILES = ["docs/DESIGN.md", "CLAUDE.md"];

/** At most this many builds run at once (design: guard rails). */
export const MAX_BUILDS = 3;
/** Times an approved change is rebuilt on top of others that went live first, before it merges as it is. */
export const MAX_CATCH_UPS = 2;
/**
 * "Why is the app doing this?" questions (Jamie, 20 Nov 2026): Claude reads the app's code on GitHub, read only.
 * Every app the team can ask about (build and proposal apps), each with the "App question" workflow. Not the
 * behind-the-scenes ones (Cloud Function, Rentman core, Gmail connector, Status dashboard): Jamie, 20 Nov 2026.
 */
export function canLookInto(app: App | undefined): app is App {
  return !!app && app.mode !== "not_offered";
}
/** At most this many looks into the code per question, then it goes to Jamie. */
export const MAX_LOOKS = 2;

/** Grill: at most this many rounds, of at most this many questions. */
export const MAX_ROUNDS = 2;
export const MAX_QUESTIONS = 3;
