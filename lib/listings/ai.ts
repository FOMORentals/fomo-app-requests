/**
 * The AI's first draft of a listing (Jamie, 23 Nov 2026): web name, short and long description in FOMO's style,
 * the camera/lens spec fields, the At a glance rows and the tech spec tables. A person checks and can change all of
 * it; the AI never sets prices. Two calls per listing, both Haiku (as kit onboarding: Jamie, 6 Oct 2026):
 *   1. descriptions, copying ~10 live FOMO descriptions, no web search;
 *   2. specs from the manufacturer's own website (1 search + 1 page read), never another site, checked in code too.
 * Either can fail on its own; the draft then says so and the person fills that part in.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LISTING_MODEL } from "./config";
import type { Draft, SpecField } from "./draft";
import type { StyleRow } from "./rentman";

let client: Anthropic | null = null;
function api(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic();
  return client;
}

export type Ask = { rentmanName: string; brand: string; model: string; categoryName: string; kind: string; contents: string };

const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const COPY_SCHEMA = obj({
  webName: { type: "string", description: "only if the Rentman name would read badly on the website; otherwise empty" },
  short: { type: "string", description: "one line, under 90 characters, like the examples' short descriptions" },
  long: { type: "string", description: "plain text paragraphs separated by a blank line; **bold** allowed; like the examples" },
  note: { type: "string", description: "short; anything a person should check" },
});
const Copy = z.object({ webName: z.string(), short: z.string(), long: z.string(), note: z.string() });

const texts = (m: Anthropic.Beta.BetaMessage) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : []));

function stopCheck(m: Anthropic.Beta.BetaMessage) {
  if (m.stop_reason === "refusal") throw new Error("the AI declined this item");
  if (m.stop_reason === "max_tokens") throw new Error("the AI's answer was cut off");
}

/** The last JSON object in the reply (web tool turns can put text before it). */
export function lastJson(all: string[]): unknown {
  const s = all.join("\n");
  for (let end = s.lastIndexOf("}"); end > 0; end = s.lastIndexOf("}", end - 1)) {
    for (let start = s.lastIndexOf("{", end); start >= 0; start = s.lastIndexOf("{", start - 1)) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* keep looking */
      }
    }
  }
  throw new Error("no JSON answer in the AI's reply");
}

export async function writeCopy(a: Ask, examples: StyleRow[]): Promise<{ webName: string; short: string; long: string; note: string }> {
  const prompt = `You write the website copy for FOMO Rentals, a London camera and lighting rental house. Write a short and a long description for the new item below in exactly the style, length and tone of FOMO's existing ones (examples first). Facts only: no prices, no "available now", nothing you can't support from the name and contents. A kit's long description says what it is for and what's in it.

EXAMPLES:
${examples.map((e) => `## ${e.name}\nshort: ${e.short}\nlong:\n${e.long}`).join("\n\n")}

NEW ITEM:
Rentman name: ${a.rentmanName} | brand: ${a.brand || "-"} | model: ${a.model || "-"} | category: ${a.categoryName} | type: ${a.kind}${a.contents ? `\nContents: ${a.contents}` : ""}`;
  const m = await api().beta.messages.stream({
    model: LISTING_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: COPY_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  }).finalMessage();
  stopCheck(m);
  return Copy.parse(JSON.parse(texts(m).join("")));
}

/** A manufacturer's own site (its name appears in the host), e.g. sony.co.uk for Sony. */
export function allowedSource(url: string, manufacturer: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  const flat = host.replace(/[^a-z0-9]/g, "");
  const maker = manufacturer.toLowerCase().replace(/[^a-z0-9]/g, "");
  const first = manufacturer.toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 4);
  return (maker.length >= 3 && flat.includes(maker)) || (!!first && flat.includes(first));
}

const Research = z.object({
  specs: z.array(z.object({ field: z.string(), value: z.string() })),
  glance: z.array(z.object({ key: z.string(), value: z.string() })),
  techSpec: z.string(),
  source: z.string(),
  note: z.string(),
});

/** Drops whole "### " sections from the end until the tables fit a Slack text box (3,000 characters). */
export function fitSections(md: string, max: number): string {
  let parts = md.trim().split(/(?=^### )/m);
  while (parts.length > 1 && parts.join("").trim().length > max) parts = parts.slice(0, -1);
  const out = parts.join("").trim();
  return out.length > max ? "" : out;
}

/** Keeps only fields asked for, and for pick fields only an allowed value. */
export function cleanSpecs(raw: { field: string; value: string }[], fields: SpecField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = raw.find((x) => x.field === f.label)?.value.trim() ?? "";
    if (!v) continue;
    if (f.pick && !f.values.includes(v)) continue;
    out[f.label] = v;
  }
  return out;
}

export async function researchSpecs(a: Ask, fields: SpecField[], glance: { key: string; label: string }[]): Promise<Partial<Draft> & { note: string }> {
  const prompt = `For a camera rental house's website, find this product's specifications:
${a.brand} ${a.model} (${a.rentmanName}${a.contents ? `; a kit containing: ${a.contents}` : ""})
Use the manufacturer's own website (product page or datasheet) only. Never use any other website.
${fields.length ? `Spec fields:\n${fields.map((f) => `- ${f.label}${f.pick ? `: exactly one of ${f.values.join(", ")}` : f.values.length ? ` (use these words where they fit: ${f.values.join(", ")}; comma-separated)` : ""}${f.example ? `, e.g. "${f.example}"` : ""}`).join("\n")}\n` : ""}At a glance rows (short values; leave out any the source doesn't give):
${glance.map((g) => `- ${g.key} (${g.label})`).join("\n")}
Tech spec: the datasheet's main specifications as Markdown, a few '### Section' headings each followed by a two-column table ('| | |' then '| --- | --- |'), no prose, under 2,500 characters in total. Leave anything the source doesn't say empty rather than guessing.
Answer with one JSON object: {"specs":[{"field","value"}],"glance":[{"key","value"}],"techSpec":"...","source":"the URL the specs came from","note":"anything a person should check"}.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < 4; turn++) {
    const m = await api().beta.messages.stream({
      model: LISTING_MODEL,
      max_tokens: 8000,
      betas: ["web-fetch-2025-09-10"],
      output_config: { effort: "low" },
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 1 },
        { type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, max_content_tokens: 12000 },
      ],
      messages,
    }).finalMessage();
    if (m.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: m.content });
      continue;
    }
    stopCheck(m);
    const r = Research.parse(lastJson(texts(m)));
    if (!r.source || !allowedSource(r.source, a.brand)) throw new Error(`specs only found on ${r.source || "no website"}, not the manufacturer's own site; not used`);
    const known = new Set(glance.map((g) => g.key));
    return {
      specs: cleanSpecs(r.specs, fields),
      glance: Object.fromEntries(r.glance.filter((g) => known.has(g.key) && g.value.trim()).map((g) => [g.key, g.value.trim()])),
      techSpec: fitSections(r.techSpec, 2900),
      specSource: r.source,
      note: r.note,
    };
  }
  throw new Error("the spec lookup didn't finish");
}
