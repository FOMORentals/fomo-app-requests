# App requests: design decisions

Designed with Jamie on 17 Nov 2026 (19 questions, all agreed). The longer write-up is the design doc
https://claude.ai/artifact/XzyLQLrNgBUjrEndwLt6nQ. Keep this file current: when a decision changes,
change it here the same day (rule 7).

## Who and where
- Requests go in Slack **#app-requests**. Threads are visible to the whole channel.
- Only Sam, Louis, Rosie, Will, Margarita and Jamie can request (`lib/config.ts`). Anyone else is told to ask Jamie.

## The mini grill (Jamie, 17 Nov 2026)
- Up to 2 rounds of up to 3 numbered questions, each with a suggested answer, to sharpen the request and
  catch errors of logic. Claude may skip it only when the request is obviously clear. The requester cannot skip it.
- Quiet requester: one nudge after 1 working day, closed after 3 working days, reopened by replying.
  Bank holidays count as working days.

## Checks
- If the app already does it, Claude explains how and nothing is built.
- **If the request contradicts one of Jamie's recorded decisions, Claude quotes it with its date and it
  becomes a proposal for Jamie, even when Sam asked.** Checked on the request and again on the final summary.
- If there is no recorded decision on the topic, Claude says so in the thread and in the approval DM.
- Decisions are read fresh from GitHub at every request: each app's `docs/DESIGN.md` and `CLAUDE.md`.
- The requester taps ✅ on a "Here's what I'll do" summary before anything is built or proposed.

## Small and bigger
- **Small** fixes are built automatically on Team Dashboard, Overtime, What's new and Inventory dashboard.
- **Bigger** requests become proposals only: anything new; deal money, payments or invoices; customer emails;
  Rentman writes or more Rentman calls; HubSpot or Xero writes; logins and who can see what; new scheduled jobs;
  deleting data; anything on Client portal, Website, Kit onboarding (including the Onboarding section of the
  inventory dashboard), Consignor portal or this app; any contradiction.
- **Not offered:** Cloud Function, Gmail connector, Rentman core, Status dashboard.
- Safety net: a "small" build that turns out to touch a bigger area stops and becomes a proposal.

