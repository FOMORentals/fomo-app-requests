---
name: "fomo-weekly-sales-review"
description: "Build the FOMO bookings team's weekly sales review pack (HTML + PDF) from HubSpot, run Wednesdays before the 11:00 UK bookings meeting."
---

# FOMO weekly sales review

A weekly pack for the bookings team meeting (Wednesdays 11:00 UK; Jamie is on SAST, UTC+2). HTML is the main output, with a PDF copy. Both come from `build_review.py`.

## Source files (Weekly Sales Reviews project Library, `/mnt/project-files/`)
- `HANDOVER.md`: full background and history. Read it first if anything here is unclear.
- `build_review.py`: the builder. It owns all the maths and layout. Always use the current Library copy, because other threads edit it. Don't change it unless asked.
- `last_run.json`: the ledger (cutoff plus deal IDs already counted).
- `weekly-sales-review-handover/review-2026-11-04/` (`raw.py`, `make_json.py`, `input.json`): template for a week's inputs.
- `review-2026-11-11/followup.json`: template for the follow-up box.
- `review-2026-11-19/`: template for the 12-week trend section. It holds `demand_raw.py` + `demand.py` (quotes), `conv_raw.txt` + `conv.py` (win rate and discount), `ly_*.tsv` + `ly_winrate.py` (last year's win rate and discount), `bands.json` (win rate by order size) and `followup.json`. Its `build_review.py` is the first builder with the trend section, the follow-up box and the trend insights. If the Library `build_review.py` lacks `demand_section` or `followup_section`, use this copy (or merge them in) and save the result to the Library.
- `FOMO-Overview.md`: business context.

Put each week's files in `/mnt/project-files/review-YYYY-MM-DD/`.

## Coverage rule (no gaps, nothing counted twice)
1. Pull deals with `closedate >= <ledger cutoff date>` and `hs_is_closed = true`.
2. Drop every ID already in `last_run.json -> counted_deal_ids`.
3. After building, write a new `last_run.json` with the new cutoff (the pull time) and this pack's IDs.

The UK is on GMT from late October to late March, so UK time = UTC then.

## Steps
1. **Closed deals:** use `search_crm_objects` on DEAL. Properties: `dealname, amount, discount_pct, discount_total, rental_gross_profit, rental_gross_margin_pct, hs_is_closed_won, reason_for_loss, reason_for_loss__notes, closedate`.
2. **Company type:** `SELECT hs_object_id, dealname, COMPANY.name, COMPANY.company_type FROM DEAL WHERE closedate >= '<date>' AND hs_is_closed = 'true'`. Flag `company_type = "Rental House"` as `RH` (cross-hire). Use nothing else to decide trade.
3. **Owner and first response (GBP 500+ deals):** `SELECT linked_deal_id, hubspot_owner_id, hs_time_to_first_response_in_operating_hours FROM TICKET WHERE linked_deal_id IN (...)`. The time is in ms; divide by 3,600,000 to get hours. A deal with no ticket shows as owner "Unassigned".
4. **Client budgets for losses:** read the loss notes first, then the email thread (`search_conversations`).
5. **Pipeline:** open deals (`hs_is_closed = false`) with `amount >= 500` and `usageperiod_start` from today to today + 28 days. Properties: `usageperiod_start/end, rental_gross_margin_pct, discount_pct`.
6. **Follow-up box:**
   - Cohort: won GBP 1k+ jobs, not trade.
   - For each job, read every email we sent to the client's contacts, on any ticket, from day 0 to day 7 after the job ended (Jamie's rule from 19 Nov 2026: follow-ups should happen within 7 days of a job finishing).
   - Label each job:
     - `followed up`: we started the email to ask how it went, thank them, get feedback or a review, or offer the next job.
     - `admin`: invoices, missing or damaged kit, payments, returns, or replies to their admin questions. Warm wording inside a template still counts as admin.
     - `none`: no contact.
   - Also note "rebooked within 30 days".
   - The cohort is jobs whose 7-day window closed since the last meeting, plus jobs whose window is still open. Leave out windows that closed before the last meeting.
   - The pack shows only the definition, a headline line (jobs whose window closed this week, plus open-window jobs done so far) and an owner table. Keep the per-job labels and quotes in `followup.json` for checking, not in the pack.
7. **Trend - 12 weeks (top of the pack, agreed with Jamie 19 Nov 2026):**
   - Weeks run Thursday to Wednesday. Use the 12 complete weeks ending the Wednesday before the meeting. "Last year" is the same week 364 days earlier.
   - Exclude trade by running every query twice, once for all deals and once with `COMPANY.company_type = 'Rental House'`, and subtracting. Use `COUNT(*)`, never `COUNT(hs_object_id)` (that sums the IDs). Group by `DATE_TRUNC(..., 'DAY')` and bin the days into weeks in Python.
   - **Chart 1, quotes:** a quote is a deal created with `amount > 0`, not trade. This matches the Looker "New quotes" figure (Oct 2026: 202). Query: `SELECT DATE_TRUNC(createdate,'DAY'), COUNT(*), SUM(amount) FROM DEAL WHERE createdate >= '<start>' AND createdate < '<end>' AND amount > 0 GROUP BY DATE_TRUNC(createdate,'DAY')`, for this year and for last year. Show bars for this year and a line for last year. £ quoted goes in the caption only.
   - **Chart 2, win rate:** won / (won + lost) by `closedate`, `amount > 0`, not trade. Query: `SELECT DATE_TRUNC(closedate,'DAY'), hs_is_closed_won, COUNT(*), SUM(amount), SUM(discount_total) FROM DEAL WHERE closedate >= ... AND hs_is_closed = 'true' AND amount > 0 GROUP BY ...`, for this year and for last year. Show bars, a line for last year and a dashed line at the 57% target. Under the chart, add a win-rate-by-order-size table (<£250, £250–750, £750–2k, £2k+) for this week and for the 12 weeks.
   - **Chart 3, discount:** won orders only, weighted and off list: Σ discount_total / Σ(amount + discount_total). It comes from the same query. Show bars, a line for last year and a dashed line at the 35% ceiling.
   - **"What the trend says":** write 4 or 5 short bullets under the charts in `demand.insights`, each starting with a bold plain-English headline. Cover demand compared with last year, win rate compared with last year and the target, the weakest order-size band, and discount compared with last year and the ceiling.
   - Tickets can't be compared with last year, because ticket categories only started in June 2026.
