# Stock take in the Inventory dashboard
**Asked by:** Will Royal, 2026-11-26 · **App(s):** Inventory dashboard (new Stock take section) · **Slack thread:** https://team-fomo-hq.slack.com/archives/C0CKKHG4BQQ/p1795623500504819

## In one paragraph
Rentman's stock numbers are wrong, mostly because of poor processes in the past. Kit gets booked when we are actually short, and parts of combinations such as cables run out, so jobs can't be fully booked out. This hits bookings and the warehouse alike. Will wants a stock take in the Inventory dashboard. The team scans every QR-coded serial on the Zebras, types a total for each loose item, and gets a printable missing-kit report sorted by Rentman folder, with list values. They search for what's missing, re-report, and Will, Sam or Jamie sign off a final report. The team then corrects Rentman by hand from that report. It runs once a year as a full count, and as smaller counts (for example all SDI and HDMI cables) whenever needed. The app never writes to Rentman. It needs Jamie's OK for the extra Rentman reads and for keeping outside guests out of it.

## Started as
Will's proposal, in his words (shortened): "I'd like to solve a problem where we currently have no way to perform a stock take of all items in the warehouse... a method that enables the team to perform a stock take of all items (both serialised and bulk) that are listed in Rentman. To be used both on the Zebra scanner and desktop if possible (scanning on the Zebras, admin and printing docs from the desktop). The goal is to verify the exact stock that FOMO has of all items and correct discrepancies in Rentman."

He described:
- Three statuses: To Check (split into bulk and serialised), Checked and To Onboard.
- Bulk items counted by typing a number.
- Serialised items scanned one by one.
- An unknown QR prompts for a description and goes to To Onboard.
- A first count produces a printable missing-items report with name, serial, QR and value, which can be remade at any time.
- A final count produces a saved report used to fix Rentman by hand.
- Lost Equipment counts as checked automatically; kit in Repairs is counted like everything else.
- Serials on jobs count as checked.
- Serials added or removed during the count show up by themselves.

## The outcome Will wants
- **Who it's for:** the warehouse (Will, Margarita) and the bookings team (Sam, Louis, Rosie), who book against Rentman's quantities.
- **The job it serves:** knowing exactly what FOMO owns, so Rentman stops letting kit be booked that isn't on the shelf, and combinations aren't left short of parts such as cables.
- **How often:**
  - One full count of everything once a year.
  - Smaller counts whenever a group of items needs checking, for example SDI and HDMI cables.
- Will says new processes should now stop Rentman drifting. The yearly and ad-hoc counts are the check that it stays right.

## What already exists
- **No FOMO app does a stock count.**
  - The Inventory dashboard reads Rentman for fleet numbers and never changes Rentman (its app card says so).
  - Kit Prep and Will's M&D list only look at kit on jobs.
- **Rentman's own count feature** is desktop only, doesn't work on the Zebras and only counts quantities, not serial numbers (Will).
- **Zebra scanning into a FOMO web page already works.** The goods-in page in the Inventory dashboard's Onboarding section (Kit onboarding) takes Zebra scans: the scanner types each scan into the page and it beeps. Kit onboarding itself is parked as a work in progress (Jamie, 24 Nov 2026), but the scanning method is proven.
- **What Rentman can tell us** (the M&D list already reads it):
  - every QR-coded serial with its QR code, serial and whether it is switched on;
  - serials marked lost, which Rentman switches off;
  - kit in repair;
  - each serial's last job.
  - All serials can be read 1,500 records at a time, so a full read is a handful of Rentman calls.
