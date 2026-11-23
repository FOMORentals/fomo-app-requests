import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "@fomo/rentman-core/config";
import type { FolderRow } from "@fomo/rentman-core/rentman-types";
import { checkTechSpec } from "@fomo/rentman-core/tech-spec";
import { allowedSource, cleanSpecs, fitSections, lastJson } from "./ai";
import { cardBlocks, editModal, readEditModal, searchBlocks } from "./blocks";
import { canDraft, canPublish } from "./config";
import {
  categoryOf,
  changes,
  draftFromRentman,
  emptyDraft,
  fillBlanks,
  htmlToText,
  textToHtml,
  needsReminder,
  newSpecFileName,
  parseTechSpec,
  problems,
  publishBody,
  shouldBeLive,
  specFields,
  techSpecFile,
  verifyUpdate,
  type Listing,
} from "./draft";
import { matchByName, type Equip } from "./rentman";
import { pinnedIds } from "./website";

const config = loadConfig();
const folders: FolderRow[] = [
  { id: 139, name: "Camera", parent: null },
  { id: 500, name: "Sony", parent: "/folders/139" },
  { id: 45, name: "Lenses", parent: null },
  { id: 281, name: "Consumables", parent: null },
];

const camera = (over: Partial<Equip> = {}): Equip =>
  ({
    id: 9001, code: "9001", name: "Sony FX3", type: "item", is_combination: false, folder: "/folders/500", price: 95, factor_group: null,
    in_planner: true, in_shop: false, in_archive: false, image: "/files/1", shop_description_short: "", shop_description_long: "",
    custom: { custom_5: "Sony", custom_6: "FX3", custom_22: "Tranche 4 | CVP | Oct 2026" },
    ...over,
  }) as Equip;

const listing = (over: Partial<Listing> = {}): Listing => ({
  rentmanId: 9001, code: "9001", name: "Sony FX3", category: "cameras", owner: "U1", ownerEmail: "louis@fomorentals.co.uk", stage: "draft",
  draft: { ...emptyDraft(), short: "Full-frame cinema camera", long: "A small camera.", specs: { "Web: Coverage": "FF" } },
  previous: null, aiNote: "", channel: "C1", cardTs: "1.1", specFile: "", sharedSpec: "", createdAt: 0, updatedAt: 0, remindedAt: 0, publishedAt: 0,
  publishedBy: "", liveAt: 0, liveChecked: false, goLiveAt: 0, issues: [], note: "",
  ...over,
});

test("who can draft and who can publish (Jamie, 23 Nov 2026)", () => {
  assert.ok(canDraft("louis@fomorentals.co.uk"));
  assert.ok(!canDraft("someone@example.com"));
  for (const e of ["jamie@fomorentals.co.uk", "sam@fomorentals.co.uk", "will@fomorentals.co.uk"]) assert.ok(canPublish(e));
  assert.ok(!canPublish("louis@fomorentals.co.uk"));
});

test("an item's website category comes from its Rentman folder", () => {
  assert.equal(categoryOf(camera(), folders, config), "cameras");
  assert.equal(categoryOf(camera({ folder: "/folders/281" }), folders, config), null);
  assert.equal(categoryOf(camera({ folder: null }), folders, config), null);
});

test("cameras and lenses get spec fields; other categories don't", () => {
  assert.deepEqual(specFields(config, "cameras").map((f) => f.label), ["Web: Coverage", "Web: Max resolution", "Web: Max frame rate", "Web: Mount", "Web: Recording media"]);
  assert.equal(specFields(config, "lighting").length, 0);
  assert.equal(specFields(config, null).length, 0);
});

test("a new purchase's draft starts with New on; a live item's keeps its own New", () => {
  assert.equal(draftFromRentman(camera(), config, "cameras").isNew, true);
  assert.equal(draftFromRentman(camera({ in_shop: true, custom: { custom_49: false } }), config, "cameras").isNew, false);
});

test("a live item's draft reads its Rentman web fields, pick lists as labels", () => {
  const d = draftFromRentman(camera({ in_shop: true, shop_description_short: "S", custom: { custom_50: "Sony FX3 Cinema Line", custom_42: "3", custom_43: "4K" } }), config, "cameras");
  assert.equal(d.webName, "Sony FX3 Cinema Line");
  assert.equal(d.short, "S");
  assert.deepEqual(d.specs, { "Web: Coverage": "FF", "Web: Max resolution": "4K" });
});

test("the AI only fills what's still blank", () => {
  const d = fillBlanks({ ...emptyDraft(), short: "mine", specs: { "Web: Coverage": "S35" } }, { short: "ai", long: "ai long", specs: { "Web: Coverage": "FF", "Web: Mount": "E" } });
  assert.equal(d.short, "mine");
  assert.equal(d.long, "ai long");
  assert.deepEqual(d.specs, { "Web: Coverage": "S35", "Web: Mount": "E" });
});

