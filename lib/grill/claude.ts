/**
 * Sam's grill: the Claude calls. One round = one call with read-only code tools (looped until Claude writes the round),
 * and the spec at the end. Uses the bot's existing Anthropic key. Throws on any failure (rule 1).
 * External calls: Anthropic, and GitHub reads (design notes, code). No Rentman, HubSpot or Xero.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { OWNER } from "../config";
import { fileNow, gh } from "../github";
import { GRILL_MODEL, GRILL_REPOS, setting, specInstructions, type Interviewee, type Turn } from "./prompt";

let client: Anthropic | null = null;
function api(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic();
  return client;
}

/** Slack gives the events route 300 s; a round stops looking things up after this and writes what it has. */
const LOOK_BUDGET_MS = 200_000;
const MAX_TOOL_STEPS = 20;
const MAX_FILE_CHARS = 60_000;

export type Image = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };

export type RoundResult =
  | { kind: "round"; text: string }
  | { kind: "check"; title: string; understanding: string }
  | { kind: "write_spec" };

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_files",
    description: "Lists the files in one of FOMO's app repos on GitHub (read only), optionally only those whose path contains `contains`. Use it to find where a screen or feature lives before reading it.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", enum: GRILL_REPOS },
        contains: { type: "string", description: "Optional: only paths containing this text (case-insensitive), e.g. 'Deals' or 'components/'." },
      },
      required: ["repo"],
    },
  },
  {
    name: "read_file",
    description: "Reads one file from one of FOMO's app repos on GitHub as it is live now (read only).",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string", enum: GRILL_REPOS }, path: { type: "string" } },
      required: ["repo", "path"],
    },
  },
  {
    name: "check_understanding",
    description:
      "Call when the frontier is empty: every branch of the design tree visited and nothing silently assumed. Sam is shown the shared understanding with buttons to confirm it or say not yet. Do not also write a round.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short name for the idea as it now stands, e.g. 'Morning pipeline view'." },
        understanding: { type: "string", description: "The shared understanding, as a few short bullet points Sam can check at a glance." },
      },
      required: ["title", "understanding"],
    },
  },
  {
    name: "write_spec",
    description: "Call only when Sam has clearly confirmed, in words, the shared understanding you last showed him. The spec then goes to Jamie.",
    input_schema: { type: "object", properties: {} },
  },
];

const treeCache = new Map<string, string[]>();

async function listFiles(repo: string, contains?: string): Promise<string> {
  let paths = treeCache.get(repo);
  if (!paths) {
    const info = (await (await gh(`/repos/${OWNER}/${repo}`)).json()) as { default_branch: string };
    const tree = (await (await gh(`/repos/${OWNER}/${repo}/git/trees/${encodeURIComponent(info.default_branch)}?recursive=1`)).json()) as {
      tree: { path: string; type: string }[];
    };
    paths = tree.tree.filter((t) => t.type === "blob" && !/(^|\/)(node_modules|\.next|package-lock\.json)/.test(t.path)).map((t) => t.path);
    treeCache.set(repo, paths);
  }
  const c = contains?.trim().toLowerCase();
  const hits = c ? paths.filter((p) => p.toLowerCase().includes(c)) : paths;
  const shown = hits.slice(0, 400);
  return `${shown.join("\n")}${hits.length > shown.length ? `\n…and ${hits.length - shown.length} more; narrow it with "contains".` : ""}` || "No files match.";
}