- **Telling whether kit went out during a count:** Kit Prep already logs when each job is first seen out and when it is all checked back in, with no extra Rentman calls. Together with each serial's last job, that may be enough to tell whether a serial went out on a job since a count started. To be confirmed when building.
- **Values:** Rentman holds a list value once per item type (for example "Sony FX6"), not per serial. Kit onboarding treats it as the insurance value, usually 10 to 20% above purchase price. Loose kit has only a total quantity and prices.
- **Writing serials to Rentman:** Will asked us to verify this.
  - Kit onboarding's October testing found that Rentman's connection can *create* serial records. The hand-picked label number goes in the record's Reference field, with the maker's serial, purchase cost and date.
  - Whether the QR then comes out as the label number was never tried live.
  - No FOMO app has ever removed or switched off a serial through the connection; kit onboarding was built never to delete.
  - So app-made corrections are unproven, and they are not part of this version.
- **Access:** anyone with a FOMO Google login can open the Inventory dashboard. Named outside guests can be let in to look only. The dashboard shows money figures such as purchase prices and payback.
- **Missing:** anything that counts serials or quantities against Rentman on the Zebras and produces a missing-kit report.

## What to build
A new **Stock take** section in the Inventory dashboard. Scanning happens on the Zebras, using the same method as the goods-in page. Starting counts, reports and printing happen on a desktop.

1. **Start a count** (Will, Sam or Jamie only).
   - **Full count:** everything in Rentman, except the top level of virtual combinations (not a physical item). Their parts are still counted. Physical combinations, consigned kit (treated exactly like FOMO kit), kit in repair and items hidden from the planner or website are all included. Every serial and every loose item is counted separately; a case's QR doesn't count what's inside it.
   - **Smaller count:** search for items and tick them in.
   - While a full count is open, no other count can run. Several smaller counts can run at once, as long as no item is in two of them.
2. **Statuses.** Each count has To Check (two lists: QR-coded and loose), Checked and To Onboard.
   - A QR-coded item moves to Checked once all its serials are checked.
   - A loose item moves to Checked once a number is typed in.
3. **QR-coded kit is counted by scanning on a Zebra.** These count as checked automatically:
   - serials Rentman has switched off as lost;
   - serials scanned out on a job at any point since the count started, even if they have since come back. Only kit actually scanned out counts, not kit merely booked.
4. **Scan messages:**
   - **Same QR scanned twice:** "already checked", and nothing changes.
   - **Item not in this count** (for example a lens in a cable count): a different beep and "not in this count, ignored".
   - Neither message interrupts counting.
   - **Unknown QR:** the app checks Rentman first, in case the serial was added minutes ago. If Rentman doesn't have it either, a pop-up asks for a description, and the QR and description go on To Onboard.
   - **Serial Rentman has marked lost:** the scanner shows the same "already checked" message, and the report tags the serial "lost item found, switch back on".
5. **Loose kit is counted by typing a number.**
   - The counter types the *total FOMO owns*, adding in what's out on jobs themselves.
   - The screen shows "Rentman: 20, out on jobs now: 6" as a help, but the app adds nothing to the typed number.
   - The number can be edited later, including once the item is in Checked.
6. **Reports** (Will, Sam or Jamie only).
   - Making a report refreshes from Rentman first. A new report can be made at any time after the first count is submitted.
   - The report can be printed like a packing list and is sorted by Rentman folder, so whoever searches can walk the warehouse in order.
   - **One combined missing list** of QR-coded and loose kit together:
     - a QR-coded item shows name, QR code, serial and list value;
     - a loose item shows name, Rentman quantity, counted quantity, number short and value (list value × number short).
   - Loose items with no number yet show as "not counted yet".
   - **Total missing value** at the bottom, covering missing and short items only.
   - **"To add to Rentman"** part underneath, covering:
     - loose kit counted over Rentman's quantity;
     - the To Onboard items;
     - lost items found ("switch back on").
7. **After the first count is submitted**, anyone counting can tick a serial as found by hand, for example kit away for repair. No reason is needed and it counts the same as a scan. This option does not exist while the first count is still open.
8. **Refresh from Rentman button.**
   - Anyone counting can press it. It picks up serials added to or removed from Rentman during the count, so the To Check and Checked lists stay current.
   - At most once every 10 minutes per count; otherwise it says "refreshed 3 minutes ago, try again in 7".
   - There is no automatic daily refresh.