test("Publish is refused until the photo, price, planner, folder and both descriptions are there", () => {
  const ok = problems(camera(), listing().draft, "cameras", config);
  assert.deepEqual(ok, []);
  const bad = problems(camera({ image: null, price: 0, in_planner: false }), { ...emptyDraft() }, null, config);
  const text = bad.map((p) => p.what).join(" | ");
  for (const word of ["photo", "£0", "planner", "folder", "short description", "long description"]) assert.match(text, new RegExp(word));
  assert.ok(bad.filter((p) => p.where === "rentman").length >= 4);
  assert.equal(problems(null, emptyDraft(), null, config)[0].where, "rentman");
});

test("a pick-list value Rentman doesn't know stops Publish", () => {
  const p = problems(camera(), { ...listing().draft, specs: { "Web: Coverage": "IMAX" } }, "cameras", config);
  assert.match(p[0].what, /IMAX/);
});

test("the Rentman update sends only what changed, custom whole, and ticks the website", () => {
  const e = camera();
  const body = publishBody(e, listing().draft, "cameras", config);
  assert.equal(body.in_shop, true);
  assert.equal(body.shop_description_short, "Full-frame cinema camera");
  const custom = body.custom as Record<string, unknown>;
  assert.equal(custom.custom_22, "Tranche 4 | CVP | Oct 2026"); // nothing else wiped
  assert.equal(custom.custom_42, "3"); // FF as Rentman's choice id
  assert.equal(custom.custom_50, "Sony FX3"); // never blank: the Rentman name
  assert.equal(custom.custom_49, true);
  assert.ok(!("custom_43" in custom && custom.custom_43 === "")); // a blank never written over nothing
});

test("publishing again when Rentman already matches changes nothing (idempotent)", () => {
  const d = listing().draft;
  const first = publishBody(camera(), d, "cameras", config);
  const after = camera({ in_shop: true, shop_description_short: d.short, shop_description_long: String(first.shop_description_long), custom: first.custom as Record<string, unknown> });
  assert.deepEqual(publishBody(after, d, "cameras", config), {});
  assert.deepEqual(verifyUpdate(first, after), []);
  assert.deepEqual(verifyUpdate({ in_shop: true }, camera()), ["in_shop didn't save"]);
  assert.deepEqual(verifyUpdate({ in_shop: true }, null), ["the item is gone on re-read"]);
});

test("the tech spec file is pinned to the item and passes the website's own checks", () => {
  const d = { ...listing().draft, glance: { glance_weight: "745 g", glance_sensor: "Full-frame" }, techSpec: "### Sensor\n| | |\n| --- | --- |\n| Type | Full-frame |", specSource: "https://www.sony.co.uk/fx3" };
  const f = techSpecFile(camera(), d, "cameras", "sony-fx3")!;
  assert.match(f.text, /^rentman: 9001$/m);
  assert.match(f.text, /^glance_weight: 745 g$/m);
  assert.deepEqual(f.problems, []);
  assert.deepEqual(checkTechSpec("sony-fx3.md", f.text), []);
  assert.equal(techSpecFile(camera(), emptyDraft(), "cameras", "x"), null);
  assert.deepEqual(pinnedIds(f.text), [9001]);
  const back = parseTechSpec(f.text);
  assert.deepEqual(back.glance, d.glance);
  assert.equal(back.specSource, d.specSource);
  assert.equal(back.techSpec, d.techSpec);
});

test("a new file never takes another item's name", () => {
  assert.equal(newSpecFileName(camera(), emptyDraft(), new Set()), "sony-fx3");
  assert.equal(newSpecFileName(camera(), emptyDraft(), new Set(["sony-fx3"])), "sony-fx3-9001");
});

test("an edit to a live listing shows old next to new", () => {
  const before = { ...emptyDraft(), short: "Old", isNew: false };
  const ch = changes(before, { ...before, short: "New words" }, "cameras", config);
  assert.deepEqual(ch, [{ label: "Short description", before: "Old", after: "New words" }]);
  assert.deepEqual(changes(null, before, "cameras", config), []);
});

test("one reminder after 2 untouched days", () => {
  const two = 2 * 86_400_000;
  assert.ok(needsReminder(listing({ updatedAt: 0 }), two, two));
  assert.ok(!needsReminder(listing({ updatedAt: 0, remindedAt: 5 }), two, two));
  assert.ok(!needsReminder(listing({ updatedAt: 0, stage: "published" }), two, two));
});

test("a published listing should be live after the 05:41 update, or 40 minutes after Go live now", () => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const hour = (ms: number) => new Date(ms).getUTCHours();
  const mon14 = Date.UTC(2026, 10, 23, 14);
  assert.ok(!shouldBeLive({ publishedAt: mon14, goLiveAt: 0 }, mon14 + 3600_000, day, hour, 8));
  assert.ok(!shouldBeLive({ publishedAt: mon14, goLiveAt: 0 }, Date.UTC(2026, 10, 24, 7), day, hour, 8));
  assert.ok(shouldBeLive({ publishedAt: mon14, goLiveAt: 0 }, Date.UTC(2026, 10, 24, 8), day, hour, 8));
  assert.ok(shouldBeLive({ publishedAt: Date.UTC(2026, 10, 24, 3), goLiveAt: 0 }, Date.UTC(2026, 10, 24, 9), day, hour, 8));
  assert.ok(shouldBeLive({ publishedAt: mon14, goLiveAt: mon14 + 60_000 }, mon14 + 45 * 60_000, day, hour, 8));
});

