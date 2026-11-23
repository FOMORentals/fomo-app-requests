/** Slack layouts for website listings: search results, the listing card in #website-listings, the edit form. Pure, tested. */
import type { Config } from "@fomo/rentman-core/config";
import { publicName } from "@fomo/rentman-core/classify";
import type { Block } from "../blocks";
import { GO_LIVE_PER_DAY, rentmanLink } from "./config";
import { changes, glanceFields, specFields, type Draft, type Listing, type Problem } from "./draft";
import type { Match } from "./rentman";

const MAX = 2900;
const cut = (s: string, n = MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const section = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text: cut(text) } });
const context = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text: cut(text) }] });
const button = (text: string, action_id: string, value: string, style?: "primary" | "danger", confirm?: { title: string; text: string; ok: string }): Record<string, unknown> => ({
  type: "button",
  text: { type: "plain_text", text },
  action_id,
  value,
  ...(style ? { style } : {}),
  ...(confirm ? { confirm: { title: { type: "plain_text", text: confirm.title }, text: { type: "mrkdwn", text: confirm.text }, confirm: { type: "plain_text", text: confirm.ok }, deny: { type: "plain_text", text: "Cancel" } } } : {}),
});

/** What `/list-kit` shows: the matches to pick from, and the recent ones button. */
export function searchBlocks(matches: Match[], asked: string, recent = false): Block[] {
  const head = recent
    ? matches.length ? "Added to Rentman in the last 14 days and not on the website yet:" : "Nothing new in Rentman in the last 14 days that isn't on the website already."
    : matches.length ? `Which one? (searched for "${esc(asked)}")` : `Nothing in Rentman matches "${esc(asked)}". Try the Rentman code, or part of the name.`;
  const out: Block[] = [section(head)];
  for (const m of matches) {
    out.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${esc(m.name)}*  ·  code ${esc(m.code || "-")}${m.inShop ? "  ·  _already on the website: opens it for editing_" : ""}` },
      accessory: button(m.inShop ? "Edit listing" : "List this", "lk_pick", String(m.id), "primary"),
    });
  }
  if (!recent) out.push({ type: "actions", elements: [button("Show me recent ones", "lk_recent", "recent")] });
  return out;
}

function stageLine(l: Listing): string {
  const who = `<@${l.owner}>`;
  switch (l.stage) {
    case "drafting": return `⏳ Drafting for ${who}… the AI is writing the descriptions and looking up the specs (about a minute).`;
    case "draft": return `✏️ Draft started by ${who}. Anyone can *Edit*; Jamie, Sam or Will press *Publish*.`;
    case "publishing": return "⏳ Publishing…";
    case "published": return `✅ Published by ${l.publishedBy}. It goes live at the next website update (05:41 every morning), or press *Go live now*.`;
    case "live": return "🌐 Live on the website.";
    case "removed": return "Taken off the website. Type `/list-kit` again to put it back.";
    case "discarded": return "Draft discarded. Type `/list-kit` again to start over.";
  }
}

function fieldLines(d: Draft, l: Listing, config: Config): string[] {
  const out = [
    `*Name on website:* ${esc(d.webName || publicName(l.name))}${d.webName ? "" : " _(the Rentman name)_"}`,
    `*New badge:* ${d.isNew ? "On" : "Off"}`,
    `*Short description:* ${esc(d.short) || "_missing_"}`,
  ];
  const specs = specFields(config, l.category).map((f) => `${f.label.replace("Web: ", "")}: ${esc(d.specs[f.label] ?? "") || "_blank_"}`);
  if (specs.length) out.push(`*Specs:* ${specs.join("  ·  ")}`);
  const glance = glanceFields(l.category).filter((g) => (d.glance[g.key] ?? "").trim()).map((g) => `${esc(d.glanceLabels[g.key] || g.label)}: ${esc(d.glance[g.key])}`);
  out.push(`*At a glance:* ${glance.length ? glance.join("  ·  ") : "_none_"}`);
  return out;
}

/** The listing's card in #website-listings: every field, what's missing, and the buttons for this stage. */
export function cardBlocks(l: Listing, config: Config, issues: Problem[], goLiveLeft = GO_LIVE_PER_DAY): Block[] {
  const d = l.draft;
  const v = String(l.rentmanId);
  const out: Block[] = [
    { type: "header", text: { type: "plain_text", text: cut(`Website listing: ${l.name}`, 150) } },
    context(`<${rentmanLink(l.rentmanId)}|Rentman ${esc(l.code || String(l.rentmanId))}>  ·  ${l.category ? `category ${l.category}` : "no website category"}  ·  ${stageLine(l)}`),
  ];
  if (l.stage === "drafting" || l.stage === "discarded") return out;
  out.push(section(fieldLines(d, l, config).join("\n")));
  out.push(section(`*Long description:*\n${esc(d.long) || "_missing_"}`));
  if (d.techSpec.trim()) out.push(section(`*Tech spec tables:*\n\`\`\`${cut(d.techSpec, MAX - 40)}\`\`\``));
  if (d.specSource) out.push(context(`Specs from ${d.specSource}`));
  const ch = changes(l.previous, d, l.category, config);
  if (ch.length) out.push(section(`*Changes from what the website shows now:*\n${ch.map((c) => `• ${c.label}: ~${esc(cut(c.before, 200))}~ → ${esc(cut(c.after, 200))}`).join("\n")}`));
  if (issues.length && ["draft", "published", "live"].includes(l.stage)) {
    const lines = issues.map((p) => `• ${p.where === "rentman" ? "*In Rentman:* " : "*In this draft:* "}${p.what}`);
    out.push(section(`*Before this can go live:*\n${lines.join("\n")}`));
  }
  if (l.aiNote) out.push(context(`AI note: ${esc(l.aiNote)}`));
  if (l.note) out.push(context(esc(l.note)));

  const actions: Record<string, unknown>[] = [];
  if (l.stage === "draft") {
    actions.push(button("Edit", "lk_edit", v), button("Check again", "lk_check", v));
    actions.push(button("Publish", "lk_publish", v, "primary", { title: "Publish to website?", text: "This saves these fields on the item in Rentman, ticks *visible in webshop* and saves its tech spec page. It shows on the website after the next update.", ok: "Publish" }));
    actions.push(button("Discard", "lk_discard", v));
  } else if (l.stage === "published") {
    actions.push(button("Go live now", "lk_golive", v, "primary", { title: "Update the website now?", text: `This runs the website update straight away instead of waiting for 05:41. It uses Rentman's shared limit, so it can be used ${goLiveLeft} times a day.`, ok: "Go live now" }));
    actions.push(button("Edit", "lk_edit", v), button("Take off website", "lk_remove", v, "danger", { title: "Take it off the website?", text: "This unticks *visible in webshop* in Rentman. It disappears at the next website update.", ok: "Take it off" }));
  } else if (l.stage === "live") {
    actions.push(button("Edit", "lk_edit", v), button("Take off website", "lk_remove", v, "danger", { title: "Take it off the website?", text: "This unticks *visible in webshop* in Rentman. It disappears at the next website update.", ok: "Take it off" }));
  }
  if (actions.length) out.push({ type: "actions", elements: actions });
  return out;
}

