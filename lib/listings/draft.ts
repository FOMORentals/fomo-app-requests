/**
 * Website listings, the pure part: what a listing holds, what Rentman holds now, what is still missing before it can
 * go on the website, and the one Rentman update that publishes it. No calls here; tested in draft.test.ts.
 *
 * What the website shows (fomo-rentals-website-rebuild sync, via @fomo/rentman-core): an item appears when it is
 * "visible in webshop" (in_shop), available in the planner, priced above £0 and filed in a folder under a website
 * category. Its page uses Web: Name (custom_50, else the Rentman name), the two shop descriptions, the image, the
 * camera/lens spec fields (custom_41-48, Cameras and Lenses only), Web: New (custom_49), and the At a glance / tech
 * spec file in the website repo (content/tech-specs/), pinned to the item's Rentman id.
 */
import { displayFieldsFor, type Config } from "@fomo/rentman-core/config";
import { makeFolderResolver, publicName } from "@fomo/rentman-core/classify";
import type { FolderRow } from "@fomo/rentman-core/rentman-types";
import { GLANCE_FIELDS, checkTechSpec, renderTechSpec, specCategory, techSpecFileName } from "@fomo/rentman-core/tech-spec";
import type { Equip } from "./rentman";

export type Draft = {
  webName: string; // "" = use the Rentman name
  short: string;
  long: string;
  isNew: boolean;
  specs: Record<string, string>; // by field label, e.g. "Web: Mount"
  glance: Record<string, string>; // by glance_ key
  glanceLabels: Record<string, string>; // At a glance rows given their own name
  techSpec: string; // Markdown tables
  specSource: string; // where the specs came from
};

export const emptyDraft = (): Draft => ({ webName: "", short: "", long: "", isNew: true, specs: {}, glance: {}, glanceLabels: {}, techSpec: "", specSource: "" });

export type Stage = "drafting" | "draft" | "publishing" | "published" | "live" | "removed" | "discarded";

export type Listing = {
  rentmanId: number;
  code: string;
  name: string; // the Rentman name
  category: string | null; // website category slug, null = its folder isn't under one
  owner: string; // Slack user id of whoever started it
  ownerEmail: string;
  stage: Stage;
  draft: Draft;
  previous: Draft | null; // what the website showed when the draft started (a live listing being edited)
  aiNote: string; // what the AI says to check, or why it couldn't help
  channel: string;
  cardTs: string;
  specFile: string; // this item's own tech spec file (no .md), once known
  sharedSpec: string; // a Brand + Model tech spec file the website already uses for it, if any
  createdAt: number;
  updatedAt: number;
  remindedAt: number;
  publishedAt: number;
  publishedBy: string;
  liveAt: number;
  liveChecked: boolean; // told the owner it didn't appear (once)
  goLiveAt: number; // an approver pressed Go live now (ms)
  issues: Problem[]; // what stops Publish, as last checked against Rentman
  note: string; // last outcome in plain English (e.g. why Publish stopped)
};

export const folderIdOf = (e: Pick<Equip, "folder">): string | null => String(e.folder ?? "").split("/").pop() || null;

/** The website category the item's folder maps to, or null. */
export function categoryOf(e: Pick<Equip, "folder">, folders: FolderRow[], config: Config): string | null {
  const id = folderIdOf(e);
  if (!id) return null;
  return makeFolderResolver(folders, config, { folderCycles: [] })(id)?.category ?? null;
}

export type SpecField = { label: string; key: string; pick: boolean; values: string[]; example: string };

/** The spec fields the website shows for a category (Cameras and Lenses only; Brand is Rentman's own field). */
export function specFields(config: Config, category: string | null): SpecField[] {
  if (!category) return [];
  return displayFieldsFor(config, category)
    .filter((l) => l !== "Brand" && l !== "Web: New" && config.fields[l])
    .map((label) => {
      const f = config.fields[label];
      return { label, key: f.rentmanKey, pick: f.kind === "pick", values: f.values ?? [], example: f.example ?? "" };
    });
}

