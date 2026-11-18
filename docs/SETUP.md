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
