// AoE2 Insta Scout — telemetry + update-check Worker (Cloudflare Workers + D1).
//
// Routes:
//   POST /check  { id, v, os }  -> logs ONE row per install per day to D1,
//                                  returns { latest } (newest GitHub release tag).
//   GET  /stats?token=SECRET    -> { installs, dau, mau, byVersion }.
//
// Privacy: `id` is a RANDOM client-generated UUID (see installId() in main.js).
// We never receive a Steam ID, profile, player name, or match data — only the
// anonymous install id, the app version, and a coarse OS tag. The app only
// calls this Worker when the telemetry toggle is ON; when OFF it talks to the
// GitHub API directly and this Worker never sees it.

const GH_LATEST = 'https://api.github.com/repos/aliencoded/aoe2-stats-overlay-rust/releases/latest';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // --- boot ping: log + return latest version ---------------------------
    if (url.pathname === '/check' && req.method === 'POST') {
      let body = {};
      try { body = await req.json(); } catch (_) {}
      const id = String(body.id || '').slice(0, 64);
      const v = String(body.v || '').slice(0, 16);
      const os = String(body.os || '').slice(0, 16);
      // Only accept a plausible UUID-shaped id; ignore anything else.
      if (/^[0-9a-fA-F-]{8,64}$/.test(id) && env.DB) {
        const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
        ctx.waitUntil(
          env.DB.prepare(
            'INSERT INTO pings (id, day, version, os) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(id, day) DO UPDATE SET version = excluded.version, os = excluded.os'
          ).bind(id, day, v, os).run().catch(() => {})
        );
      }
      const latest = await getLatest(ctx);
      return json({ latest }, CORS);
    }

    // --- owner stats: JSON (token-gated) ----------------------------------
    if (url.pathname === '/stats' && req.method === 'GET') {
      if (!env.STATS_TOKEN || url.searchParams.get('token') !== env.STATS_TOKEN) {
        return new Response('forbidden', { status: 403, headers: CORS });
      }
      if (!env.DB) return json({ error: 'no DB binding' }, CORS);
      const s = await queryStats(env);
      return json(s, CORS);
    }

    // --- owner dashboard: HTML page (token-gated) -------------------------
    if (url.pathname === '/dashboard' && req.method === 'GET') {
      if (!env.STATS_TOKEN || url.searchParams.get('token') !== env.STATS_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      if (!env.DB) return new Response('no DB binding', { status: 500 });
      const s = await queryStats(env);
      return new Response(renderDashboard(s), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    return new Response('AoE2 Insta Scout telemetry worker', { headers: CORS });
  },
};

// Newest GitHub release tag, cached 1h via the Workers Cache API (avoids
// hammering GitHub's unauthenticated rate limit from the shared egress IP).
async function getLatest(ctx) {
  const cache = caches.default;
  const cacheKey = new Request('https://insta-scout-cache/latest');
  const hit = await cache.match(cacheKey);
  if (hit) return await hit.text();
  let tag = '';
  try {
    const r = await fetch(GH_LATEST, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'insta-scout-worker' },
    });
    if (r.ok) {
      const d = await r.json();
      tag = (d.tag_name || '').replace(/^v/, '');
    }
  } catch (_) {}
  ctx.waitUntil(cache.put(cacheKey, new Response(tag, { headers: { 'Cache-Control': 'max-age=3600' } })));
  return tag;
}