const input = (block_id: string, label: string, initial: string, o: { multiline?: boolean; max?: number; optional?: boolean; hint?: string } = {}): Block => ({
  type: "input",
  block_id,
  optional: o.optional ?? true,
  label: { type: "plain_text", text: cut(label, 150) },
  ...(o.hint ? { hint: { type: "plain_text", text: cut(o.hint, 150) } } : {}),
  element: {
    type: "plain_text_input",
    action_id: "v",
    multiline: !!o.multiline,
    ...(initial ? { initial_value: cut(initial, o.max ?? 3000) } : {}),
    ...(o.max ? { max_length: o.max } : {}),
  },
});

/** The edit form. `private_metadata` carries the Rentman id. */
export function editModal(l: Listing, config: Config): Block {
  const d = l.draft;
  const blocks: Block[] = [
    input("webName", "Name on website", d.webName, { hint: `Leave empty to use the Rentman name: ${publicName(l.name)}`, max: 150 }),
    input("short", "Short description", d.short, { optional: false, max: 150 }),
    input("long", "Long description", d.long, { multiline: true, optional: false, max: 3000, hint: d.long.length > 3000 ? `Slack boxes hold 3,000 characters, so this is cut short: saving keeps the shorter version.` : "A blank line between paragraphs; **bold** allowed" }),
    {
      type: "input",
      block_id: "isNew",
      optional: true,
      label: { type: "plain_text", text: "Badge" },
      element: {
        type: "checkboxes",
        action_id: "v",
        options: [{ text: { type: "plain_text", text: "Show as New" }, value: "new" }],
        ...(d.isNew ? { initial_options: [{ text: { type: "plain_text", text: "Show as New" }, value: "new" }] } : {}),
      },
    },
  ];
  for (const f of specFields(config, l.category)) {
    const cur = d.specs[f.label] ?? "";
    if (f.pick) {
      const options = [{ text: { type: "plain_text", text: "(blank)" }, value: "-" }, ...f.values.map((x) => ({ text: { type: "plain_text", text: x }, value: x }))];
      const initial = options.find((o) => o.value === cur);
      blocks.push({ type: "input", block_id: `spec:${f.label}`, optional: true, label: { type: "plain_text", text: f.label.replace("Web: ", "") }, element: { type: "static_select", action_id: "v", options, ...(initial ? { initial_option: initial } : {}) } });
    } else {
      blocks.push(input(`spec:${f.label}`, f.label.replace("Web: ", ""), cur, { hint: f.example ? `e.g. ${f.example}` : undefined, max: 200 }));
    }
  }
  for (const g of glanceFields(l.category)) blocks.push(input(`glance:${g.key}`, `At a glance: ${d.glanceLabels[g.key] || g.label}`, d.glance[g.key] ?? "", { max: 200 }));
  blocks.push(input("techSpec", "Tech spec tables", d.techSpec, { multiline: true, max: 3000, hint: d.techSpec.length > 3000 ? "Slack boxes hold 3,000 characters, so this is cut short: saving keeps the shorter version." : "'### Section' headings, each followed by a two-column table" }));
  blocks.push(input("specSource", "Where the specs came from (a link)", d.specSource, { max: 500 }));
  return {
    type: "modal",
    callback_id: "lk_save",
    private_metadata: String(l.rentmanId),
    title: { type: "plain_text", text: "Website listing" },
    submit: { type: "plain_text", text: "Save draft" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

type Values = Record<string, Record<string, { value?: string | null; selected_option?: { value: string } | null; selected_options?: { value: string }[] }>>;

/** The edit form's answers as a draft (fields not on the form keep their value). */
export function readEditModal(values: Values, before: Draft, l: Pick<Listing, "category">, config: Config): Draft {
  const text = (id: string) => (values[id]?.v?.value ?? "").trim();
  const d: Draft = { ...before, specs: { ...before.specs }, glance: { ...before.glance } };
  d.webName = text("webName");
  d.short = text("short");
  d.long = text("long");
  d.isNew = (values.isNew?.v?.selected_options ?? []).some((o) => o.value === "new");
  for (const f of specFields(config, l.category)) {
    const raw = f.pick ? values[`spec:${f.label}`]?.v?.selected_option?.value ?? "" : text(`spec:${f.label}`);
    const val = raw === "-" ? "" : raw.trim();
    if (val) d.specs[f.label] = val;
    else delete d.specs[f.label];
  }
  for (const g of glanceFields(l.category)) {
    const val = text(`glance:${g.key}`);
    if (val) d.glance[g.key] = val;
    else delete d.glance[g.key];
  }
  d.techSpec = text("techSpec");
  d.specSource = text("specSource");
  return d;
}
