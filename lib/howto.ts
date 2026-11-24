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
    "**You can do two things here.** Post one message in your own words and the bot works out which one it is.",
    "",
    ":mag: **Ask why an app does something.** Something isn't refreshing, a button does the wrong thing, a number looks off. Start with \"?\" or \"why\". The bot looks into the app (it never changes anything) and tells you whether it's working as designed or looks broken. If it's broken, tap Fix it and it becomes a change.",
    "",
    ":hammer_and_wrench: **Ask for a change.** Something broken, something that slows you down, or an idea.",
    "",
    "**Describe the problem, not the fix.** Say what you were trying to do, what got in the way, who it affects and how often. Leave the fix to the bot: it knows what the apps already do, and the best fix is often not the first one that comes to mind. \"Every morning I can't tell which quotes need chasing\" works better than \"add an export of quotes\". A screenshot of what you use today helps.",
    "",
    "Then:",
    "1. **The bot says how it read you and how big it looks**, and asks just enough questions for that size (see below), each with a suggested answer (\"1 yes\" is fine). Answer honestly, \"I don't know\" included.",
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
    "**Tips:** if the bot gets you wrong, just reply in the thread. If you go quiet it nudges you after a working day and closes the request after three; reply to reopen it. Once Jamie, Sam or anyone else joins the conversation, the bot steps back and leaves you to talk; mention @App requests to bring it back. Changes that go live are announced in #whats-new.",
  ].join("\n");
}