8. **Pipeline health - 12 weeks (sits just above the open orders list, agreed with Jamie 19 Nov 2026):**
   - For each of the same 12 Thursday-to-Wednesday weeks, count the open-order book at the end of the Wednesday. That means deals created by that day and still open at the end of it (closed later, or still open now), with `usageperiod_start` in the next 28 days, amount >= 500 and not Rental House. Last year uses the Wednesday 364 days earlier.
   - Pull the rows with three queries. 1) `SELECT hs_object_id, createdate, closedate, usageperiod_start, amount, COMPANY.company_type FROM DEAL WHERE usageperiod_start >= '<first week end + 1>' AND usageperiod_start < '<last week end + 29>' AND amount >= 500 AND hs_is_closed = 'true' AND closedate >= '<first week end + 1>'`. 2) The same with `hs_is_closed = 'false'`, with closedate dropped. 3) Query 1 shifted 364 days back for last year. Each returns about 300 rows. Remove duplicate IDs (a deal with two companies appears twice), and treat it as trade if any of its rows is Rental House.
   - Template: `review-2026-11-19/pipe/` (`ty_closed.txt`, `ty_open.txt`, `ly_closed.txt`, `pipe.py` writes `pipe.json`). Put it in `input.json -> pipeline_trend` as `weeks`, `lead` and 3 `insights`.
   - The pack shows two charts, the number of open orders and their value, each with a line for last year, then 3 bullets. Check that this week's number matches the open orders list.
   - HubSpot keeps no snapshots, so say in the lead that the history is rebuilt from created and closed dates.
9. **Inputs:**
   - Copy `raw.py` and `make_json.py` from the template, then fill in this week's deals, notes, reads, pipeline, verdict and talking points.
   - Run `python3 make_json.py`. This produces `input.json` and the new `last_run.json`.
   - Add the `pipeline_trend` key, and the `followup` key (from `followup.json`: `definition` plus `jobs` with name, ended, owner, label, closed, rebooked and evidence) and the `demand` key (`weeks` from `demand.json`, plus `bands`, `lead` and `insights`).
10. **Build:** `python3 /mnt/project-files/build_review.py input.json FOMO-Sales-Review-YYYY-MM-DD` writes the `.html` and `.pdf`. The PDF needs Playwright and Chromium. If the Python module is missing, render the PDF with Node Playwright (`chromium.launch()`, `page.pdf` A4, print background, 14/12 mm margins).
11. **Check:** screenshot the render and look at it. Then deliver the HTML and PDF, and update the ledger in the Library.

## What counts toward the KPIs (same filters as the HubSpot Conversion dashboard)
- Exclude:
  - Rental House counterparties. Dark Chamber Media and Panavision are confirmed trade.
  - Amount <= 0.
  - Names containing "test".
  - Speculative quotes (reason for loss "Speculative quote"). These are shown in the table but not counted.
  - Duplicates and rebuilds, such as one quote split into days.
- List every exclusion in the "excluded" note so nothing disappears silently.
- **Month to date:** add each pack's rows for the current month to the previous pack's `month` lists.

## Config (`input.json -> config`)
- KPI and table settings: `big` 2000, `detail` 500, `t_overall` 57, `t_big` 37, `t_disc` 35, `t_margin` 70, `walk_floor` 40, `match_floor` 70.
- `show_pace` false (old pace chart, parked).
- `show_gp` false (GP vs target strip, parked by Jamie on 11 Nov).

## GP vs target strip (parked, ready to switch on)
- To use it: set `show_gp: true` and add a `gp` key.
- Template: `review-2026-11-11/gp.json`.
- **Targets:** monthly rentals GP from "2026 FOMO CF and Budget.xlsx" (Drive), P&L BDG Inputs tab. Take rentals income minus rentals cost of sales.
- **Actuals:** SUM(`rental_gross_profit`) of closed-won deals by close month.
- **Periods:** calendar month, calendar quarter, calendar year. Refresh the current month just before building.

## Decisions already made (don't reopen)
- Quarters are calendar quarters.
- GP is counted on deals by close or won date.
- Follow-up is measured by Claude reading the emails, with no team workflow change.
- The trend section has exactly three charts (quotes, win rate, discount), each against the same week last year, followed by short insight bullets. Jamie prefers year-on-year to month-on-month and is not tied to the Looker KPI dashboard (19 Nov 2026).

## Style Jamie wants
- Concise, with short plain sentences and no em dashes.
- A different colour for each owner badge. Section numbers count up automatically, so parked sections leave no gap.
- Losses table uses a fixed layout.
- About six watch-outs and talking points.
- Footnote: when the data was pulled, the window, the exclusions, and that one week is a small sample.