export function glanceFields(category: string | null) {
  return GLANCE_FIELDS[specCategory(category)];
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/**
 * Rentman's long descriptions are HTML ("<p>…</p>", seen on live items 23 Nov 2026). People edit plain paragraphs in
 * Slack (a blank line between, **bold** allowed), so the draft holds text and Publish writes the same HTML shape back.
 */
export function htmlToText(html: string): string {
  if (!/<[a-z]/i.test(html)) return html.trim();
  return html
    .replace(/<\/?(strong|b)>/gi, "**")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function textToHtml(text: string): string {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${esc(para).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Pick-list fields are stored in Rentman as a choice id; the website config maps ids to labels. */
export function pickLabel(config: Config, label: string, raw: unknown): string {
  const ids = config.fields[label]?.enumIds ?? {};
  const v = str(raw);
  return ids[v] ?? (Object.values(ids).includes(v) ? v : "");
}

export function pickId(config: Config, label: string, value: string): string | null {
  const ids = config.fields[label]?.enumIds ?? {};
  const hit = Object.entries(ids).find(([, l]) => l !== "" && l === value.trim());
  return hit ? hit[0] : null;
}

/** What the website shows today for this item (or would, once ticked): the starting point of an edit. */
export function draftFromRentman(e: Equip, config: Config, category: string | null): Draft {
  const custom = e.custom ?? {};
  const specs: Record<string, string> = {};
  for (const f of specFields(config, category)) {
    const v = f.pick ? pickLabel(config, f.label, custom[f.key]) : str(custom[f.key]);
    if (v) specs[f.label] = v;
  }
  const webName = str(custom.custom_50);
  return {
    ...emptyDraft(),
    webName: webName && webName !== publicName(e.name) ? webName : "",
    short: str(e.shop_description_short),
    long: htmlToText(str(e.shop_description_long)),
    isNew: e.in_shop ? custom.custom_49 === true || custom.custom_49 === 1 || custom.custom_49 === "1" : true, // new purchases are New (Jamie, 23 Nov 2026)
    specs,
  };
}

/** Fills only what is still empty (a person's or Rentman's value always wins over the AI's). */
export function fillBlanks(base: Draft, ai: Partial<Draft>): Draft {
  const out: Draft = { ...base, specs: { ...base.specs }, glance: { ...base.glance }, glanceLabels: { ...base.glanceLabels } };
  if (!out.webName && ai.webName) out.webName = ai.webName;
  if (!out.short && ai.short) out.short = ai.short;
  if (!out.long && ai.long) out.long = ai.long;
  for (const [k, v] of Object.entries(ai.specs ?? {})) if (!out.specs[k] && v) out.specs[k] = v;
  for (const [k, v] of Object.entries(ai.glance ?? {})) if (!out.glance[k] && v) out.glance[k] = v;
  if (!out.techSpec && ai.techSpec) out.techSpec = ai.techSpec;
  if (!out.specSource && ai.specSource) out.specSource = ai.specSource;
  return out;
}

/** Reads an existing tech spec file back into draft fields (editing a live listing). */
export function parseTechSpec(text: string): Pick<Draft, "glance" | "glanceLabels" | "techSpec" | "specSource"> {
  const lines = text.split(/\r?\n/);
  const out = { glance: {} as Record<string, string>, glanceLabels: {} as Record<string, string>, techSpec: "", specSource: "" };
  if (lines[0]?.trim() !== "---") return { ...out, techSpec: text.trim() };
  const end = lines.indexOf("---", 1);
  if (end < 0) return out;
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(l);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "source") out.specSource = v.trim();
    else if (k.startsWith("glance_") && k.endsWith("_label")) out.glanceLabels[k.slice(0, -6)] = v.trim();
    else if (k.startsWith("glance_")) out.glance[k] = v.trim();
  }
  out.techSpec = lines.slice(end + 1).join("\n").trim();
  return out;
}

export type Problem = { what: string; where: "rentman" | "draft" };

/** Everything that stops Publish, in plain English, each saying where to fix it. Empty = ready. */
export function problems(e: Equip | null, d: Draft, category: string | null, config: Config): Problem[] {
  if (!e) return [{ what: "This item no longer exists in Rentman.", where: "rentman" }];
  const out: Problem[] = [];
  const rentman = (what: string) => out.push({ what, where: "rentman" });
  const draft = (what: string) => out.push({ what, where: "draft" });
  if (e.in_archive) rentman("It's archived in Rentman.");
  if (!e.image) rentman("It has no photo. Upload one on the item in Rentman, then press Check again.");
  if (!(Number(e.price) > 0)) rentman("Its day rate is £0. Set the rental price in Rentman.");
  if (e.in_planner === false) rentman("It isn't available in the planner. Switch that on in Rentman.");
  if (!category) rentman("Its folder isn't under one of the website's categories (Cameras, Lenses, Lighting, Grip, Accessories, Audio). Move it in Rentman.");
  if (!d.short.trim()) draft("It needs a short description.");
  if (!d.long.trim()) draft("It needs a long description.");
  if (d.short.length > 150) draft("The short description is too long (150 characters at most).");
  for (const f of specFields(config, category)) {
    const v = (d.specs[f.label] ?? "").trim();
    if (v && f.pick && pickId(config, f.label, v) === null) draft(`"${v}" isn't one of the ${f.label.replace("Web: ", "")} choices (${f.values.join(", ")}).`);
  }
  return out;
}

const same = (a: unknown, b: unknown) => (typeof a === "boolean" || typeof b === "boolean" ? Boolean(a) === Boolean(b) : str(a) === str(b));

/**
 * The one Rentman update that publishes the listing: only fields that differ (rule 3), `custom` sent whole (what
 * Rentman has plus the changes) so no other custom value is wiped, and in_shop ticked in the same update.
 * Empty = Rentman already matches.
 */
export function publishBody(e: Equip, d: Draft, category: string | null, config: Config): Record<string, unknown> {
  const want: Record<string, unknown> = { custom_50: d.webName.trim() || publicName(e.name), custom_49: d.isNew };
  for (const f of specFields(config, category)) {
    const v = (d.specs[f.label] ?? "").trim();
    want[f.key] = !v ? "" : f.pick ? pickId(config, f.label, v) : v;
  }
  const cur = e.custom ?? {};
  // A blank in the draft only clears a field the website would otherwise show wrongly; never write "" over nothing.
  const changed = Object.keys(want).filter((k) => !same(cur[k], want[k]) && !(want[k] === "" && str(cur[k]) === ""));
  const body: Record<string, unknown> = {};
  if (changed.length) body.custom = { ...cur, ...Object.fromEntries(changed.map((k) => [k, want[k]])) };
  if (!same(e.shop_description_short, d.short.trim())) body.shop_description_short = d.short.trim();
  if (htmlToText(str(e.shop_description_long)) !== d.long.trim()) body.shop_description_long = textToHtml(d.long);
  if (!e.in_shop) body.in_shop = true;
  return body;
}

/** After an update: every field sent reads back the same (rule 5). Empty = all saved. */
export function verifyUpdate(body: Record<string, unknown>, after: Equip | null): string[] {
  if (!after) return ["the item is gone on re-read"];
  const bad: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (k === "custom") {
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) if (!same(after.custom?.[ck], cv)) bad.push(`${ck} didn't save`);
    } else if (k === "shop_description_long") {
      if (htmlToText(str(after.shop_description_long)) !== htmlToText(str(v))) bad.push(`${k} didn't save`); // Rentman may tidy the HTML
    } else if (!same((after as unknown as Record<string, unknown>)[k], v)) bad.push(`${k} didn't save`);
  }
  return bad;
}

