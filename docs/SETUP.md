# Setup (one-off, Jamie)

About 30 minutes. Nothing goes live until step 7.

1. **Slack channel.** Create `#app-requests` (public). Add Sam, Louis, Rosie, Will and Margarita. Copy its
   channel ID (channel name → About → bottom).
2. **Slack app.** https://api.slack.com/apps → Create New App → From an app manifest → paste
   `docs/slack-app-manifest.yml` (replace APP_URL with https://fomo-app-requests.vercel.app). Install to the
   workspace. Copy the Bot token (`xoxb-…`) and the Signing secret. In `#app-requests`: `/invite @App requests`.
3. **Claude login token for builds.** On the Mac: `claude setup-token`, sign in with your Claude account, copy
   the token. This makes builds use your subscription, not an API key.
4. **GitHub token** (signed in as FOMORentals; the build robot only accepts requests opened by that account).
   github.com → Settings → Developer settings → Fine-grained tokens → Generate. Resource owner FOMORentals.
   Repositories: fomo-bookings-board-v2, fomo-overtime, fomo-whats-new, fomo-inventory-dashboard (where it
   builds) plus fomo-app-requests and every repo in `lib/config.ts` (to read their design notes).
   Permissions: Contents **Read and write**, Issues **Read and write**, Pull requests **Read and write**,
   Commit statuses **Read** (how the app sees a change go live). Longest expiry; put a calendar reminder to renew.
5. **GitHub secrets.** FOMORentals is a personal account (no organisation secrets), so add these to **each** of
   the four build repos (repo → Settings → Secrets and variables → Actions → New repository secret):
   - `CLAUDE_CODE_OAUTH_TOKEN`: the token from step 3
   - `APP_REQUESTS_GH_TOKEN`: the token from step 4
   - `APP_REQUESTS_CALLBACK_SECRET`: any long random string (also `BUILD_CALLBACK_SECRET` below)
6. **Anthropic API key** for the Slack side: console.anthropic.com (jamie@fomorentals.co.uk org) → API keys →
   new key "app-requests". Set a monthly spend limit (£10 is plenty).
7. **Vercel.** New project from FOMORentals/fomo-app-requests, team fomo12, region lhr1. Environment variables
   (Production, Sensitive), names as in `.env.example`:
   `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `REQUESTS_CHANNEL_ID`, `GITHUB_TOKEN` (step 4),
   `ANTHROPIC_API_KEY` (step 6), `BUILD_CALLBACK_SECRET` (same as step 5), `CRON_SECRET` (any long random
   string), `APP_URL`, `SENTRY_DSN`. Deploy. Then in the Slack app's Event Subscriptions page, check the
   request URL shows "Verified".
8. **What's new.** Give its GitHub token read access to fomo-app-requests, so changes to this app are announced.
9. **Inventory previews.** In Vercel, project fomo-inventory-dashboard → Settings → Environment Variables: add `GOOGLE_WORKSPACE_DOMAIN` = `fomorentals.co.uk` for **Preview** (it is set for Production only, so every preview build fails and Sam would get no preview link).
10. **Merge** the "App requests: build robot and design notes" pull requests in the four app repos.

Try it: post a small request in `#app-requests` yourself.

## Questions ("why is the app doing this?", 20 Nov 2026)

The "App question" workflow uses two secrets: `CLAUDE_CODE_OAUTH_TOKEN` and `APP_REQUESTS_CALLBACK_SECRET` (same values
as the build repos). The four build repos already have them. Add both to fomo-client-portal,
fomo-rentals-website-rebuild, fomo-kit-onboarding, fomo-consignor-portal and fomo-app-requests (repo → Settings →
Secrets and variables → Actions). `templates/app-question.yml` is copied to `.github/workflows/app-question.yml` in
all nine repos.
Until a repo has it, a question about that app opens an issue nobody answers, and after 45 minutes it goes to Jamie.
All nine set 20 Nov 2026; the callback secret was rotated that day on all nine and Vercel `BUILD_CALLBACK_SECRET`
(Production), so the two must be changed together.

Team Dashboard questions also read fomo-cloud-function: a read-only deploy key on fomo-cloud-function (Settings →
Deploy keys, "app-question read only", write access off) whose private half is the secret `CLOUD_FUNCTION_READ_KEY`
on fomo-bookings-board-v2. Without it the look still runs on the board's code alone and says it couldn't read
the Cloud Function.

## Website listings, `/list-kit` (23 Nov 2026)

Nothing changes for #app-requests until these are done; `/list-kit` simply isn't there yet.

1. **Slack channel.** Create `#website-listings` (public), add the team, `/invite @App requests`, copy its channel ID.
2. **Slack command.** api.slack.com/apps → FOMO App requests → App Manifest: add the `commands` scope and the
   `slash_commands` block from `docs/slack-app-manifest.yml`, save, and reinstall the app when Slack asks.
3. **Google service account** `app-requests-listings` (project clever-acolyte-298614), with:
   - `roles/datastore.user` on project fomo-bookings-board-v2 (drafts, the shared Rentman circuit and writer lease,
     the website's search index);
   - `roles/run.jobsExecutorWithOverrides` on the Cloud Run job `website-sync` (project fomo-rentals-website,
     europe-west2) for Go live now, as the `website-sync-scheduler` account has.
   Create a JSON key and store it base64-encoded, never in a file in the repo.
4. **Vercel** (fomo-app-requests, Production, Sensitive): `LISTINGS_CHANNEL_ID` (step 1), `FIREBASE_SERVICE_ACCOUNT_BASE64`
   (step 3), `RENTMAN_TOKEN` (the same Rentman API token the website sync uses, Secret Manager `RENTMAN_TOKEN` in
   fomo-rentals-website), `RENTMAN_CALLER_LABEL` = `app-requests-listings` (how its calls show in the daily Rentman
   counter), and optionally `WEBSITE_URL` (default https://www.fomorentals.co.uk). Redeploy.
5. **GitHub token.** The app's `GITHUB_TOKEN` already has Contents and Pull requests read and write on
   fomo-rentals-website-rebuild (step 4 above); publishing a tech spec page uses it. Nothing to add unless it was
   narrowed.

Try it: `/list-kit` with nothing after it shows kit added in the last 14 days.

Cut-out photos (23 Nov 2026 evening): the app needs Slack's `files:write` permission (already in the manifest for
Sam's grill: reinstall if it isn't granted yet). The workflow uses this repo's `APP_REQUESTS_CALLBACK_SECRET` (set
20 Nov) and the app's `GITHUB_TOKEN` (Contents write on this repo starts it). Try it: drop a photo in a card's thread.

## Sam's grill, `/grill` (23 Nov 2026)

Nothing changes for anyone until these are done; `/grill` simply isn't there yet.

1. **Slack.** api.slack.com/apps → FOMO App requests → App Manifest: add the `/grill` entry under `slash_commands`
   and the `files:write` scope from `docs/slack-app-manifest.yml`, save, and reinstall the app when Slack asks.
2. **Claude API key.** It uses the existing `ANTHROPIC_API_KEY`. A grill reads app code with Opus, so it costs more than a
   request; raise the key's monthly spend limit in console.anthropic.com if it's still at £10.
3. **GitHub token.** Nothing to add: it already reads every app's repo and writes to fomo-app-requests (specs are saved in
   `specs/`).

Try it: Sam types `/grill` and an idea anywhere in Slack; the grill opens in #app-requests.
