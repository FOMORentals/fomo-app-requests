/**
 * Website listings in Slack (Jamie, 23 Nov 2026): `/list-kit` from any channel, the listing card and its buttons in
 * #website-listings, the edit form. Rentman calls: see the budget at the top of ./rentman.ts.
 */
import { randomUUID } from "node:crypto";
import { loadConfig, type Config } from "@fomo/rentman-core/config";
import { publicName } from "@fomo/rentman-core/classify";
import { isRentmanBusyError } from "@fomo/rentman-core/rentman-guard";
import { report } from "../report";
import { messageLink, slack, userEmail } from "../slack";
import { londonDate } from "../time";
import { PEOPLE } from "../config";
import { researchSpecs, writeCopy, type Ask } from "./ai";
import { cardBlocks, editModal, readEditModal, searchBlocks } from "./blocks";
import { GO_LIVE_PER_DAY, RECENT_DAYS, canDraft, canPublish, listingsChannel } from "./config";
import {
  categoryOf,
  draftFromRentman,
  fillBlanks,
  folderIdOf,
  glanceFields,
  newSpecFileName,
  parseTechSpec,
  problems,
  publishBody,
  specFields,
  techSpecFile,
  verifyUpdate,
  type Draft,
  type Listing,
  type Problem,
} from "./draft";
import { findEquipment, getEquipment, putEquipment, readFolders, readStyleExamples, recentEquipment, type Equip } from "./rentman";
import { claimStage, claimWriter, countGoLive, createListing, folders as cachedFolders, getListing, releaseWriter, saveListing, styleExamples } from "./store";
import { readSpecFile, pinnedIds, runWebsiteSync, specFileNames, writeSpecFile } from "./website";
import { techSpecFileName } from "@fomo/rentman-core/tech-spec";

let config: Config | null = null;
const cfg = () => (config ??= loadConfig());

const WRITER_LEASE_MS = 10 * 60_000;

type Result = { body?: object; after?: () => Promise<void> };

/** Says what went wrong in Slack, in plain English, and reports it (rule 1). */
async function tell(responseUrl: string | undefined, channel: string | undefined, user: string, err: unknown, context: string) {
  const busy = isRentmanBusyError(err);
  if (!busy) report(err, context);
  const text = busy
    ? "Rentman is asking every FOMO app to pause for a few minutes (the shared limit). Nothing was changed. Try again shortly."
    : `Sorry, that didn't work: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}. Jamie has been told.`;
  if (responseUrl) await fetch(responseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }) }).catch(() => undefined);
  else if (channel) await slack("chat.postEphemeral", { channel, user, text }).catch(() => undefined);
}

