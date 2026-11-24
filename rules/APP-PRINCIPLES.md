# FOMO app principles

Approved by Jamie on 24 Nov 2026. The #app-requests bot reads this file at every request, and every build gets it
with the engineering rules. When a request goes against one of these, the bot names the principle in one line and
offers the better version as its suggested answer. The requester can still say no; the summary then says so for
Sam or Jamie. Principles steer requests; they don't block them.

## What a good change looks like

1. **Start from the outcome.** Ask what the person is trying to get done, who for, and how often, before deciding
   what to build. "Know which quotes to chase today" beats "an export of quotes".
2. **Change what exists before adding something new.** A column, a filter or a better default on a screen people
   already use beats a new screen, report or channel.
3. **One home for each piece of information.** Rentman is the truth for kit and jobs, HubSpot for deals and
   contacts, Xero for money. Apps show it; they don't keep a second copy that can drift. If it's already on one
   screen, link to it rather than copying it to another.
4. **Fewer clicks beats another button.** Prefer a sensible default, or the app doing it automatically, over an
   option someone has to remember to press.
5. **No new pings without an owner.** A new message, reminder or alert names who acts on it and what they do. If
   nobody would act on it, it isn't sent. Prefer a daily digest to a ping each time.
6. **Shared screens change for everyone.** If others use the screen, the request names who else is affected, and a
   preference one person has doesn't override the way the rest of the team works. Clashing preferences go to Jamie.
7. **Clients see less, not more.** Nothing internal (costs, margins, other clients, staff notes) ever reaches a
   client or consignor screen. When unsure, leave it off.
8. **Nothing fails silently.** If the change can go wrong (a sync, a send, a calculation), someone finds out when
   it does.
9. **Small, reversible steps.** Prefer a change that can be tried for a week and undone, over a big one that's hard
   to back out.

## House style

General design good practice (clear labels, readable text, helpful empty and error messages) is left to Claude,
which already knows it. These lines are only what it can't guess: how FOMO's apps look and read, so they stay
alike as they grow.

1. **Match what's there.** A new table, button, date or status looks like the ones already in that app, and across
   apps where they share one (Team Dashboard is the reference). No new colours, fonts or styles for one change.
2. **The same word for the same thing everywhere.** Use Rentman's names for kit and jobs, and the words the team
   already uses on screen: job, quote, kit, consignor, enquiry.
3. **UK English, plain and short.** Dates as 24 Nov 2026, times in UK time, money as £1,250. Buttons say what they
   do ("Send reminder", not "Submit").
4. **Most useful first.** Screens open on today or what needs doing now; totals and counts are shown, not hidden
   behind a click.
5. **Client and consignor screens look like FOMO.** The brand colours, fonts and logo those screens already use;
   calm and simple; no internal jargon.
6. **Warehouse TV is read from across the room.** Big text, few words, colour for status.
