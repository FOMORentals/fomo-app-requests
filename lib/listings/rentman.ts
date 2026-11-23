/**
 * Rentman for website listings. Every call goes through @fomo/rentman-core/rentman-guard (one shared quota and circuit).
 *
 * Rentman call budget (approved by Jamie, 23 Nov 2026: about 5 calls per listing):
 *
 * | Call                                                        | When                          | Calls |
 * |-------------------------------------------------------------|-------------------------------|-------|
 * | GET /equipment?code=… (+ GET /equipment/<n> if it's a number) | `/list-kit 1234`              | 1-2   |
 * | GET /equipment?fields=id,code,name,… (limit 1500, paged)     | `/list-kit <part of a name>`  | 2     |
 * | GET /equipment?created[gte]=…                                | "Recent ones"                 | 1     |
 * | GET /equipment/<id>                                          | start a draft, Check again    | 1     |
 * | GET /folders?itemtype=equipment                              | at most once a day (cached)   | 1     |
 * | GET /equipment?in_shop=1 (style examples, fields trimmed)  | at most once a week (cached)  | 1     |
 * | GET /equipment/<id> + PUT /equipment/<id> + GET /equipment/<id> | Publish or Take off website | 3     |
 *
 * Typical listing: find 1-2, draft 1, publish 3 = 5-6 calls. Never one call per item in a loop. Writes only
 * website fields (custom_41-50, the two shop descriptions, in_shop) on the one item being published.
 */
import { rentmanGet, rentmanPut } from "@fomo/rentman-core/rentman-guard";
import type { EquipmentRow, FolderRow } from "@fomo/rentman-core/rentman-types";
import { htmlToText } from "./draft";
import { ensureAdc } from "./gcp";

const BASE = "https://api.rentman.net";
const PAGE = 1500;

export type Equip = EquipmentRow & { in_archive?: boolean; created?: string; modified?: string };
export type Match = { id: number; code: string; name: string; inShop: boolean };

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`Rentman ${what}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function get<T>(pathAndQuery: string, what: string): Promise<T> {
  ensureAdc();
  return json<T>(await rentmanGet(`${BASE}${pathAndQuery}`), what);
}

/** Offset-paged list (Rentman echoes the limit it applied; page by what it gave). */
async function list<T>(pathAndQuery: string, what: string, maxPages = 4): Promise<T[]> {
  const out: T[] = [];
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  for (let page = 0, offset = 0; page < maxPages; page++) {
    const r = await get<{ data: T[]; limit: number }>(`${pathAndQuery}${sep}limit=${PAGE}&offset=${offset}`, what);
    out.push(...r.data);
    const size = Number(r.limit) > 0 ? Math.min(Number(r.limit), PAGE) : PAGE;
    if (r.data.length < size) return out;
    offset += r.data.length;
  }
  throw new Error(`Rentman ${what}: more than ${maxPages} pages`);
}

const MATCH_FIELDS = "id,code,name,in_shop,in_archive";
const toMatch = (e: { id: number; code: string; name: string; in_shop: boolean }): Match => ({ id: e.id, code: String(e.code ?? ""), name: e.name, inShop: !!e.in_shop });

/** Pure: the best matches for what someone typed (every word must appear), live records only, closest first. */
export function matchByName(rows: { id: number; code: string; name: string; in_shop: boolean; in_archive?: boolean }[], text: string, max = 10): Match[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = rows.filter((r) => !r.in_archive && words.every((w) => `${r.name} ${r.code}`.toLowerCase().includes(w)));
  const score = (r: { name: string }) => (r.name.toLowerCase().startsWith(words[0]) ? 0 : 1) * 1000 + r.name.length;
  return hits.sort((a, b) => score(a) - score(b)).slice(0, max).map(toMatch);
}

/** `/list-kit <text>`: a code or id (digits) looks those up directly; anything else searches names. */
export async function findEquipment(text: string): Promise<Match[]> {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const byCode = await get<{ data: Equip[] }>(`/equipment?code=${encodeURIComponent(t)}&fields=${MATCH_FIELDS}`, "find by code");
    const out = byCode.data.filter((e) => !e.in_archive).map(toMatch);
    if (!out.some((m) => m.id === Number(t))) {
      const res = await (ensureAdc(), rentmanGet(`${BASE}/equipment/${t}`));
      if (res.ok) {
        const e = ((await res.json()) as { data: Equip }).data;
        if (!e.in_archive) out.push(toMatch(e));
      } else if (res.status !== 404) await json(res, "find by id");
    }
    return out;
  }
  return matchByName(await list<Equip>(`/equipment?fields=${MATCH_FIELDS}`, "search by name"), t);
}

/** "Recent ones": created in the last `days` days, not on the website, not archived. Newest first. */
export async function recentEquipment(days: number, now = Date.now()): Promise<Match[]> {
  const since = new Date(now - days * 86_400_000).toISOString().slice(0, 19);
  const rows = await list<Equip>(`/equipment?created[gte]=${since}&fields=${MATCH_FIELDS},created&sort=-created`, "recent", 1);
  return rows.filter((e) => !e.in_archive && !e.in_shop).slice(0, 15).map(toMatch);
}

/** One item with everything, custom fields included. Null when it doesn't exist. */
export async function getEquipment(id: number): Promise<Equip | null> {
  ensureAdc();
  const res = await rentmanGet(`${BASE}/equipment/${id}`);
  if (res.status === 404) return null;
  return (await json<{ data: Equip }>(res, `equipment ${id}`)).data;
}

export async function putEquipment(id: number, body: Record<string, unknown>): Promise<void> {
  ensureAdc();
  await json(await rentmanPut(`${BASE}/equipment/${id}`, body), `update equipment ${id}`);
}

export async function readFolders(): Promise<FolderRow[]> {
  return list<FolderRow>("/folders?itemtype=equipment&fields=id,name,parent", "folders");
}

export type StyleRow = { id: number; name: string; folder: string | null; short: string; long: string };

/** Live website items with both descriptions: the house style the AI copies. */
export async function readStyleExamples(): Promise<StyleRow[]> {
  const rows = await list<Equip>("/equipment?in_shop=1&fields=id,name,folder,in_shop,in_archive,shop_description_short,shop_description_long", "style examples", 3);
  return rows
    .filter((e) => e.in_shop && !e.in_archive && (e.shop_description_long ?? "").trim().length > 80 && (e.shop_description_short ?? "").trim())
    .map((e) => ({ id: e.id, name: e.name, folder: e.folder, short: e.shop_description_short!.trim(), long: htmlToText(e.shop_description_long!.trim()) }));
}
