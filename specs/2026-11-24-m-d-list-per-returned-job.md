# M&D list per returned job

**Asked by:** Will Royal, 24 Nov 2026 · **App(s):** Team Dashboard (Kit Prep refresh and its Slack alerts), posting to a new Slack channel · **Slack thread:** https://team-fomo-hq.slack.com/archives/C0CKKHG4BQQ/p1795529881285429

## In one paragraph
When a Rentman project is fully back (every sub-job checked in) and anything on it was marked lost or for repair on the scanners, the Team Dashboard posts one message to a new Slack channel called M&D. It lists the job name and number, a link to the project in Rentman, and each lost and damaged item with its quantity, QR code, manufacturer's serial number and, for repairs, the Remark the warehouse typed. Each post has a **Chased** button that shows who pressed it and when, with an Undo. It rides on the Kit Prep refresh the board already runs, so there is no new scheduled job. It does need new Rentman reads (the lost equipment and repairs lists, plus serials and QR codes), which is Jamie's call, and Jamie needs to create the channel. Nothing is written to Rentman or HubSpot.

## Started as
"I'd like to find a solution for the following: any time kit is marked as missing or damaged when coming back from a job, I get sent a list of these to assess. I'd like to be sent the list only when the rest of the job has been checked in (in the returned status) so that I only get the final M&D list from that job. I only want a list sent if the job has any M&D. The list should be the job name and number, the lost items and any damaged items with any additional notes that were put into the 'Remark' field when submitting the repair in Rentman."

And: "There is no existing list. I have to manually search Rentman's lost equipment and repairs lists within the maintenance tab. Or, rely on the warehouse team to manually notify me of any M&D items."

## The outcome Will wants
- **Who:** Will (Senior Technical Supervisor, kit), with Sam able to see it.
- **The job it serves:** after each job comes back, Will needs the final missing and damaged list so he can (1) check the warehouse in case an item was simply missed, (2) inspect each repair himself, (3) decide whether to invoice the client, repair, or something else, and (4) have a reference when he contacts the client. The HubSpot M&D ticket to the client is written afterwards by hand from a template; that stays as it is.
- **The problem today:** Will searches Rentman's lost equipment and repairs lists by hand, or waits for the warehouse to tell him. Things slip and it takes time.
- **How often:** most days there is a project with something reported; at least several a week.

## What already exists
- **The board already knows when a sub-job is fully checked in.** Since 18 Nov 2026 the Team Dashboard keeps a kit check-in log (one record per sub-job, written by the Kit Prep refresh, no extra Rentman calls). It records when a job was first seen out, first seen dropped off and all checked back in. It tracks sub-jobs, not whole projects, so "whole project back" is a small addition on top.
- **Timing.** The Kit Prep refresh reads Rentman every 10 minutes on weekdays 07:00 to 19:00 London time, with no timed reads evenings, nights and weekends (someone editing a job in Rentman still refreshes it at any hour). A project checked in on Saturday is normally seen at 07:00 on Monday.
- **A pattern to copy.** The board already posts a "Kit overdue" Slack alert off the same Kit Prep reads: once per job, no new scheduled job, and on its first run it notes what already exists and posts nothing, so the channel isn't flooded.
- **How the warehouse records M&D (from Will).** On the Zebra scanners, a missing item is swiped and given the "lost" icon: Rentman checks it in, adds it to the Lost equipment tab and keeps the project in its "Name (project)" field. Damage works the same way with the repair icon, and the warehouse may add a Remark saying what needs looking at. So every entry is tied to its project, and lost kit counts as checked in.
- **HubSpot M&D.** Accepting a ticket as Missing & Damaged takes it off the dashboard and Will works it in HubSpot (16 Sep 2026). Unchanged by this.
- **What's missing.** None of the apps reads Rentman's lost equipment or repairs lists, or item serial numbers and QR codes. There is no M&D channel and no Chased button.

## What to build
All in the Team Dashboard, alongside the Kit Prep refresh and its existing Slack alerts.

1. **Spot when a whole project is back.** A project counts as returned when every one of its sub-jobs is fully checked in, using the existing check-in log. If one sub-job is still out, nothing posts until it returns, however long that takes.
2. **Check for M&D only then.** When a project is first seen fully back, read Rentman's lost equipment and repairs entries tied to that project. If there are none, post nothing. When it was marked does not matter: everything Rentman ties to the project counts.
3. **Post one message per project** to the new **M&D** Slack channel, showing:
   - job name and number, and a link that opens the project in Rentman;
   - **Lost** items: item name, quantity, QR code, manufacturer's serial number;
   - **Damaged** items: item name, quantity, QR code, manufacturer's serial number, and the Remark entered with the repair.
   Kit with no QR code or serial number (cables, clamps booked as a quantity) shows the name and quantity with a dash for the codes.