## Approvals
- Sam approves small fixes, including his own. Jamie approves bigger ones and contradictions.
- When Jamie taps "Build it" on a proposal, the finished change comes back to Jamie, not Sam.
- "Build it" is Jamie's go-ahead for the reasons the proposal named (for example extra Rentman calls); the builder
  doesn't stop for those. If it stops for something else, Jamie gets a "Couldn't build" message once, never the same
  proposal again (19 Nov 2026, after Will's Kit Prep initials request came to Jamie three times).
- Sam sees proposals and can comment; Jamie decides.
- **Nothing ships without a tap.** If nobody taps, Sam and Jamie each get one reminder at 9:00 London the
  next working morning.
- What's new announces as usual; Jamie still gets the note by DM first with the 1-hour hold.

## Builds and cost
- Builds run in GitHub Actions with the Claude Code CLI on Jamie's Claude subscription
  (`CLAUDE_CODE_OAUTH_TOKEN`), model Opus 5.5. Switch to a capped API key (£100/month, DM at £80) if his
  limits bite.
- The Slack side uses a small API key on the jamie@fomorentals.co.uk Console org with a spend limit.
- Guard rails: no live keys in builds; builds can't edit `.github/`, `.env` files or `vercel.json`;
  request text is data, not instructions; at most 2 retries per build; at most 3 builds at once.

## Keeping decisions current (Jamie, 17 Nov 2026, all five)
1. Per-app design notes (`docs/DESIGN.md` + `CLAUDE.md`), read fresh at every request.
2. The "Design notes" GitHub check (`templates/design-notes.yml`, copied into each app repo).
3. Decisions made in a chat are written down the same day (engineering rule 7).
4. A Monday sweep compares project memory with the notes and DMs Jamie any gaps.
5. "No recorded decision" is shown in DMs.

## Audit, 19 Nov 2026 (Jamie)
- The questions stay as they are (up to 2 rounds of up to 3, with suggested answers). Jamie: harder questions only if they make a material difference; the first 8 requests showed none. Look again after about 20 requests.
- A change that needs information the design notes don't say the app already has (from Rentman, HubSpot, Xero or anywhere else) is "bigger" and goes to Jamie, never a small fix built on an assumption.
- Small fixes tell the requester Sam checks them; only proposals mention Jamie.
- If the live check for a merged change keeps erroring for 45 minutes, Jamie gets one DM saying why, instead of the error only reaching the logs.
- Changes built side by side can't clash (Jamie, 19 Nov 2026: "as robust as possible"). When a change is approved, the bot checks whether another change to the same files went live after it was built. If so it isn't merged: it's rebuilt on top of the live version (the build robot merges the latest version in and Claude resolves any clash), and comes back for approval. Design notes and team-note pictures don't count as a clash (nearly every change edits them); if GitHub refuses the merge anyway, that also triggers the rebuild. At most twice, then it merges as it is. Chosen over a one-at-a-time queue, which would make a run of requests wait on each approval.

## Things only a person can supply (Jamie, 23 Nov 2026)
- After Louis's "In-house prep" request failed at build because nobody had been asked for the Rentman field's ID:
  when a change needs something only a person can create or look up (most often a Rentman extra input field and its
  ID; also a HubSpot property, a Slack channel, a sheet link, a wording or price), Claude says so in so many words,
  in its own "Before this can be built, I need you to" box, separate from the numbered questions: what to create
  (name, Projects / Contacts / Equipment, type) and where to find the ID (Rentman: Settings, Extra input fields, first
  column). It never guesses one.
- It gets one extra round just for that if the questions used up theirs. The summary shows the value it will use
  ("Using: ... 54") so the requester checks it. Still missing then, the request goes to Jamie as a proposal naming
  what's needed, and his Build it asks him for it before anything is built.
- The value goes to the builder in the issue under "Details the team supplied (use exactly these)"; the builder is
  told never to guess one and to say exactly what's missing if it has to stop.
- "Try again" on a failed build opens a box for anything the build needs this time (e.g. the field ID); it can be left
  empty.

## Request tracker (Jamie, 23 Nov 2026)
- After Friday 20 Nov, when requests came in faster than Jamie could follow away from his desk: #app-requests has a
  **Request tracker** tab (the channel canvas), one row per request: what was asked, who asked, which app, the date,
  the status in plain English and links (thread, preview, PR).
- Grouped by who it's waiting on, in this order: Jamie, Sam, the person who asked, the bot working on it, failed, and
  done in the last 14 days. Requests from the last 30 days, the same window the bot already reads.
- Chosen over a Slack List: a List can be edited by hand and drift from what the bot knows. The canvas is redrawn
  whole from the requests' cards, so the threads stay the single source of truth.
- Event driven: it is redrawn whenever a request moves on. No new scheduled job; the existing 15-minute tick also
  redraws it from what it already reads, to catch up after a failed redraw. It never overwrites a channel canvas the
  bot didn't write.
- The canvas is fixed by `TRACKER_CANVAS_ID` (F0CL1083WJZ); the bot never creates one (23 Nov 2026: Slack didn't
  report the channel's canvas back, so the first version made a second canvas on its next redraw).

## "Why is the app doing this?" questions (Jamie, 20 Nov 2026)
- The team can ask why an app behaves the way it does (something not refreshing as expected, a button not doing
  what they thought) in #app-requests itself, not a separate channel: the answer is often "that's broken, fix it",
  and fixes already live here. Aim: they understand the right process, or they find something to fix and get it done.
- If the design notes clearly answer it, Claude answers straight away. Otherwise it **looks into the app, read only**:
  the "App question" workflow (`templates/app-question.yml`, copied into each app repo next to the build robot)
  reads the code, design notes, recent changes, the live deploy's state and failed GitHub runs. It never changes
  anything and never guesses.
- It answers with one of four findings: **Working as designed** (explains the right process), **Looks broken**
  (with a **Fix it** button; Jamie also gets an FYI DM), **Works, but could be better** (Make it a request), or
  **Couldn't tell from the code** (Ask Jamie).
- **Fix it** turns the question into a normal request with the findings already in the thread: the same summary,
  ✅, small/bigger sorting and approvals as any other request. Nothing new skips Sam's or Jamie's tap.
- Every app the team can ask about can be looked into (Jamie, 20 Nov 2026): Team Dashboard, Overtime, What's new,
  Inventory dashboard, Client portal, Website, Kit onboarding, Consignor portal and App requests itself. Not
  Cloud Function, Rentman core, Gmail connector or Status dashboard: those questions go to Jamie. On a
  proposals-only app, Fix it becomes a proposal for Jamie as usual.
- A question about the Team Dashboard also reads the Cloud Function's code, read only (Jamie, 20 Nov 2026, after
  the first real question, Spike Wright's job 12084 on Needs Ticket Link, came back "Couldn't tell" because the
  matching happens in the Cloud Function's Rentman linker). Fixes there still go to Jamie; questions about the
  Cloud Function on its own still go to Jamie. Whether its last push deployed can't be seen from the look.
  At most 2 looks per question, then Jamie. A look that doesn't report back in 45 minutes goes to Jamie.
- Not yet: the apps' own server logs and refresh times (Vercel, Google Cloud, Firestore). The look says when its
  answer depends on them. Adding them needs read-only access Jamie sets up; a separate decision.

## Website listings, `/list-kit` (Jamie, 23 Nov 2026)
Planned with Jamie in the project thread "Plan Slack tool for new website kit listings" (12 questions, all agreed).
Spec: project file `website-listings/website-listing-tool-spec.md`.
- **For brand new purchases**, and for correcting a listing already live. Kit onboarding is left alone (unfinished).
- **Version 1 only finishes an item someone has already created in Rentman** (name, folder, day rate, stock) and
  given a photo. It never creates Rentman items (the "one step" version is for later) and never uploads photos
  (Rentman's API can't; a robot would need a paid Rentman user).
- **`/list-kit` from any channel**: a Rentman code, id or part of the name, or nothing for "recent ones" (created in
  the last 14 days, not on the website). Cards and approvals live in a new **#website-listings** channel, never in
  #app-requests (the build bot reads everything there).
- **The AI drafts** the name on website (only if different), the short and long descriptions in FOMO's style (copying
  live ones), the camera/lens spec fields and the At a glance rows and tech spec tables, from the manufacturer's own
  website only. "New" is on for new purchases. The AI never sets prices. It fills only blanks: an item already on the
  website starts from what the website shows, and a Brand + Model tech spec page the website already has is reused.
  Model: Haiku (as kit onboarding, Jamie 6 Oct 2026).
- **Anyone on the team** starts and edits a draft (a Slack form). **Only Jamie, Sam or Will** press Publish, Go live
  now and Take off website.
- **Publish refuses** until the item has a photo, a day rate above £0, is in the planner and its folder is under a
  website category, and both descriptions are written; it says what to fix in Rentman, with Check again.
- **Publish** = one Rentman update with only the changed website fields (custom_41-50, both shop descriptions) and
  "visible in webshop" ticked, then a re-read to check it saved. The approver's Publish is also the check of the tech
  spec page, which is saved to the website repo (a pull request merged at once, as kit onboarding does). An edit to a
  live listing shows old next to new and needs Publish again. Publish uses the Rentman writer lease shared with kit
  onboarding.
- **Live** at the next 05:41 website update, or straight away with **Go live now** (approvers, at most 3 a day:
  6 Rentman calls each). After the update the bot says "now live" with the link, or says it didn't appear (and tells
  Jamie).
- **Take off website** unticks "visible in webshop" (approvers), so a mistake can be undone.
- Drafts get one reminder to their owner after 2 untouched days. Nothing touches Rentman before Publish.
- **Rentman budget** (Jamie approved): about 5 calls per listing (find 1-2, draft 1, publish 3), folders and style
  examples cached (a day / a week), plus 6 per Go live now. All through the shared guard.
- This is the first part of this app to call Rentman and Google Cloud (Firestore fomo-bookings-board-v2 for drafts,
  the shared circuit and the writer lease; the website-sync Cloud Run job for Go live now). Drafts live in Firestore,
  not Slack metadata, because long descriptions don't fit there.