async function respond(url: string, body: object) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Slack response_url failed: HTTP ${res.status}`);
}

// ---------- /list-kit ----------

export async function handleCommand(p: Record<string, string>): Promise<Result> {
  const user = p.user_id;
  if (!canDraft(await userEmail(user))) return { body: { response_type: "ephemeral", text: "Only the FOMO team can list kit on the website. Please ask Jamie." } };
  const text = (p.text ?? "").trim();
  return {
    body: { response_type: "ephemeral", text: text ? `Looking in Rentman for "${text}"…` : "Looking for kit added to Rentman recently…" },
    after: async () => {
      try {
        const matches = text ? await findEquipment(text) : await recentEquipment(RECENT_DAYS);
        await respond(p.response_url, { response_type: "ephemeral", replace_original: true, text: "Pick an item", blocks: searchBlocks(matches, text, !text) });
      } catch (err) {
        await tell(p.response_url, undefined, user, err, "listings.command");
      }
    },
  };
}

// ---------- Cards ----------

async function render(l: Listing): Promise<void> {
  const left = GO_LIVE_PER_DAY; // shown as a hint; the real limit is counted when pressed
  await slack("chat.update", { channel: l.channel, ts: l.cardTs, text: `Website listing: ${l.name}`, blocks: cardBlocks(l, cfg(), l.issues, left) });
}

async function inThread(l: Listing, text: string): Promise<void> {
  await slack("chat.postMessage", { channel: l.channel, thread_ts: l.cardTs, text, unfurl_links: false });
}

const nameOfEmail = (email: string) => PEOPLE.find((x) => x.email === email)?.name ?? email;

/** Draft-side problems are worked out from the draft; Rentman-side ones come from the last Rentman read. */
function withDraftIssues(l: Listing): Problem[] {
  const fromRentman = l.issues.filter((x) => x.where === "rentman");
  const fake = { id: l.rentmanId, image: "x", price: 1, in_planner: true, in_archive: false } as unknown as Equip; // draft checks only
  return [...fromRentman, ...problems(fake, l.draft, l.category, cfg()).filter((x) => x.where === "draft")];
}

async function foldersFor(e: Equip) {
  let f = await cachedFolders(readFolders);
  const id = Number(folderIdOf(e));
  if (id && !f.some((x) => x.id === id)) f = await cachedFolders(readFolders, true); // a folder made since the last read
  return f;
}

/** The existing tech spec file for an item already on the website: this item's own (pinned), else the Brand + Model one. */
async function existingSpec(e: Equip, d: Draft): Promise<{ own: string; shared: string; text: string | null }> {
  const brand = String(e.custom?.custom_5 ?? "").trim();
  const model = String(e.custom?.custom_6 ?? "").trim();
  const names = [...new Set([techSpecFileName(d.webName || e.name), techSpecFileName(e.name), `${techSpecFileName(d.webName || e.name)}-${e.id}`, brand && model ? techSpecFileName(`${brand} ${model}`) : ""].filter(Boolean))];
  let shared: { name: string; text: string } | null = null;
  for (const n of names) {
    const text = await readSpecFile(n);
    if (!text) continue;
    const pins = pinnedIds(text);
    if (pins.includes(e.id)) return { own: n, shared: "", text };
    if (!pins.length) shared ??= { name: n, text }; // matched by Brand + Model: the website already uses it for this item
  }
  return { own: "", shared: shared?.name ?? "", text: shared?.text ?? null };
}

const sameSpec = (a: ReturnType<typeof parseTechSpec>, d: Draft) =>
  JSON.stringify([a.glance, a.glanceLabels, a.techSpec.trim(), a.specSource]) === JSON.stringify([Object.fromEntries(Object.entries(d.glance).filter(([, v]) => v.trim())), d.glanceLabels, d.techSpec.trim(), d.specSource]);

async function startListing(id: number, user: string, responseUrl: string): Promise<void> {
  const email = await userEmail(user);
  const existing = await getListing(id);
  if (existing && !["live", "removed", "discarded"].includes(existing.stage)) {
    await respond(responseUrl, { response_type: "ephemeral", replace_original: true, text: `There's already a listing open for ${existing.name}: ${await messageLink(existing.channel, existing.cardTs)}` });
    return;
  }
  const e = await getEquipment(id);
  if (!e) {
    await respond(responseUrl, { response_type: "ephemeral", replace_original: true, text: "That item isn't in Rentman any more." });
    return;
  }
  const category = categoryOf(e, await foldersFor(e), cfg());
  let base = draftFromRentman(e, cfg(), category);
  // The website may already have a tech spec page for it (its own, or one shared by Brand + Model): start from that.
  const spec = await existingSpec(e, base);
  if (spec.text) base = { ...base, ...parseTechSpec(spec.text) };
  const specFile = spec.own;
  const sharedSpec = spec.shared;
  const now = Date.now();
  const channel = listingsChannel();
  const listing: Listing = {
    rentmanId: e.id, code: String(e.code ?? ""), name: e.name, category, owner: user, ownerEmail: email, stage: "drafting",
    draft: base, previous: e.in_shop ? structuredClone(base) : null, aiNote: "", channel, cardTs: "", specFile, sharedSpec,
    createdAt: now, updatedAt: now, remindedAt: 0, publishedAt: 0, publishedBy: "", liveAt: 0, liveChecked: false, goLiveAt: 0, issues: [], note: "",
  };
  const posted = await slack<{ ts: string }>("chat.postMessage", { channel, text: `Website listing: ${e.name}`, blocks: cardBlocks(listing, cfg(), []) });
  listing.cardTs = posted.ts;
  const { created, listing: open } = await createListing(listing);
  if (!created) {
    await slack("chat.delete", { channel, ts: posted.ts }).catch(() => undefined);
    await respond(responseUrl, { response_type: "ephemeral", replace_original: true, text: `Someone just started this one: ${await messageLink(open.channel, open.cardTs)}` });
    return;
  }
  await respond(responseUrl, { response_type: "ephemeral", replace_original: true, text: `Started. The draft will be ready in about a minute here: ${await messageLink(channel, posted.ts)}` });

  try {
    await aiDraft(e, category, base, user);
  } catch (err) {
    // Never leave a card stuck on "Drafting…": it becomes a draft to fill in by hand, and the error is reported.
    report(err, "listings.draft", { id });
    const fresh = (await getListing(id))!;
    fresh.stage = "draft";
    fresh.issues = problems(e, fresh.draft, category, cfg());
    fresh.aiNote = `The AI couldn't draft this one (${err instanceof Error ? err.message.slice(0, 200) : String(err)}): please fill it in with Edit.`;
    fresh.updatedAt = Date.now();
    await saveListing(fresh);
    await render(fresh);
  }
}