async function queryStats(env) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const installs = await env.DB.prepare('SELECT COUNT(DISTINCT id) AS c FROM pings').first('c');
  const dau = await env.DB.prepare('SELECT COUNT(DISTINCT id) AS c FROM pings WHERE day = ?').bind(today).first('c');
  const mau = await env.DB.prepare('SELECT COUNT(DISTINCT id) AS c FROM pings WHERE day >= ?').bind(monthAgo).first('c');
  const byVersion = (await env.DB.prepare(
    'SELECT version, COUNT(DISTINCT id) AS c FROM pings WHERE day >= ? GROUP BY version ORDER BY c DESC'
  ).bind(monthAgo).all()).results;
  const perDay = (await env.DB.prepare(
    'SELECT day, COUNT(DISTINCT id) AS c FROM pings GROUP BY day ORDER BY day DESC LIMIT 30'
  ).all()).results;
  return { installs: installs || 0, dau: dau || 0, mau: mau || 0, byVersion, perDay };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDashboard(s) {
  const days = [...s.perDay].reverse(); // oldest → newest for the chart
  const max = Math.max(1, ...days.map(d => d.c));
  const bars = days.map(d => {
    const h = Math.round((d.c / max) * 100);
    return `<div class="bar" title="${esc(d.day)}: ${d.c}"><span style="height:${h}%"></span><em>${esc(d.day.slice(5))}</em></div>`;
  }).join('');
  const verRows = (s.byVersion.length ? s.byVersion : [{ version: '—', c: 0 }]).map(v =>
    `<tr><td>${esc(v.version || '—')}</td><td class="n">${v.c}</td></tr>`).join('');
  const card = (label, val) => `<div class="card"><div class="v">${val}</div><div class="l">${label}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Insta Scout — installs</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.4 system-ui,Segoe UI,sans-serif;background:#15171c;color:#e7e9ee;padding:28px}
  h1{font-size:18px;font-weight:600;margin:0 0 4px}
  .sub{color:#8a909c;font-size:13px;margin-bottom:24px}
  .cards{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:28px}
  .card{background:#1e2128;border:1px solid #2a2e37;border-radius:12px;padding:18px 22px;min-width:140px}
  .card .v{font-size:34px;font-weight:700;color:#7fb2ff}
  .card .l{color:#8a909c;font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-top:4px}
  h2{font-size:13px;color:#8a909c;text-transform:uppercase;letter-spacing:.06em;margin:24px 0 10px}
  .chart{display:flex;align-items:flex-end;gap:4px;height:140px;background:#1e2128;border:1px solid #2a2e37;border-radius:12px;padding:14px 14px 26px}
  .bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;position:relative}
  .bar span{width:100%;max-width:22px;background:linear-gradient(#7fb2ff,#3a6fb0);border-radius:3px 3px 0 0;min-height:2px}
  .bar em{position:absolute;bottom:-20px;font-style:normal;font-size:9px;color:#6b7280;white-space:nowrap;transform:rotate(0)}
  table{border-collapse:collapse;min-width:240px;background:#1e2128;border:1px solid #2a2e37;border-radius:12px;overflow:hidden}
  td{padding:9px 16px;border-top:1px solid #2a2e37}
  tr:first-child td{border-top:0}
  td.n{text-align:right;font-variant-numeric:tabular-nums;color:#7fb2ff;font-weight:600}
  .foot{color:#5b616e;font-size:11px;margin-top:24px}
</style></head><body>
  <h1>AoE2 Insta Scout — installs</h1>
  <div class="sub">Unique installs = distinct anonymous install IDs. Auto-refreshes every 60s.</div>
  <div class="cards">
    ${card('Installs (all-time)', s.installs)}
    ${card('Active today', s.dau)}
    ${card('Active 30d', s.mau)}
  </div>
  <h2>Daily active (last ${days.length || 0} days)</h2>
  <div class="chart">${bars || '<span style="color:#5b616e">no data yet</span>'}</div>
  <h2>By version (30d)</h2>
  <table>${verRows}</table>
  <div class="foot">Distinct-ID counts from D1. Re-launches dedupe per day. Refreshes on its own.</div>
  <script>setTimeout(()=>location.reload(),60000)</script>
</body></html>`;
}

function json(obj, headers) {
  return new Response(JSON.stringify(obj), {
    headers: { 'content-type': 'application/json', ...headers },
  });
}