test("name search needs every word, skips archived items, closest first", () => {
  const rows = [
    { id: 1, code: "100", name: "Kit - Sony FX3 Cine", in_shop: false },
    { id: 2, code: "200", name: "Sony FX3", in_shop: true },
    { id: 3, code: "300", name: "Sony FX3 old", in_shop: false, in_archive: true },
    { id: 4, code: "400", name: "Sony FX6", in_shop: false },
  ];
  assert.deepEqual(matchByName(rows, "sony fx3").map((m) => m.id), [2, 1]);
  assert.deepEqual(matchByName(rows, "  "), []);
});

test("specs only from the manufacturer's own site, and only values the website knows", () => {
  assert.ok(allowedSource("https://www.sony.co.uk/electronics/fx3", "Sony"));
  assert.ok(allowedSource("https://www.blackmagicdesign.com/products", "Blackmagic Design"));
  assert.ok(!allowedSource("https://www.cvp.com/product/sony-fx3", "Sony"));
  assert.ok(!allowedSource("not a url", "Sony"));
  const fields = specFields(config, "cameras");
  assert.deepEqual(cleanSpecs([{ field: "Web: Coverage", value: "IMAX" }, { field: "Web: Mount", value: "E" }, { field: "Other", value: "x" }], fields), { "Web: Mount": "E" });
  assert.deepEqual(lastJson(["searching…", 'answer {"a":1}']), { a: 1 });
});

test("long tech spec tables lose whole sections from the end, never half a table", () => {
  const md = "### A\n| | |\n| --- | --- |\n| x | 1 |\n### B\n" + "| y | 2 |\n".repeat(400);
  assert.equal(fitSections(md, 100), "### A\n| | |\n| --- | --- |\n| x | 1 |");
});

test("search results offer each match and the recent ones", () => {
  const b = searchBlocks([{ id: 1, code: "100", name: "Sony FX3", inShop: false }], "fx3");
  assert.equal(b[1].accessory.action_id, "lk_pick");
  assert.equal(b.at(-1)!.elements[0].action_id, "lk_recent");
  assert.match(searchBlocks([], "zzz")[0].text.text, /Nothing in Rentman/);
});

test("the card shows Publish only on a draft, and Go live now once published", () => {
  const ids = (l: Listing) => cardBlocks(l, config, []).filter((b) => b.type === "actions").flatMap((b) => b.elements.map((e: { action_id: string }) => e.action_id));
  assert.deepEqual(ids(listing()), ["lk_edit", "lk_check", "lk_publish", "lk_discard"]);
  assert.deepEqual(ids(listing({ stage: "published", publishedBy: "Sam" })), ["lk_golive", "lk_edit", "lk_remove"]);
  assert.deepEqual(ids(listing({ stage: "drafting" })), []);
  const blocked = cardBlocks(listing(), config, [{ what: "It has no photo.", where: "rentman" }]);
  assert.ok(blocked.some((b) => b.text?.text?.includes("Before this can go live") && b.text.text.includes("no photo")));
  for (const b of cardBlocks(listing({ draft: { ...listing().draft, long: "x".repeat(5000) } }), config, [])) if (b.text?.text) assert.ok(b.text.text.length <= 3000);
});

test("the edit form round-trips every field", () => {
  const l = listing({ draft: { ...listing().draft, webName: "FX3", glance: { glance_weight: "745 g" }, techSpec: "### A", specSource: "https://sony.com" } });
  const view = editModal(l, config);
  assert.ok(view.blocks.length <= 100);
  const values: Record<string, Record<string, unknown>> = {};
  for (const b of view.blocks) {
    const el = b.element;
    values[b.block_id] = { v: el.type === "static_select" ? { selected_option: el.initial_option ?? null } : el.type === "checkboxes" ? { selected_options: el.initial_options ?? [] } : { value: el.initial_value ?? "" } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.deepEqual(readEditModal(values as any, l.draft, l, config), l.draft);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (values["spec:Web: Coverage"] as any).v = { selected_option: { value: "-" } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.deepEqual(readEditModal(values as any, l.draft, l, config).specs, {});
});

test("long descriptions are HTML in Rentman and plain paragraphs in Slack", () => {
  const html = "<p>The <strong>Sony FX5</strong> is small &amp; light.</p><p>Second paragraph.</p>";
  const text = htmlToText(html);
  assert.equal(text, "The **Sony FX5** is small & light.\n\nSecond paragraph.");
  assert.equal(textToHtml(text), html);
  assert.equal(htmlToText("plain"), "plain");
  // unchanged text is never written back, even though Rentman holds HTML
  const e = camera({ shop_description_long: html, shop_description_short: "S" });
  const body = publishBody(e, { ...emptyDraft(), short: "S", long: text }, "cameras", config);
  assert.ok(!("shop_description_long" in body));
});