9. **Final sign-off** (Will, Sam or Jamie only).
   - It locks the count and saves the final report with the date and who signed it off. The report can be printed.
   - Loose items still "not counted yet" appear on it, so the team can decide whether we still own them and, if not, remove them from Rentman by hand.
   - Every line on the saved report gets a **"Done in Rentman"** tick, so whoever corrects Rentman can see what's left.
   - Past counts stay in the app as a history.
10. **Smaller counts follow exactly the same steps:** first count, missing report, search, final sign-off with a saved report.
11. **Rentman is corrected by hand** from the final report. The team switches off missing serials, adds To Onboard items, corrects loose quantities, switches found lost items back on, and removes items no longer owned. The app never writes to Rentman.
12. **Who can use it:** anyone with a FOMO Google login can scan, type numbers and see the whole dashboard. Outside look-only guests are kept out of the stock take (Jamie's call, see below).

## Decisions made in the grilling
- **The problem:** kit booked when we're short because Rentman's quantities are wrong, including parts of combinations such as cables. It affects bookings and the warehouse.
- **Why it drifts:** mainly poor processes in the past. New processes should keep it right, and the counts check that they do.
- **How often:** a full count once a year, plus ad-hoc smaller counts.
- **Scope of the tool:** both QR-coded and loose kit, not Rentman's own count for loose kit.
- **Counting while the warehouse works:** the warehouse carries on as usual. QR-coded kit scanned out on a job since the count started counts as checked. Loose kit is left to the counter, who types the total owned.
- **Correcting Rentman:** by hand for now, "to ensure accuracy" (Will). App-made corrections are a later option for Jamie.
- **Cases and combinations:** every part is counted separately. Every serial and loose item in Rentman needs checking.
- **Choosing items for a smaller count:** search and tick (not folders).
- **Value:** replacement cost, which is Rentman's list value.
- **Report layout:** one combined list sorted by Rentman folder, total for missing or short only, and a "To add to Rentman" part underneath.
- **Consigned kit:** treated like FOMO kit, no separate flag.
- **Ticking serials by hand:** anyone can, only after the first count is submitted, no reason needed, treated like a normal scan.
- **Where it lives:** the Inventory dashboard, next to the goods-in scanning that already works.
- **Who does what:** anyone scans and types. Only Will, Sam or Jamie start a count, make reports or sign off.
- **Counts at the same time:** a full count runs alone. Smaller counts can run side by side if they share no items.
- **Refreshing from Rentman:** a button, limited to once every 10 minutes as a safety net, plus a refresh when a report is made, plus the instant check on an unknown QR. No automatic daily refresh.
- **Lost kit found:** the same "already checked" message, plus a report tag to switch it back on.
- **Loose items not counted:** shown as "not counted yet", so the team can decide if we still own them.
- **What's counted:** everything in Rentman except the top level of virtual combinations.
- **Wrong or repeat scans:** a different beep and "not in this count, ignored" for an item outside the count; "already checked" for a repeat.
- **After sign-off:** the count locks, the report is saved, each line gets a "Done in Rentman" tick, and the history is kept.
- **Access:** no guests. Counters see the full dashboard, with no other limit.

## Not doing
- **The app correcting Rentman** (switching off serials, adding serial records, setting quantities): Will chose manual changes for now, for accuracy. Removing serials through Rentman's connection has never been tested, and whether a created record keeps its QR label was never tried live.
- **Rentman's own count for loose kit:** it doesn't work on the Zebras, and one tool with one report is simpler.
- **The app adding "out on jobs" to a loose count:** risk of counting kit twice. The counter types the total owned instead.
- **Counting a case's contents from the case's QR:** it proves the case is here, not the cables inside it.
- **Picking a Rentman folder for a smaller count:** Will chose search and tick.
- **Separate report sections for QR-coded and loose kit:** Will wants one combined list.
- **Flagging consigned kit:** not needed for this count.
- **A reason, or a separate "ticked by hand" section, for serials ticked without scanning:** Will said treat it like normal scanning.
- **Ticking serials by hand during the first count:** only allowed after it's submitted.
- **An automatic daily refresh:** the button is enough, and it would be a new scheduled job.
- **Limiting counters to the stock take screen only:** Will sees no need.
- **A Team Dashboard tab:** it belongs with fleet numbers.

## Needs Jamie
- **More Rentman calls** (shared quota):
  - building each count (all serials, 1,500 a page, plus loose items, folders, lost and repair state);
  - each Refresh from Rentman press, at most once every 10 minutes per count;
  - the refresh when a report is made;
  - the instant check on an unknown QR;
  - the "out on jobs now" figure for loose kit;
  - whatever is needed to tell that a serial went out on a job since the count started (possibly none, if Kit Prep's existing log and each serial's last job are enough).
  - Each should be a handful of calls. Jamie to OK the budget.
- **Rentman reads from the Inventory dashboard:** today the dashboard makes no Rentman calls itself; its data comes from the inventory worker in the Team Dashboard's code. The builder needs Jamie's steer on how the stock take reads Rentman (through the shared guard).
- **Who can see and do what:**
  - Keep outside look-only guests out of the stock take.
  - Only Will, Sam and Jamie can start counts, make reports and sign off.
  - Margarita and others will now use the dashboard and see its money figures (purchase prices, payback). The app card lists only Jamie, Sam and Will as users, so it needs updating with Jamie's OK.
- **Reusing the goods-in scanning method** from the Onboarding section (Kit onboarding), which Jamie has parked. Requests touching it are Jamie's.
- **No Rentman writes, no deleting by the app, no new scheduled job, no customer emails, no deal money, no HubSpot or Xero.** Removing items from Rentman stays a manual job for the team.
- **Any future step where the app writes to Rentman.** It would need a live test first: creating a serial record with a QR label, and switching one off.

## Open questions
1. Is the Rentman call budget above acceptable, and is once every 10 minutes per count the right limit for the Refresh button?
2. Should outside guests be kept out of the stock take (Will's wish), and is it fine for every team member to see the whole Inventory dashboard, including money figures?
3. Can "scanned out on a job since the count started" come from Kit Prep's existing log plus each serial's last job in Rentman, or does it need extra Rentman reads? For the builder to confirm.
4. May the stock take reuse the goods-in Zebra scanning while Kit onboarding is parked?
5. Later: should the app make the Rentman corrections itself, one approved tap per line, once a live test proves serials can be created with the right QR label and switched off?

## How we'll know it works
- Will starts a small count (say SDI and HDMI cables) from a desktop. Margarita scans QR-coded items on a Zebra and hears a beep for each.
- A repeat scan says "already checked". An item outside the count gets a different beep and "not in this count, ignored".
- Kit that went out on a job during the count, and kit marked lost in Rentman, shows as Checked without being scanned.
- Loose items show "Rentman: 20, out on jobs now: 6" and accept a typed total.
- An unknown QR asks for a description and lands on To Onboard. A QR added to Rentman minutes earlier is recognised instead.
- Will makes a first report:
  - one list sorted by folder, with names, QRs, serials, quantities and list values, and a missing total at the bottom;
  - a "To add to Rentman" part underneath;
  - "not counted yet" lines for loose items with no number.
  - He prints it and searches.
- Found items are scanned or ticked by hand, and a new report shows the shorter list.
- Will signs off. The count locks, the report is saved with his name and the date, and each line has a "Done in Rentman" tick as the team fixes Rentman by hand.
- After the yearly count and Rentman corrections, bookings and the warehouse stop hitting shortages that Rentman didn't show.