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

async function ensureLabel(repo: string): Promise<void> {
  const res = await gh(`/repos/${OWNER}/${repo}/labels/${BUILD_LABEL}`, { allow404: true });
  if (res.status !== 404) return;
  await gh(`/repos/${OWNER}/${repo}/labels`, {
    method: "POST",
    body: { name: BUILD_LABEL, color: "5319e7", description: "Built by Claude from #app-requests" },
  });
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

/** Squash-merges an approved pull request. Returns the merge commit. */
export async function mergePr(repo: string, pr: number): Promise<string> {
  const res = await gh(`/repos/${OWNER}/${repo}/pulls/${pr}/merge`, { method: "PUT", body: { merge_method: "squash" } });
  const out = (await res.json()) as { sha: string; merged: boolean; message?: string };
  if (!out.merged) throw new Error(`GitHub did not merge ${repo}#${pr}: ${out.message ?? "no reason given"}`);
  return out.sha;
}

export type DeployState = "success" | "failure" | "pending" | "none";

/** The live (Production) deploy of a commit, as Vercel reports it to GitHub. */
export async function productionDeploy(repo: string, sha: string): Promise<{ state: DeployState; url: string }> {
  const deps = (await (await gh(`/repos/${OWNER}/${repo}/deployments?sha=${sha}&per_page=20`)).json()) as {
    id: number;
    environment: string;
  }[];
  const prod = deps.filter((d) => /production/i.test(d.environment) && !/preview/i.test(d.environment));
  if (!prod.length) return { state: "none", url: "" };
  let pending = false;
  for (const d of prod) {
    const statuses = (await (await gh(`/repos/${OWNER}/${repo}/deployments/${d.id}/statuses?per_page=5`)).json()) as {
      state: string;
      environment_url?: string;
      target_url?: string;
    }[];
    const s = statuses[0]?.state;
    if (s === "success") return { state: "success", url: statuses[0].environment_url || statuses[0].target_url || "" };
    if (s === "failure" || s === "error") return { state: "failure", url: statuses[0].target_url || "" };
    pending = true;
  }
  return { state: pending ? "pending" : "none", url: "" };
}

/** Whether a build issue is still open (a person may have closed it on GitHub). */
export async function issueOpen(repo: string, issue: number): Promise<boolean> {
  const res = await gh(`/repos/${OWNER}/${repo}/issues/${issue}`);
  return ((await res.json()) as { state: string }).state === "open";
}
