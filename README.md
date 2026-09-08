# Matchday

A personal, installable web app that reminds you ~1 hour before your teams'
matches kick off, with a spot to pick your teams and browse the schedule.
Built entirely on free tiers — no App Store, no monthly cost.

**Tracks:** Premier League, La Liga, Serie A, Bundesliga, Ligue 1, and NBA
— reminders only for the teams you pick. **Champions League is different
on purpose:** every CL match notifies, regardless of which teams you've
picked, since that's what you asked for.

**How it's built:** a small installable web app (PWA) hosted on GitHub
Pages, a tiny Cloudflare Worker that remembers your notification settings,
and a GitHub Actions job that checks fixtures every 15 minutes and fires a
real push notification to your phone when kickoff is close.

**Lineups, honestly:** the kickoff reminder is a hard "~1 hour before,
always." Lineups are a *second*, later notification, because of how the
data actually becomes available — Highlightly (the data source) only makes
football lineups queryable starting 40 minutes before kickoff, confirmed
sometime between then and just after kickoff. For NBA, Highlightly's own
docs are vaguer — just "up to a few hours before" — so that check runs over
a wider window and fires the moment a lineup shows up. There's no source
that reliably has a confirmed lineup a full hour out, so rather than fake
it, you get: "kickoff in ~1h" on schedule, then "lineups are in" whenever
they're actually posted.

**Two separate Highlightly accounts, on purpose:** football and NBA are
different Highlightly products, each with its own free 100-requests/day
quota. Using two separate keys means a heavy NBA night can't eat into
football's budget, or vice versa.

---

## What you'll need (all free)

- A GitHub account
- A Cloudflare account (Workers + KV — no credit card required)
- A free API key from [Highlightly's Football API](https://highlightly.net/football-api/) (covers PL, La Liga, Serie A, Bundesliga, Ligue 1, Champions League)
- A free API key from [Highlightly's NBA & NCAAB API](https://highlightly.net/nba-api/) (separate signup, separate quota)
- Your iPhone, with Safari

## Setup

### 1. Push this code to a new GitHub repo

Create a new repo on GitHub (public is fine and free), then from this
folder:

```bash
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Turn on GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Source: Deploy from
a branch → Branch: `main`, folder: `/frontend`**. Save. GitHub will give you
a URL like `https://YOUR_USERNAME.github.io/YOUR_REPO/` — that's the app.

### 3. Generate your VAPID keys (for real push notifications)

VAPID keys are how your Worker proves to Apple/Google's push servers that
it's allowed to send to your phone. Generate a pair locally:

```bash
npm install
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

This prints a `publicKey` and `privateKey`. Save both somewhere safe — you
need them in the next two steps.

### 4. Deploy the Cloudflare Worker

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler kv namespace create matchday_kv
```

Copy the namespace `id` it prints into `worker/wrangler.toml` (replace
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`). Then set your secrets — pick your own
`AUTH_TOKEN` (just a password you make up, used so random people can't hit
your Worker):

```bash
wrangler secret put AUTH_TOKEN
wrangler secret put VAPID_PUBLIC_KEY
wrangler deploy
```

Wrangler will print your Worker's URL, like
`https://matchday-backend.YOUR-SUBDOMAIN.workers.dev`. Save it.

### 5. Wire the frontend up to your Worker

Open `frontend/app.js` and fill in the three placeholders at the top:

```js
const WORKER_URL = "https://matchday-backend.YOUR-SUBDOMAIN.workers.dev";
const VAPID_PUBLIC_KEY = "the publicKey from step 3";
const APP_SECRET = "the same AUTH_TOKEN you set in step 4";
```

Commit and push this change.

### 6. Add your GitHub Actions secrets

In the repo: **Settings → Secrets and variables → Actions → New repository
secret**. Add each of these:

| Secret name | Value |
|---|---|
| `WORKER_URL` | your Worker URL from step 4 |
| `WORKER_SECRET` | the same `AUTH_TOKEN` from step 4 |
| `HIGHLIGHTLY_FOOTBALL_KEY` | your Highlightly Football API key |
| `HIGHLIGHTLY_NBA_KEY` | your Highlightly NBA & NCAAB API key |
| `VAPID_PUBLIC_KEY` | from step 3 |
| `VAPID_PRIVATE_KEY` | from step 3 |
| `VAPID_SUBJECT` | `mailto:your-email@example.com` (any real-looking email) |

If you only set up one of the two Highlightly keys, that's fine — the
script skips any sport whose key isn't set rather than failing.

### 7. Install it on your iPhone

Visit your GitHub Pages URL in **Safari** (must be Safari, not Chrome) →
tap the Share icon → **Add to Home Screen**. Open Matchday from the icon
on your home screen (not from Safari — push only works from the installed
icon on iOS). Go to the **Teams** tab, pick your teams, then tap **Enable**
on the Fixtures tab and allow notifications.

### 8. Test it

In your repo, go to **Actions → Check fixtures and send reminders → Run
workflow** to trigger it manually instead of waiting for the schedule. Check
the run's logs to see what it found.

---

## How the quota is managed

Each Highlightly product (football, NBA) has its own free 100-requests/day
pool. Rough math for the default setup:

**Football** (6 competitions: PL, La Liga, Serie A, Bundesliga, Ligue 1, CL):
- Schedule refresh: ~4 days lookahead × 6 competitions = ~24 requests,
  every 8 hours (3×/day) = **~72 requests/day**.
- Lineup checks only happen for matches that are yours (or Champions
  League, which is always "yours"). Each match gets checked at most a
  handful of times as kickoff approaches, and stops once found.
- On a normal week this stays comfortably under 100/day. On a night with
  several Champions League matches at once, lineup checks add up faster —
  if you start seeing failures, raise `SCHEDULE_REFRESH_HOURS` or lower
  `LOOKAHEAD_DAYS` in `scripts/check-fixtures.mjs`.

**NBA** (1 league, separate quota):
- Schedule refresh: ~4 days × 1 league = ~4 requests, 3×/day = **~12
  requests/day**. Lineup checks only run for your picked teams' games, so
  there's plenty of headroom left in the 100/day pool.

Checking "is a match near enough to notify" itself costs **zero**
requests — it's just comparing the current time to kickoff times already
cached in `frontend/fixtures.json`.

## Adding more leagues/sports

`frontend/app.js` has a `LEAGUES` array — that's just what shows up as
choices in the Teams tab, and the team names there need to match what
Highlightly calls them (check `frontend/fixtures.json` after a run — if a
team you picked never shows up in "Upcoming", the spelling doesn't match).

`scripts/check-fixtures.mjs` has a `SPORTS` array. To add another football
league, add an entry to the `football` sport's `leagues` array with its
name and country — the script resolves and caches the numeric id
automatically. To flip a league to "notify for every match" like Champions
League, set `notifyMode: "all"`. To add a whole new sport, copy the
`basketball` block and point it at that sport's own Highlightly API (each
sport is its own product with its own base URL and its own key) —
ask for help wiring one in once you know which sport you want next.
