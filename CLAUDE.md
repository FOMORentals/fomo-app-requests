# fomo-app-requests

Read `../FOMO-ENGINEERING-RULES.md` first when it is there (a copy for the build robot is in
`rules/FOMO-ENGINEERING-RULES.md`; change both). Jamie is not an engineer: explain in business terms.

What this is: the team asks for app changes in Slack #app-requests. Claude asks a few questions, checks the
request against Jamie's recorded decisions, and either answers it, looks into the app's code to answer a "why is the app
doing this?" question (read only, 20 Nov 2026), builds a small fix (a GitHub issue in the
app's repo that the "App request build" workflow turns into a pull request for Sam to approve), or sends a
proposal to Jamie. Designed with Jamie on 17 Nov 2026. Decisions are in `docs/DESIGN.md`; keep it current.
Setup: `docs/SETUP.md`.

- `lib/config.ts` people, apps (build / proposal / not offered), limits.
- `lib/prompt.ts` what Claude is told and the answer's shape; `enforce` applies the hard rules in code.
- `lib/handlers.ts` Slack messages, buttons, forms, build reports. `lib/actions.ts` side effects.
- `lib/tick.ts` the 15-minute cron (nudges, reminders, queued builds, timeouts, live checks).
- `lib/tracker.ts` the Request tracker tab (the channel canvas), redrawn whenever a request's card is saved.
- `lib/elsewhere.ts` spots requests finished outside the bot (a merged pull request does it) and marks them done, with Undo.
- `lib/records.ts` the request's state, stored as metadata on the bot's card in the thread (Slack is the database).
- `templates/` the workflows copied into each app repo: `app-request-build.yml` (the build robot),
  `app-question.yml` (the old per-repo look; questions now go to the private repo FOMORentals/fomo-app-questions,
  which also reads live data read only, Jamie 25 Nov 2026, and reports to `/api/question/callback`) and
  `design-notes.yml` (the "Design notes" check).

- `lib/grill/` Sam's grill (`/grill`, Jamie 23 Nov 2026): Matt Pocock's grilling skill word for word
  (`grill/skills/`), multi-turn in an #app-requests thread, spec DM'd to Jamie and saved in `specs/`. Never builds.
  Also runs on a team member's request that's a new idea, once Sam taps Grill it (right-sized grilling, 23 Nov 2026).
- `lib/listings/` website listings (`/list-kit`, Jamie 23 Nov 2026): the AI drafts a new purchase's website fields,
  the team edits them, Jamie, Sam or Will publish. Its Rentman call budget is at the top of `lib/listings/rentman.ts`.

External calls: Slack, GitHub, Anthropic. Website listings only also call Rentman (through `@fomo/rentman-core`'s
guard, vendored in `vendor/`), Firestore fomo-bookings-board-v2 and the website-sync Cloud Run job. Nothing else.
Before saying done: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

Every PR description has a `## Team note` section (see the PR template). It is what the team reads in
#whats-new: a headline, what changed, what they do differently, a picture added in the same PR under
`whats-new/`, always (a screenshot, or a mock-up or diagram/workflow when there is nothing to screenshot;
"to follow" and "None" are not accepted, and the "Team note picture" check fails without one), and a link.
Write `None` when the team won't notice the change.

## Design notes
Jamie's decisions for this app are in `docs/DESIGN.md`, with who made each and when. Claude reads it at every
#app-requests request, so it must be current: when a decision is made or changed (in a pull request, in a chat
with Jamie, anywhere), write it there the same day (rule 7). Every pull request either updates it or says under
`## Design notes` "No decision changed: <why>"; the "Design notes" check fails otherwise.
