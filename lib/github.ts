/**
 * GitHub: read design notes, open the build issue, merge an approved pull request, check the deploy.
 * Every failure throws (rule 1), except a design-notes file that doesn't exist, which is reported as missing.
 */
import { OWNER } from "./config";

function token(): string {
  const t = process.env.GITHUB_TOKEN?.trim();
  if (!t) throw new Error("GITHUB_TOKEN is not set");
  return t;
}

async function gh(path: string, init: { method?: string; body?: unknown; accept?: string; allow404?: boolean } = {}): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: init.accept ?? "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fomo-app-requests",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 404 && init.allow404) return res;
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed: HTTP ${res.status} ${detail}`);
  }
  return res;
}

/** A file from the default branch as it is right now, or null when the repo has no such file. */
export async function fileNow(repo: string, path: string): Promise<string | null> {
  const res = await gh(`/repos/${OWNER}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    accept: "application/vnd.github.raw",
    allow404: true,
  });
  if (res.status === 404) return null;
  return res.text();
}

export const BUILD_LABEL = "app-request";
/** Starts the repo's "App question" workflow: Claude reads the code, read only, and reports what it found. */
export const QUESTION_LABEL = "app-question";

const LABELS: Record<string, { color: string; description: string }> = {
  [BUILD_LABEL]: { color: "5319e7", description: "Built by Claude from #app-requests" },
  [QUESTION_LABEL]: { color: "0e8a16", description: "Looked into by Claude from #app-requests (read only)" },
};

async function ensureLabel(repo: string, name = BUILD_LABEL): Promise<void> {
  const res = await gh(`/repos/${OWNER}/${repo}/labels/${name}`, { allow404: true });
  if (res.status !== 404) return;
  await gh(`/repos/${OWNER}/${repo}/labels`, { method: "POST", body: { name, ...LABELS[name] } });
}

/** Opens the question issue; its label starts the repo's "App question" workflow, which closes it when done. */
export async function openQuestionIssue(repo: string, title: string, body: string): Promise<{ number: number; url: string }> {
  await ensureLabel(repo, QUESTION_LABEL);
  const res = await gh(`/repos/${OWNER}/${repo}/issues`, { method: "POST", body: { title, body } });
  const issue = (await res.json()) as { number: number; html_url: string };
  await gh(`/repos/${OWNER}/${repo}/issues/${issue.number}/labels`, { method: "POST", body: { labels: [QUESTION_LABEL] } });
  return { number: issue.number, url: issue.html_url };
}

/** Opens the build issue. Adding the label starts the repo's "App request build" workflow. */
export async function openBuildIssue(repo: string, title: string, body: string): Promise<{ number: number; url: string }> {
  await ensureLabel(repo);
  const res = await gh(`/repos/${OWNER}/${repo}/issues`, { method: "POST", body: { title, body } });
  const issue = (await res.json()) as { number: number; html_url: string };
  await addBuildLabel(repo, issue.number);
  return { number: issue.number, url: issue.html_url };
}

export async function addBuildLabel(repo: string, issue: number): Promise<void> {
  await gh(`/repos/${OWNER}/${repo}/issues/${issue}/labels`, { method: "POST", body: { labels: [BUILD_LABEL] } });
}

/** Taking the label off and putting it back starts another build on the same issue. */
export async function rebuild(repo: string, issue: number, comment: string): Promise<void> {
  await gh(`/repos/${OWNER}/${repo}/issues/${issue}/comments`, { method: "POST", body: { body: comment } });
  await gh(`/repos/${OWNER}/${repo}/issues/${issue}/labels/${BUILD_LABEL}`, { method: "DELETE", allow404: true });
  await addBuildLabel(repo, issue);
}

export async function commentOnIssue(repo: string, issue: number, body: string): Promise<void> {
  await gh(`/repos/${OWNER}/${repo}/issues/${issue}/comments`, { method: "POST", body: { body } });
}

