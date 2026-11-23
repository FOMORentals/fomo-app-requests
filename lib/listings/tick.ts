/**
 * The listings part of the 15-minute cron (lib/tick.ts runs it after the requests). One Firestore query, at most one
 * read of the website's search index, no Rentman calls.
 * - A draft nobody has touched for 2 days: one reminder to whoever started it.
 * - A published listing: "now live" with the link once the website update shows it; if the update has run and it
 *   still isn't there, the owner and Jamie are told once (rule 1).
 */
import { loadConfig } from "@fomo/rentman-core/config";
import { OWNER_EMAIL } from "../config";
import { report } from "../report";
import { dmChannel, messageLink, slack, userIdByEmail } from "../slack";
import { londonDate, londonHour } from "../time";
import { cardBlocks } from "./blocks";
import { LIVE_BY_HOUR, REMIND_AFTER_MS, websiteUrl } from "./config";
import { needsReminder, shouldBeLive, type Listing } from "./draft";
import { liveIndex, openListings, saveListing } from "./store";

export type ListingsTick = { reminded: number; live: number; missing: number; failures: number };

async function dmUser(userId: string, text: string) {
  await slack("chat.postMessage", { channel: await dmChannel(userId), text, unfurl_links: false });
}

export async function runListingsTick(now: number): Promise<ListingsTick> {
  const out: ListingsTick = { reminded: 0, live: 0, missing: 0, failures: 0 };
  if (!process.env.LISTINGS_CHANNEL_ID) return out; // not set up yet
  const all = await openListings();
  const published = all.filter((l) => l.stage === "published");
  const index = published.length ? await liveIndex() : null;
  for (const l of all) {
    try {
      if (needsReminder(l, now, REMIND_AFTER_MS)) {
        await dmUser(l.owner, `Your website listing for *${l.name}* is still a draft: ${await messageLink(l.channel, l.cardTs)}. Finish it, ask Jamie, Sam or Will to publish it, or press Discard.`);
        await saveListing({ ...l, remindedAt: now });
        out.reminded++;
        continue;
      }
      if (l.stage !== "published" || !index) continue;
      const entry = index.entries.find((x) => Number(x.rentmanId) === l.rentmanId);
      const due = shouldBeLive(l, now, londonDate, londonHour, LIVE_BY_HOUR);
      // A new item shows up in the index once the update after Publish has run. An edit to an item already on the
      // site may not change the index at all, so once that update is due its presence is enough.
      if (entry && (index.updatedAt >= l.publishedAt || due)) {
        const link = `${websiteUrl()}/equipment/${entry.slug}`;
        const done: Listing = { ...l, stage: "live", liveAt: now, note: `Live on the website: ${link}`, updatedAt: now };
        await saveListing(done);
        await slack("chat.update", { channel: l.channel, ts: l.cardTs, text: `Website listing: ${l.name}`, blocks: cardBlocks(done, loadConfig(), []) });
        await slack("chat.postMessage", { channel: l.channel, thread_ts: l.cardTs, text: `🌐 <@${l.owner}> *${l.name}* is now live: ${link}`, unfurl_links: false });
        out.live++;
      } else if (!l.liveChecked && due) {
        const why = "The website has updated since it was published, but it isn't showing yet. Usually the update itself failed (Jamie gets an alert when it does), or something changed in Rentman since (press Check again on the card).";
        const card = await messageLink(l.channel, l.cardTs);
        await slack("chat.postMessage", { channel: l.channel, thread_ts: l.cardTs, text: `<@${l.owner}> ${why}`, unfurl_links: false });
        await dmUser(await userIdByEmail(OWNER_EMAIL), `Website listing *${l.name}* didn't appear after the website update: ${card}`);
        await saveListing({ ...l, liveChecked: true, updatedAt: now });
        out.missing++;
      }
    } catch (err) {
      out.failures++;
      report(err, "listings.tick", { id: l.rentmanId });
    }
  }
  return out;
}