/** The AI fills only what's still blank; a live item being edited starts from what the website shows. */
async function aiDraft(e: Equip, category: string | null, base: Draft, user: string): Promise<void> {
  const id = e.id;
  const notes: string[] = [];
  const brand = String(e.custom?.custom_5 ?? "").trim();
  const ask: Ask = {
    rentmanName: e.name, brand, model: String(e.custom?.custom_6 ?? "").trim(),
    categoryName: cfg().categories.find((c) => c.slug === category)?.name ?? "not on the website yet", kind: e.type === "item" ? "item" : "kit", contents: "",
  };
  let ai: Partial<Draft> = {};
  if (!base.short || !base.long) {
    try {
      const rows = await styleExamples(readStyleExamples);
      const fid = (r: { folder: string | null }) => String(r.folder ?? "").split("/").pop() ?? "";
      const same = rows.filter((r) => fid(r) === folderIdOf(e));
      const ex = [...same, ...rows.filter((r) => !same.includes(r))].slice(0, 10);
      const c = await writeCopy(ask, ex);
      ai = { ...ai, webName: c.webName, short: c.short, long: c.long };
      if (c.note) notes.push(c.note);
    } catch (err) {
      if (isRentmanBusyError(err)) throw err;
      report(err, "listings.copy", { id });
      notes.push(`Couldn't draft the descriptions (${err instanceof Error ? err.message : String(err)}): please write them.`);
    }
  }
  if (!base.techSpec && !Object.keys(base.glance).length) {
    if (!brand) notes.push("No Brand on the item in Rentman, so the specs weren't looked up: add the Brand in Rentman, or type them in.");
    else {
      try {
        const r = await researchSpecs(ask, specFields(cfg(), category), glanceFields(category));
        ai = { ...ai, specs: r.specs, glance: r.glance, techSpec: r.techSpec, specSource: r.specSource };
        if (r.note) notes.push(r.note);
      } catch (err) {
        report(err, "listings.specs", { id });
        notes.push(`Couldn't look up the specs (${err instanceof Error ? err.message : String(err)}): please check them.`);
      }
    }
  }
  const fresh = (await getListing(id))!;
  fresh.draft = fillBlanks(fresh.draft, ai);
  fresh.aiNote = notes.join(" ").slice(0, 1500);
  fresh.issues = problems(e, fresh.draft, category, cfg());
  fresh.stage = "draft";
  fresh.updatedAt = Date.now();
  await saveListing(fresh);
  await render(fresh);
  await inThread(fresh, `<@${user}> your draft is ready. Check every field and press *Edit* to change anything${fresh.issues.length ? ", and fix what's listed under *Before this can go live*" : ""}. Then ask Jamie, Sam or Will to press *Publish*.`);
}

/** Re-reads the item from Rentman (1 call) and shows what still stops Publish. */
async function check(l: Listing): Promise<Listing> {
  const e = await getEquipment(l.rentmanId);
  l.category = e ? categoryOf(e, await foldersFor(e), cfg()) : l.category;
  l.issues = problems(e, l.draft, l.category, cfg());
  l.updatedAt = Date.now();
  await saveListing(l);
  await render(l);
  return l;
}

