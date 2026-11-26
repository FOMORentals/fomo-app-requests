# Stock take: Checked list, short loose kit, delete a count, report columns
**Asked by:** Will Royal, 26 Nov 2026 · **App(s):** Inventory dashboard (Stock take) · **Slack thread:** https://team-fomo-hq.slack.com/archives/C0CKKHG4BQQ/p1795695299512689

## In one paragraph
Four small-to-medium changes to the stock take that went live on 26 Nov, all inside the Inventory dashboard and none adding Rentman calls. (1) The Checked list shows each QR-coded unit as soon as it is accounted for (scanned, ticked, lost or out on a job), laid out exactly like To check, so the team can see progress during a count; today it stays almost empty because it only shows an item once every unit of it is found. (2) Loose kit only moves to Checked when the typed total matches Rentman's number or is higher; a short total stays in To check with "N short". (3) Will, Sam or Jamie can delete any count, signed off or not, after one Confirm / Cancel box. (4) Headings and numbers in the report and the count page's lists use the same alignment, so numbers sit under the right heading. The only house-rule item is (3): it deletes data, including a signed-off count's final report and its Done in Rentman ticks, so it needs Jamie's OK.

## Started as
Will's words:
1. "Checked items don't show in the tab until the first report has been generated. We will want to see a live update of the items scanned. A fresh count should also already have this populated with the lost and or kit on jobs in this section."
2. "Add a feature to delete a count."
3. "Sometimes the report generated doesn't line up with the headers." (Screenshot attached in the thread: the Missing table, 15mm Rod 6" and 8", where 4 and 22 should sit under Rentman but look as if they are under Counted.)
4. "Loose items should only move to the checked field if the quantity matches (or there more than expected)."

## The outcome Will wants
During a stock take, everyone scanning (the whole team) and the people running counts (Will, Sam and Jamie) can see what has already been accounted for, so they know what's left and don't rescan or miss shelves. Kit that is lost or out on jobs should show as accounted for from the start, so the team isn't hunting for it. Loose kit should only look done when the count really adds up. Test or mistaken counts can be cleared away so they don't block a real one. And the report must be easy to read, with numbers clearly under their headings. This applies to every count, full or partial, each time one is run.

## What already exists
- **Stock take** in the Inventory dashboard (Will's spec, Jamie's go-ahead, 26 Nov 2026). Read only towards Rentman: Rentman is read through the Team Dashboard's refresh worker, at most once every 10 minutes per count, and when a report is made.
- **Checked tab:** an item is only listed once every unit of it is accounted for. If 4 of 5 units are scanned, those 4 leave To check but show nowhere. Making a report doesn't change that. This is why Checked looks empty early on.
- **Lost and out-on-job kit:** lost units (switched off in Rentman) and units whose last job went out since the count started already count as checked from the very first read. The same whole-item rule hides them from the list. "Went out on a job" is worked out only when the app reads Rentman: at the start, on Refresh from Rentman, and when a report is made.
- **Freshness:** the count page shows the latest scans whenever it is opened or reloaded. It doesn't update by itself while it sits open.
- **Loose kit:** an item moves to Checked as soon as any number is typed, even if it's short. "Out on jobs now" is shown as a help figure only and is never added in (Jamie, 26 Nov 2026). The team types the full total.
- **Delete:** there is no way to delete a count. Counts can't clash, so while a test count is open, no full count can start.
- **Report columns:** numbers sit at the right-hand edge of each column while headings sit at the left. So a Rentman figure ends up next to where the Counted heading starts and reads as if it belongs to Counted. The same happens on the count page's loose and checked lists (Rentman and Counted headings).

Missing: a unit-by-unit Checked list, a matching rule for loose kit, a delete, and consistent alignment.

## What to build
All in the Inventory dashboard, Stock take section (the count page, its To check / To check: loose / Checked lists, and the report on screen and in print).

