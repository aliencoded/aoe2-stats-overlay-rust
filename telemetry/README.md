# Telemetry Worker (Cloudflare Workers + D1)

Counts **active installs** of AoE2 Insta Scout. The app pings `POST /check` on
boot (only when the in-app telemetry toggle is ON), which logs one anonymous
row per install per day and returns the newest release version (so this one
request also drives the update banner).

**What's collected:** a random per-install UUID, the app version, and `"win"`.
**Never collected:** Steam ID, profile, player name, match data, IP-as-identity.

## One-time deploy

```sh
cd telemetry
npm i -g wrangler            # or use: npx wrangler ...

wrangler login

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
wrangler d1 create insta-scout-telemetry

# 2. Create the table (remote = production D1)
wrangler d1 execute insta-scout-telemetry --remote --file schema.sql

# 3. Set the stats token (any long random string — you'll use it to read /stats)
wrangler secret put STATS_TOKEN

# 4. Deploy — note the printed URL, e.g. https://insta-scout-telemetry.<you>.workers.dev
wrangler deploy
```

## Wire the app

Put the deployed URL into `src/main.js`:

```js
const TELEMETRY_URL = 'https://insta-scout-telemetry.<you>.workers.dev';
```

Leave it `''` and the app always uses the GitHub API directly (no telemetry) —
safe default until you've deployed.

## Read your numbers

**Dashboard (UI)** — open in a browser, auto-refreshes every 60s:
```
https://insta-scout-telemetry.<you>.workers.dev/dashboard?token=YOUR_STATS_TOKEN
```
Cards (installs / active today / active 30d), a daily-active bar chart, and a by-version table — all distinct-install-ID counts.

**JSON:**
```sh
curl "https://insta-scout-telemetry.<you>.workers.dev/stats?token=YOUR_STATS_TOKEN"
```

```json
{
  "installs": 0,        // COUNT(DISTINCT id) all-time
  "dau": 0,             // distinct installs seen today (UTC)
  "mau": 0,             // distinct installs in the last 30 days
  "byVersion": [ { "version": "0.3.0", "c": 0 } ]
}
```

Ad-hoc queries:

```sh
wrangler d1 execute insta-scout-telemetry --remote \
  --command "SELECT day, COUNT(DISTINCT id) FROM pings GROUP BY day ORDER BY day DESC LIMIT 30"
```

## Free-tier headroom

Workers 100k req/day; D1 100k writes/day, 5M reads/day. One write per
install/day means tens of thousands of daily actives fit free. The GitHub
`latest` lookup is cached 1h via the Workers Cache API.
