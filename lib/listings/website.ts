/**
 * The website side of a listing:
 * - its At a glance / tech spec file in FOMORentals/fomo-rentals-website-rebuild content/tech-specs/ (GitHub, the
 *   app's own token). The website sync reads the folder from main at every run. Publish is the person's check of
 *   the file (Jamie, 23 Nov 2026), so it goes in through a pull request that is merged straight away, as kit
 *   onboarding's publish does. Never deletes a file; only creates one or updates this item's own.
 * - "go live now": starts the website-sync Cloud Run job with --publish (6 Rentman calls), as the daily 05:41 run does.
 */
import { gh } from "../github";
import { googleToken } from "./gcp";

const REPO = "/repos/FOMORentals/fomo-rentals-website-rebuild";
const DIR = "content/tech-specs";

/** The names (no .md) of every tech spec file on the website's main branch. */
export async function specFileNames(): Promise<Set<string>> {
  const list = (await (await gh(`${REPO}/contents/${DIR}?ref=main`)).json()) as { name: string }[];
  return new Set(list.filter((f) => f.name.endsWith(".md")).map((f) => f.name.slice(0, -3)));
}

/** One file's text, or null when it doesn't exist. */
export async function readSpecFile(name: string): Promise<string | null> {
  const res = await gh(`${REPO}/contents/${DIR}/${name}.md?ref=main`, { allow404: true });
  if (res.status === 404) return null;
  const j = (await res.json()) as { content: string };
  return Buffer.from(j.content, "base64").toString("utf8");
}

/** Pure: the Rentman ids a tech spec file is pinned to (front matter `rentman: 1, 2`); empty = matched by Brand + Model. */
export function pinnedIds(text: string): number[] {
  const front = text.split(/^---$/m)[1] ?? "";
  const m = /^rentman:\s*(.+)$/m.exec(front);
  return m ? m[1].split(",").map((x) => Number(x.trim())).filter((n) => n > 0) : [];
}

/** Writes the file through a pull request that is merged at once. Returns the pull request's link. */
export async function writeSpecFile(name: string, text: string, title: string, by: string): Promise<string> {
  const main = (await (await gh(`${REPO}/git/ref/heads/main`)).json()) as { object: { sha: string } };
  const branch = `website-listing/${name}-${Date.now()}`;
  await gh(`${REPO}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: main.object.sha } });
  const path = `${DIR}/${name}.md`;
  const cur = await gh(`${REPO}/contents/${path}?ref=${encodeURIComponent(branch)}`, { allow404: true });
  const sha = cur.status === 404 ? undefined : ((await cur.json()) as { sha: string }).sha;
  await gh(`${REPO}/contents/${path}`, {
    method: "PUT",
    body: { message: `Website listing: ${title} (${by})`, content: Buffer.from(text).toString("base64"), branch, ...(sha ? { sha } : {}) },
  });
  const body = [
    `Tech spec page for **${title}**, published by ${by} from Slack \`/list-kit\`. The approver checked the At a glance rows and tables in Slack before pressing Publish (Jamie, 23 Nov 2026).`,
    "",
    "## Team note",
    "None",
    "",
    "## Design notes",
    "No decision changed: content file only.",
  ].join("\n");
  const pr = (await (await gh(`${REPO}/pulls`, { method: "POST", body: { title: `Tech spec: ${title}`, head: branch, base: "main", body } })).json()) as { number: number; html_url: string };
  await gh(`${REPO}/pulls/${pr.number}/merge`, { method: "PUT", body: { merge_method: "squash" } });
  await gh(`${REPO}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" }).catch(() => undefined); // tidy only; the merge is what matters
  return pr.html_url;
}

const JOB = "https://run.googleapis.com/v2/projects/fomo-rentals-website/locations/europe-west2/jobs/website-sync:run";

/** Starts the website sync now, publishing the site (the job's own lock stops it overlapping the 05:41 run). */
export async function runWebsiteSync(): Promise<string> {
  const res = await fetch(JOB, {
    method: "POST",
    headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ overrides: { containerOverrides: [{ args: ["--publish"] }] } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Starting the website sync failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const op = (await res.json()) as { name?: string };
  return op.name ?? "";
}