1. **Checked list, unit by unit.** Checked uses exactly the same layout as To check: folder order, each QR-coded unit on its own row with item name, QR and serial. No names, times or extra labels.
2. **Units move across, never sit in both.** A unit moves from To check to Checked when it's scanned or ticked by hand. An item that's partly scanned appears in both lists: the units still to find under To check, the units found under Checked. No single QR code is ever in both lists.
3. **Lost and out-on-job units are in Checked from the start** of a fresh count, as soon as the first read is done. Kit that goes out on a job after the count started moves across after the next Refresh from Rentman (or a report), as now.
4. **No new reads.** The Checked list is built from what the count has already saved and what the page already loads. It is up to date whenever the page is opened or reloaded; it does not update by itself.
5. **Checked tile:** still opens the Checked list, but shows no number.
6. **Loose kit only checked when it adds up.** A loose item moves to Checked only when its typed total equals Rentman's number or is higher; on Checked it shows the Rentman and Counted numbers. If it's short, it stays in To check: loose with the typed number and "N short", and the total can be changed at any time (a total changed to short moves it back). At sign-off a short item goes on the report as short, as now.
7. **Delete a count.** Will, Sam or Jamie (the people who can start counts) see a Delete button on any count, open or signed off. Pressing it shows one Confirm / Cancel box. Confirm removes only that count's own records: its scans, typed totals, To Onboard list and reports, including a final report and its Done in Rentman ticks. Nothing is kept. Its items are then free for other counts. Rentman is not touched.
8. **Columns line up.** All headings and all columns are formatted the same way, so every number sits under its heading (4 and 22 under Rentman in Will's screenshot). This covers the report on screen, the printed report, and the count page's lists.

## Decisions made in the grilling
- **What Checked shows:** the same list format as To check; units are added to Checked as they are scanned rather than just disappearing from To check. No extra Rentman calls (Will).
- **Row details:** no names, times or labels on Checked rows. Same format as To check (Will).
- **Part-scanned items:** shown in both lists, with each QR code in only one of them; units move from one to the other (Will).
- **Live updates:** not needed. Up to date on open or reload is enough (Will).
- **Kit going out mid-count:** caught on the next Refresh from Rentman, as now. OK (Will).
- **Counter:** no number needed on the Checked tile (Will).
- **Loose kit on jobs:** no change. "Out on jobs now" stays a help figure (Will; Jamie's 26 Nov decision stands).
- **Short loose kit:** stays in To check with its number and "N short"; the quantity can be updated whenever needed (Will).
- **Who deletes, what:** Will, Sam or Jamie can delete any count at any time, signed off or not. Only count data is removed, no working data (Will).
- **Delete warning:** one Confirm / Cancel message, nothing more (Will).
- **Columns:** all headings and columns formatted the same so they match, everywhere (Will). Seen on a laptop on screen and in print.

## Not doing
- **Who and when on each Checked row** ("Will, 10:42"): Will doesn't need it.
- **"3 of 5" next to part-scanned items, or labels saying how a unit was checked:** Will wants the plain To check format.
- **A page that updates by itself** (e.g. once a minute): not needed, and it would add repeated reads Jamie has asked us to avoid.
- **Spotting kit that goes out mid-count faster:** would need more Rentman calls; the Refresh button is good enough.
- **Adding on-job loose kit into the total automatically:** goes against Jamie's 26 Nov decision; Will finds the help figure enough.
- **A unit count on the Checked tile or changing the other tiles to count units:** Will saw no need.
- **Extra step for signed-off counts** (typing the count's name before deleting), **delete only for counts not signed off**, **a "Cancel count" that hides and keeps the record**, **delete for anyone on the team:** all offered, Will chose one Confirm / Cancel for Will, Sam or Jamie on any count.

## Needs Jamie
- **Deleting data:** the new Delete permanently removes a count's records (scans, totals, To Onboard list, reports), including a signed-off count's final report and its Done in Rentman ticks, with no copy kept. Will's view is that this is only count data, not working data; it is still on the house-rules list.
- **Who can do what:** Delete is limited to the existing stock-take admins (Will, Sam, Jamie); no change to who can see the stock take.
- No Rentman calls added, no Rentman, HubSpot or Xero writes, no customer emails, no money, no new scheduled job. Nothing a person needs to create first.

## Open questions
1. Is Jamie happy for signed-off counts (the finished record, with Done in Rentman ticks) to be deletable with just one Confirm / Cancel and nothing kept? Will chose this on purpose.
2. Should a deleted count leave any trace (for example a one-line note of who deleted which count and when)? Will asked for nothing kept; this is only raised so Jamie decides it rather than it being assumed.

## How we'll know it works
- Start a fresh count: before anything is scanned, Checked already lists the lost units and units out on jobs, in folder order, one row per QR code.
- Scan a unit and reload: it has left To check and appears under Checked. With 3 of 5 rods scanned, the rod shows under To check with the 2 still missing and under Checked with the 3 found; no QR code is in both.
- The Checked tile opens the list and shows no number.
- Type a loose total 2 under Rentman's figure: it stays in To check: loose with "2 short". Change it to match (or go over): it moves to Checked showing Rentman and Counted.
- Will, Sam or Jamie press Delete on a test count, confirm, and it's gone; a full count can then be started. Other team members see no Delete button.
- Open and print a report: in the Missing table, 4 and 22 for the 15mm rods sit squarely under Rentman, and every other heading lines up with its numbers; the same on the count page's lists.
- Rentman call counts for a count are the same as before.