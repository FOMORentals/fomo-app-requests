/**
 * The "How #app-requests works" part of the channel's one tab (Jamie, 24 Nov 2026: one door, one tap, one tab).
 * It is drawn on top of the Request tracker in the same canvas, on every redraw (lib/tracker.ts), so a change
 * to how the bot works reaches the tab at the next redraw (at most 15 minutes after it goes live), with no
 * GitHub Actions and no new scheduled job.
 *
 * The numbers come from the bot's own settings. The words are the one hand-written part: when the team-facing
 * flow changes, howto.test.ts fails until this text has been checked and HOWTO_REVIEWED_FOR updated.
 * Jamie, 24 Nov 2026: no list of apps and no /list-kit here.
 */
import { MAX_QUESTIONS, MAX_ROUNDS } from "./config";

/** Fingerprint of the team-facing flow this text was last checked against (see howto.test.ts). */
export const HOWTO_REVIEWED_FOR = "e01df7396e134782";

/** Pure, tested. Canvas markdown. */
export function howToMarkdown(): string {
  return [
    "# How #app-requests works",
    "",
    "**Post one message here, in your own words.** Something broken, something you want changed, an idea, or \"why does the app do this?\". A screenshot helps. The bot works out the rest: which app, how big, and who needs to OK it.",
    "",
    "1. **The bot says how it read you and how big it looks**, and asks just enough questions for that size (see below), each with a suggested answer (\"1 yes\" is fine).",
    "2. **You tap ✅ on its summary.** That's your only tap.",
    "3. **Quick fixes and changes are built** in 10 to 20 minutes and checked by Sam or Jamie before going live. **New ideas** end as a written plan that goes to Jamie.",
    "4. **The status line at the top of your thread** always shows where it's at. You're only pinged when you need to do something.",
    "",
    "**How many questions?** It depends on the size the bot gives your request:",
    "- :large_green_circle: **Quick fix** (typo, wording, a broken button): one question at most, often none.",
    `- :large_yellow_circle: **Change** (a column, a filter, a reminder): up to ${MAX_QUESTIONS} questions at a time, up to ${MAX_ROUNDS} rounds.`,
    "- :red_circle: **New idea** (a new screen, report or routine): Sam decides if it gets the full interview, as many rounds as it takes.",
    "- If your answers show it's bigger than it looked, the bot says so and moves it up a size.",
    "",
    "**Asking why an app does something?** The bot looks into the app (it never changes anything) and tells you whether it's working as designed or looks broken. If it's broken, tap Fix it.",
    "",
    "**Tips:** say what you were trying to do, not only what went wrong. If the bot gets you wrong, just reply in the thread. If you go quiet it nudges you after a working day and closes the request after three; reply to reopen it. Changes that go live are announced in #whats-new.",
  ].join("\n");
}