export async function closeIssue(repo: string, issue: number, reason: "completed" | "not_planned"): Promise<void> {
  await gh(`/repos/${OWNER}/${repo}/issues/${issue}`, { method: "PATCH", body: { state: "closed", state_reason: reason } });
}

export async function closePr(repo: string, pr: number): Promise<void> {
  await gh(`/repos/${OWNER}/${repo}/pulls/${pr}`, { method: "PATCH", body: { state: "closed" } });
}

/** Files touched by both lists: the clash risk between a waiting change and what went live since it was built. Pure. */
export function sharedFiles(changed: string[], liveSince: string[]): string[] {
  const live = new Set(liveSince);
  // Design notes and team-note pictures change in nearly every pull request without touching how the app works; a
  // real text clash in them is still caught when GitHub refuses the merge.
  const notes = (f: string) => f.startsWith("docs/") || f.startsWith("whats-new/");
  return [...new Set(changed)].filter((f) => live.has(f) && !notes(f));
}

/**
 * Has anything gone live since this pull request was built that touches the same files?
 * Returns those files (empty when it's safe to merge as it is).
 */
export async function overlapSinceBuilt(repo: string, pr: number): Promise<string[]> {
  const p = (await (await gh(`/repos/${OWNER}/${repo}/pulls/${pr}`)).json()) as { head: { sha: string }; base: { ref: string } };
  const cmp = (await (await gh(`/repos/${OWNER}/${repo}/compare/${p.head.sha}...${encodeURIComponent(p.base.ref)}?per_page=100`)).json()) as {
    ahead_by: number;
    files?: { filename: string }[];
  };
  if (!cmp.ahead_by) return [];
  const mine = (await (await gh(`/repos/${OWNER}/${repo}/pulls/${pr}/files?per_page=100`)).json()) as { filename: string }[];
  return sharedFiles(mine.map((f) => f.filename), (cmp.files ?? []).map((f) => f.filename));
}

/** Squash-merges an approved pull request. Returns the merge commit. */
export async function mergePr(repo: string, pr: number): Promise<string> {
  const res = await gh(`/repos/${OWNER}/${repo}/pulls/${pr}/merge`, { method: "PUT", body: { merge_method: "squash" } });
  const out = (await res.json()) as { sha: string; merged: boolean; message?: string };
  if (!out.merged) throw new Error(`GitHub did not merge ${repo}#${pr}: ${out.message ?? "no reason given"}`);
  return out.sha;
}

export type DeployState = "success" | "failure" | "pending" | "none";

/** The live (Production) deploy of a commit, as Vercel reports it to GitHub. */
/**
 * Vercel reports each deploy on the commit as a GitHub commit status (context "Vercel", or "Vercel – <project>"
 * when one repo feeds several projects); it doesn't create GitHub deployments for these repos (found 18 Nov 2026).
 * The merge commit is on main, so its Vercel statuses are the live deploys.
 */
export function vercelState(statuses: { context: string; state: string; target_url?: string | null }[]): { state: DeployState; url: string } {
  const v = statuses.filter((s) => /vercel/i.test(s.context));
  if (!v.length) return { state: "none", url: "" };
  const bad = v.find((s) => s.state === "failure" || s.state === "error");
  if (bad) return { state: "failure", url: bad.target_url || "" };
  if (v.every((s) => s.state === "success")) return { state: "success", url: v[0].target_url || "" };
  return { state: "pending", url: "" };
}

export async function productionDeploy(repo: string, sha: string): Promise<{ state: DeployState; url: string }> {
  // The combined status keeps the latest status per context.
  const res = (await (await gh(`/repos/${OWNER}/${repo}/commits/${sha}/status?per_page=100`)).json()) as {
    statuses: { context: string; state: string; target_url?: string | null }[];
  };
  return vercelState(res.statuses ?? []);
}

/** Whether a build issue is still open (a person may have closed it on GitHub). */
export async function issueOpen(repo: string, issue: number): Promise<boolean> {
  const res = await gh(`/repos/${OWNER}/${repo}/issues/${issue}`);
  return ((await res.json()) as { state: string }).state === "open";
}