async function readFile(repo: string, path: string): Promise<string> {
  const text = await fileNow(repo, path);
  if (text === null) return `No file ${path} in ${repo}.`;
  return text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n…(file cut at ${MAX_FILE_CHARS} characters)` : text;
}

/** A tool's answer. A failed GitHub read is told to Claude (it can try another path) and logged, not hidden. */
async function runTool(name: string, input: Record<string, string>): Promise<string> {
  if (!GRILL_REPOS.includes(input.repo)) return `Unknown repo ${input.repo}.`;
  try {
    return name === "list_files" ? await listFiles(input.repo, input.contains) : await readFile(input.repo, input.path);
  } catch (err) {
    console.error("GRILL tool failed", name, input.repo, input.path ?? "", err instanceof Error ? err.message : err);
    return `That read failed: ${err instanceof Error ? err.message.slice(0, 200) : "error"}.`;
  }
}

function system(skill: string, context: string, who: Interviewee): Anthropic.Beta.BetaTextBlockParam[] {
  // The skill, the setting and the context change rarely: cached for an hour, as Sam's answers can take a while.
  return [
    { type: "text", text: `${skill.trim()}\n\n${setting(who)}` },
    { type: "text", text: context, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
}

function messages(turns: Turn[], images: Image[]): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t, i) => {
    // Screenshots ride on the latest message from Sam's side.
    const last = i === turns.length - 1 && t.role === "user";
    if (!last || !images.length) return { role: t.role, content: t.text };
    return {
      role: t.role,
      content: [
        ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } })),
        { type: "text" as const, text: t.text },
      ],
    };
  });
}

function check(res: Anthropic.Beta.BetaMessage): void {
  if (res.stop_reason === "refusal") throw new Error("Claude declined this turn (refusal)");
  if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens)");
  console.log("GRILL CLAUDE", JSON.stringify({ in: res.usage.input_tokens, cache_read: res.usage.cache_read_input_tokens, out: res.usage.output_tokens }));
}

/** One round of the grilling: Claude looks things up as it needs, then writes the round or says it's done. */
export async function grillRound(input: { skill: string; context: string; who: Interviewee; turns: Turn[]; images: Image[] }, started = Date.now()): Promise<RoundResult> {
  const msgs = messages(input.turns, input.images);
  for (let step = 0; ; step++) {
    const outOfTime = step >= MAX_TOOL_STEPS || Date.now() - started > LOOK_BUDGET_MS;
    const res = await api().beta.messages.create({
      model: GRILL_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: system(input.skill, input.context, input.who),
      tools: TOOLS,
      // Out of time: no more lookups; Claude writes the round with what it has found.
      tool_choice: outOfTime ? { type: "none" } : { type: "auto" },
      messages: msgs,
    });
    check(res);
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const done = uses.find((u) => u.name === "check_understanding" || u.name === "write_spec");
    if (done?.name === "write_spec") return { kind: "write_spec" };
    if (done) {
      const i = z.object({ title: z.string().min(1), understanding: z.string().min(1) }).parse(done.input);
      return { kind: "check", ...i };
    }
    if (!uses.length) {
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
      if (!text) throw new Error("Claude wrote an empty round");
      return { kind: "round", text };
    }
    msgs.push({ role: "assistant", content: res.content });
    const results = await Promise.all(uses.map(async (u) => ({ type: "tool_result" as const, tool_use_id: u.id, content: await runTool(u.name, u.input as Record<string, string>) })));
    msgs.push({ role: "user", content: results });
  }
}

export const SpecSchema = z.object({ title: z.string().min(1), apps: z.string(), started_as: z.string(), ended_as: z.string(), markdown: z.string().min(200) });
export type Spec = z.infer<typeof SpecSchema>;

const SPEC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "apps", "started_as", "ended_as", "markdown"],
  properties: {
    title: { type: "string", description: "Short name of the idea as agreed" },
    apps: { type: "string", description: "Which app(s), by the names the team uses" },
    started_as: { type: "string", description: "One line: what the person first asked for" },
    ended_as: { type: "string", description: "One line: what was agreed" },
    markdown: { type: "string", description: "The whole spec, in the sections asked for" },
  },
};

/** The spec for Jamie, from the whole thread. */
export async function writeSpec(input: { skill: string; context: string; who: Interviewee; turns: Turn[]; date: string; link: string }): Promise<Spec> {
  const turns: Turn[] = [...input.turns];
  const ask = `${specInstructions(input.who)}\n\nDate: ${input.date}. Slack thread: ${input.link}`;
  if (turns[turns.length - 1].role === "user") turns[turns.length - 1] = { role: "user", text: `${turns[turns.length - 1].text}\n\n${ask}` };
  else turns.push({ role: "user", text: ask });
  const res = await api().beta.messages.create({
    model: GRILL_MODEL,
    max_tokens: 20000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: SPEC_JSON_SCHEMA } },
    system: system(input.skill, input.context, input.who),
    messages: messages(turns, []),
  });
  check(res);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`The spec wasn't JSON: ${text.slice(0, 200)}`);
  }
  return SpecSchema.parse(json);
}