/** The tech spec file for the website, or null when the draft has no At a glance rows and no tables. */
export function techSpecFile(e: Equip, d: Draft, category: string | null, fileName: string): { name: string; text: string; problems: string[] } | null {
  const glance = Object.fromEntries(Object.entries(d.glance).filter(([, v]) => v.trim()));
  if (!d.techSpec.trim() && !Object.keys(glance).length) return null;
  const text = renderTechSpec({
    title: d.webName.trim() || publicName(e.name),
    category: specCategory(category),
    source: d.specSource,
    rentmanIds: [e.id],
    glance,
    labels: d.glanceLabels,
    body: d.techSpec,
  });
  return { name: fileName, text, problems: checkTechSpec(`${fileName}.md`, text) };
}

/** A new file's name: the item's web name, or that plus its id when another item already has the name. */
export function newSpecFileName(e: Equip, d: Draft, taken: Set<string>): string {
  const base = techSpecFileName(d.webName.trim() || e.name);
  return taken.has(base) ? `${base}-${e.id}`.slice(0, 64) : base;
}

export type Change = { label: string; before: string; after: string };

/** Old next to new, for an approver checking an edit to a live listing. */
export function changes(before: Draft | null, after: Draft, category: string | null, config: Config): Change[] {
  if (!before) return [];
  const out: Change[] = [];
  const add = (label: string, a: string, b: string) => { if (a.trim() !== b.trim()) out.push({ label, before: a.trim() || "(blank)", after: b.trim() || "(blank)" }); };
  add("Name on website", before.webName, after.webName);
  add("Short description", before.short, after.short);
  add("Long description", before.long, after.long);
  add("New badge", before.isNew ? "On" : "Off", after.isNew ? "On" : "Off");
  for (const f of specFields(config, category)) add(f.label.replace("Web: ", ""), before.specs[f.label] ?? "", after.specs[f.label] ?? "");
  for (const g of glanceFields(category)) add(`At a glance: ${after.glanceLabels[g.key] || g.label}`, before.glance[g.key] ?? "", after.glance[g.key] ?? "");
  add("Tech spec tables", before.techSpec, after.techSpec);
  return out;
}

/**
 * True once the website should be showing a published listing: the 05:41 update has run since it was published (checked
 * from 08:00 London, which leaves the update time to finish), or 40 minutes after Go live now.
 */
export function shouldBeLive(l: Pick<Listing, "publishedAt" | "goLiveAt">, now: number, day: (ms: number) => string, hour: (ms: number) => number, liveByHour: number): boolean {
  if (l.goLiveAt && l.goLiveAt >= l.publishedAt && now - l.goLiveAt > 40 * 60_000) return true;
  if (hour(now) < liveByHour) return false;
  const pubDay = day(l.publishedAt);
  return day(now) > pubDay || (day(now) === pubDay && hour(l.publishedAt) < 5);
}

/** True when a person has had the draft open and untouched long enough for one reminder. */
export function needsReminder(l: Listing, now: number, after: number): boolean {
  return l.stage === "draft" && !l.remindedAt && now - l.updatedAt >= after;
}
