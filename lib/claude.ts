/** The one Claude call per turn: check, grill and sort a request. Throws on any failure (rule 1). */
import Anthropic from "@anthropic-ai/sdk";
import { ASSESSMENT_JSON_SCHEMA, AssessmentSchema, MODEL, RULES, type Assessment } from "./prompt";

let client: Anthropic | null = null;

function api(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic();
  return client;
}

export type Image = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };

export async function assess(input: { notes: string; thread: string; turn: string; images: Image[] }): Promise<Assessment> {
  const res = await api().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: ASSESSMENT_JSON_SCHEMA } },
    system: [
      { type: "text", text: RULES },
      // Design notes change rarely; cached so a back-and-forth on one request reads them once.
      { type: "text", text: input.notes, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          ...input.images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.data } })),
          { type: "text", text: `THE SLACK THREAD:\n\n${input.thread}\n\n${input.turn}` },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined to read this request (refusal)");
  if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens)");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Claude's answer wasn't JSON: ${text.slice(0, 200)}`);
  }
  const parsed = AssessmentSchema.safeParse(json);
  if (!parsed.success) throw new Error(`Claude's answer had the wrong shape: ${parsed.error.message.slice(0, 300)}`);
  console.log("CLAUDE", JSON.stringify({ in: res.usage.input_tokens, cache_read: res.usage.cache_read_input_tokens, out: res.usage.output_tokens }));
  return parsed.data;
}