async function publish(id: number, byEmail: string): Promise<void> {
  const l = await claimStage(id, ["draft"], "publishing");
  if (!l) return; // a double press, or it moved on
  await render(l);
  const owner = randomUUID();
  const back = async (note: string, issues?: Problem[]) => {
    l.stage = "draft";
    l.note = note;
    if (issues) l.issues = issues;
    l.updatedAt = Date.now();
    await saveListing(l);
    await render(l);
  };
  if (!(await claimWriter(owner, WRITER_LEASE_MS))) return back("Another Rentman update (kit onboarding or another listing) is running. Press Publish again in a few minutes.");
  try {
    const e = await getEquipment(id);
    l.category = e ? categoryOf(e, await foldersFor(e), cfg()) : l.category;
    const issues = problems(e, l.draft, l.category, cfg());
    if (issues.length || !e) return back("Not published: fix what's listed, then press Publish again.", issues);
    const name = l.specFile || newSpecFileName(e, l.draft, await specFileNames());
    let file = techSpecFile(e, l.draft, l.category, name);
    // Unchanged from the Brand + Model page the website already shows for it: no file of its own needed.
    if (file && !l.specFile && l.sharedSpec) {
      const text = await readSpecFile(l.sharedSpec);
      if (text && sameSpec(parseTechSpec(text), l.draft)) file = null;
    }
    if (file?.problems.length) return back(`Not published: the tech spec page has a problem: ${file.problems.join("; ")}`);

    const body = publishBody(e, l.draft, l.category, cfg());
    if (Object.keys(body).length) {
      await putEquipment(id, body);
      const bad = verifyUpdate(body, await getEquipment(id));
      if (bad.length) throw new Error(`Rentman didn't keep everything: ${bad.join(", ")}`);
    }
    const by = nameOfEmail(byEmail);
    let fileNote = "";
    if (file && (await readSpecFile(file.name)) !== file.text) {
      try {
        const url = await writeSpecFile(file.name, file.text, l.draft.webName || publicName(e.name), by);
        l.specFile = file.name;
        fileNote = ` Tech spec page saved (<${url}|change>).`;
      } catch (err) {
        report(err, "listings.specfile", { id });
        await saveListing(l);
        return back(`Saved in Rentman, but the tech spec page couldn't be saved (${err instanceof Error ? err.message.slice(0, 200) : String(err)}). Press Publish again: Rentman won't be changed twice.`);
      }
    } else if (file) l.specFile = file.name;
    l.stage = "published";
    l.publishedAt = Date.now();
    l.publishedBy = by;
    l.previous = structuredClone(l.draft);
    l.issues = [];
    l.liveChecked = false;
    l.note = Object.keys(body).length ? `Saved in Rentman and ticked visible in webshop.${fileNote}` : `Rentman already matched.${fileNote}`;
    l.updatedAt = Date.now();
    await saveListing(l);
    await render(l);
    await inThread(l, `Published by ${by}. <@${l.owner}> it goes live at the next website update (05:41), and I'll say here when it's on the site.`);
  } catch (err) {
    await back(`Publish stopped: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}. Jamie has been told.`);
    throw err;
  } finally {
    await releaseWriter(owner).catch((e) => report(e, "listings.release"));
  }
}

async function takeOff(id: number, byEmail: string): Promise<void> {
  const l = await getListing(id);
  if (!l || !["published", "live"].includes(l.stage)) return;
  const owner = randomUUID();
  if (!(await claimWriter(owner, WRITER_LEASE_MS))) {
    l.note = "Another Rentman update is running. Press Take off website again in a few minutes.";
    await saveListing(l);
    await render(l);
    return;
  }
  try {
    const e = await getEquipment(id);
    if (e?.in_shop) {
      await putEquipment(id, { in_shop: false });
      const bad = verifyUpdate({ in_shop: false }, await getEquipment(id));
      if (bad.length) throw new Error(`Rentman didn't untick visible in webshop`);
    }
    const by = nameOfEmail(byEmail);
    l.stage = "removed";
    l.note = `Taken off by ${by}: visible in webshop is unticked, so it disappears at the next website update.`;
    l.updatedAt = Date.now();
    await saveListing(l);
    await render(l);
    await inThread(l, l.note);
  } finally {
    await releaseWriter(owner).catch((e) => report(e, "listings.release"));
  }
}