4. **Once per project, final.** Anything marked lost or for repair after the board has posted for that project sends nothing; Will handles those by hand.
5. **Chased button**, one per post. Anyone in the channel can press it; the post then shows who pressed it and when, with an Undo. No reminders: posts without a tick are Will's to-do list. Pressing it changes nothing in Rentman or HubSpot.
6. **Switch-on.** Only projects that come back after it is switched on get a post; no catch-up on older ones (same as the overdue alert's first run).

## Decisions made in the grilling
- **What the list is for:** Will's warehouse double-check, repair inspection, invoice-or-repair decision and reference for contacting the client.
- **Where it lands:** a new Slack channel, not a DM, email or dashboard screen.
- **Channel name:** "M&D". Members to begin with: Will and Sam. Jamie creates it and adds the app.
- **Button:** one per job, called "Chased", anyone in the channel can press it, shows who and when, with Undo. No reminders.
- **How missing kit is recorded:** always marked lost on the scanners, never left unscanned; the existing "Kit overdue" alert covers anything that is. Nothing extra goes to the M&D channel for unscanned kit.
- **Trigger:** the whole project returned (all sub-jobs), not each sub-job. Fine to wait however long the last sub-job takes.
- **Only if anything is M&D:** no post for clean projects.
- **What counts:** every lost and repair entry tied to the project. Will dropped the earlier "ignore anything marked at other times": the time of marking doesn't matter.
- **Marked after return:** nothing is sent; handled by hand.
- **Fields:** job name and number, Rentman link, item, quantity, QR code, manufacturer's serial number, Remark on repairs; dash where there is no code.
- **Weekends and evenings:** posting at 07:00 the next weekday is fine.
- **Start:** no catch-up on older projects.
- **HubSpot:** no connection; M&D tickets stay manual.

## Not doing
- **Client name, account manager tag, "who scanned it":** offered, not wanted. Will contacts the client himself and account managers aren't in the channel.
- **Cross-hire or consignor flags:** cross-hired kit isn't marked in Rentman, and consignor kit is treated exactly like FOMO kit.
- **One button per item:** one per job is enough.
- **Reminders on unchased posts:** the channel is the to-do list.
- **Per sub-job posts, or posting after part of a project has been back a set number of days:** Will wants the whole project.
- **Follow-up updates for entries added after return:** Will assesses those by hand.
- **Filtering by when an item was marked:** dropped by Will.
- **A DM, email or a new dashboard screen:** the channel was chosen.
- **Any HubSpot link or ticket creation:** not needed; templates are quick by hand.
- **Catch-up on older projects.**

## Needs Jamie
- **More Rentman calls (shared quota).** New reads of the lost equipment and repairs lists, and of item QR codes and manufacturer's serial numbers. Only when a project is first seen fully back, a few times a day, but it is still new load on the shared quota and needs Jamie's OK.
- **Rentman: read only.** Nothing is written to Rentman, which keeps within the Team Dashboard's "must never write to Rentman".
- **A new Slack channel, and who sees it.** Jamie creates the channel, adds the dashboard's Slack app, and adds Will and Sam. The channel's ID is something only a person can supply for the build.
- No deal money, customer emails, HubSpot or Xero writes, payment status, new scheduled job or deleting data.

## Open questions
1. **Can Rentman's API give us this?** Confirm the lost equipment and repairs entries can be read with their project link ("Name (project)"), quantity and the repair Remark, and that the item's QR code and manufacturer's serial number can be read alongside. If any of these can't be read, the post would show a dash or need rethinking.
2. **The Rentman call budget** for those reads, within the shared quota.
3. **Channel name.** Slack channel names can't contain "&", so "M&D" exactly isn't possible; Jamie to pick the nearest (for example #m-and-d or #m-d).
4. **The Chased button.** The board's Slack app posts alerts and listens to #venue-hire-drafts; confirm it can also take button presses, or what is needed for that.
5. **Sub-jobs that never come back.** Not discussed: a cancelled sub-job, or one with no kit, would never show as checked in and so would hold the whole project's post forever. Jamie to decide whether those should be ignored when deciding the project is back.

## How we'll know it works
- On a weekday, within about 10 minutes of the last sub-job of a project being fully checked in, a post appears in the M&D channel if anything on it was marked lost or for repair, showing the job, a working Rentman link, and each item with quantity, QR code, serial (or a dash) and the repair Remark.
- A project with nothing lost or damaged produces no post.
- A project with one sub-job still out produces no post until that sub-job is back.
- A project returned in the evening or at the weekend posts at 07:00 the next weekday.
- Pressing Chased shows who and when; Undo clears it.
- No posts appear for projects that were already back before switch-on, and nothing more appears for a project once it has posted.
- For the first couple of weeks Will checks each post against Rentman's Maintenance tab; after that he no longer needs to search it or wait for the warehouse to tell him.