async function goLive(id: number, byEmail: string, user: string, channel: string): Promise<void> {
  const l = await getListing(id);
  if (!l || l.stage !== "published") return;
  if (!(await countGoLive(londonDate(Date.now()), GO_LIVE_PER_DAY, byEmail))) {
    await slack("chat.postEphemeral", { channel, user, text: `Go live now has been used ${GO_LIVE_PER_DAY} times today (each one uses Rentman's shared limit). It will go live at 05:41 tomorrow.` });
    return;
  }
  await runWebsiteSync();
  l.goLiveAt = Date.now();
  l.note = `${nameOfEmail(byEmail)} pressed Go live now: the website update takes about 10 minutes.`;
  l.updatedAt = Date.now();
  await saveListing(l);
  await render(l);
  await inThread(l, l.note);
}

// ---------- Buttons and the form ----------

const PREFIX = "lk_";
export const isListingAction = (p: { type?: string; actions?: { action_id?: string }[]; view?: { callback_id?: string } }) =>
  (p.type === "block_actions" && !!p.actions?.[0]?.action_id?.startsWith(PREFIX)) || (p.type === "view_submission" && !!p.view?.callback_id?.startsWith(PREFIX));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleListingInteraction(p: any): Promise<Result> {
  const user: string = p.user.id;
  const email = await userEmail(user);
  const where: string | undefined = p.channel?.id;
  const deny = (text: string): Result => ({ after: async () => { await (p.response_url ? respond(p.response_url, { response_type: "ephemeral", replace_original: false, text }) : slack("chat.postEphemeral", { channel: where, user, text })); } });
  const safely = (context: string, work: () => Promise<void>): Result => ({ after: () => work().catch((err) => tell(p.response_url, where, user, err, context)) });

  if (p.type === "view_submission" && p.view.callback_id === "lk_save") {
    const id = Number(p.view.private_metadata);
    return safely("listings.save", async () => {
      const l = await getListing(id);
      if (!l) throw new Error(`listing ${id} not found`);
      l.draft = readEditModal(p.view.state.values, l.draft, l, cfg());
      if (l.stage === "published" || l.stage === "live") l.stage = "draft"; // an edit to a published listing needs Publish again
      l.issues = withDraftIssues(l);
      l.note = `Edited by ${nameOfEmail(email)}.`;
      l.remindedAt = 0;
      l.updatedAt = Date.now();
      await saveListing(l);
      await render(l);
    });
  }

  const action = p.actions[0];
  if (!canDraft(email)) return deny("Only the FOMO team can do this. Please ask Jamie.");
  switch (action.action_id) {
    case "lk_recent":
      return safely("listings.recent", async () => respond(p.response_url, { response_type: "ephemeral", replace_original: true, text: "Recent kit", blocks: searchBlocks(await recentEquipment(RECENT_DAYS), "", true) }));
    case "lk_pick":
      return safely("listings.start", () => startListing(Number(action.value), user, p.response_url));
  }
  const id = Number(action.value);
  const l = await getListing(id);
  if (!l) return deny("I can't find that listing any more.");
  switch (action.action_id) {
    case "lk_edit":
      if (!["draft", "published", "live"].includes(l.stage)) return {};
      await slack("views.open", { trigger_id: p.trigger_id, view: editModal(l, cfg()) }); // must open within 3 seconds of the press
      return {};
    case "lk_check":
      return safely("listings.check", async () => { await check(l); });
    case "lk_discard":
      if (user !== l.owner && !canPublish(email)) return deny("Only whoever started this draft, or Jamie, Sam or Will, can discard it.");
      return safely("listings.discard", async () => {
        const moved = await claimStage(id, ["draft"], "discarded");
        if (moved) await render({ ...moved, note: `Discarded by ${nameOfEmail(email)}.` });
      });
    case "lk_publish":
      if (!canPublish(email)) return deny("Jamie, Sam or Will publish listings. I've left it as a draft.");
      return safely("listings.publish", () => publish(id, email));
    case "lk_golive":
      if (!canPublish(email)) return deny("Only Jamie, Sam or Will can run the website update early.");
      return safely("listings.golive", () => goLive(id, email, user, where ?? l.channel));
    case "lk_remove":
      if (!canPublish(email)) return deny("Only Jamie, Sam or Will can take an item off the website.");
      return safely("listings.remove", () => takeOff(id, email));
  }
  return {};
}
