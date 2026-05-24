// Tauri 2 shim — recreates the old Electron preload `window.api` surface.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

window.api = {
  getSteamId: async () => {
    try { return await invoke('steam_id'); }
    catch (e) { return { error: String(e) }; }
  },
  fetchMatch: async (id) => {
    try { return await invoke('fetch_match', { steamId: id }); }
    catch (e) { return { error: String(e) }; }
  },
  onRefresh: (cb) => listen('refresh', () => cb()),
  onClickThrough: (cb) => listen('click-through', (e) => cb(e.payload)),
  onMode: (cb) => listen('mode', (e) => cb(e.payload)),
  onMatchPartial: (cb) => listen('match-partial', (e) => cb(e.payload)),
  quit: () => invoke('quit_app'),
  setMode: (m) => invoke('set_mode', { mode: m }),
  openExternal: (url) => invoke('open_external', { url }),
  getVersion: () => invoke('app_version'),
  openLogFolder: () => invoke('open_log_folder'),
};

const $players = document.getElementById('players');
const $status = document.getElementById('status');

let steamId = null;
let polling = false;
let timer = null;
let countdownTimer = null;
let nextRefreshAt = 0;
let baseStatus = '';

function setStatus(s) { baseStatus = s; renderStatusLine(); }

function renderStatusLine() {
  if (nextRefreshAt && Date.now() < nextRefreshAt) {
    const secs = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
    $status.textContent = `${baseStatus} · next ${secs}s`;
  } else {
    $status.textContent = baseStatus;
  }
}

function scheduleCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = setInterval(renderStatusLine, 1000);
}

function renderEmpty(msg) {
  $players.innerHTML = `<div class="empty">${msg}</div>`;
}

function renderSelfBar(s) {
  if (!s) return '';
  const r1 = s.rank1v1 || {}, rt = s.rankTG || {};
  return `
    <div class="selfbar">
      <span class="me">YOU</span>
      <span class="nm">${escapeHtml(s.name)}</span>
      ${s.civ ? `<span class="g">[${escapeHtml(s.civ)}]</span>` : ''}
      <span class="r">1v1 ${r1.rating ?? '—'}${r1.rank ? `#${r1.rank}` : ''}</span>
      <span class="r">TG ${rt.rating ?? '—'}${rt.rank ? `#${rt.rank}` : ''}</span>
      ${selfProfileLinks(s)}
    </div>`;
}

function selfProfileLinks(s) {
  const c = s.profileId;
  if (!c) return '';
  return `<span class="profile-links inline">
    <a href="https://www.aoe2companion.com/players/${encodeURIComponent(c)}" target="_blank" rel="noopener noreferrer">view on companion</a>
  </span>`;
}

function playerKey(p) {
  return `card-${(p.profileId || p.name || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function cardHtml(p, isAlly) {
  const r1 = p.rank1v1 || {};
  const rt = p.rankTG || {};
  const loading = p.loading;
  const placeholder = (s) => `<span class="g">${s}</span>`;

  const topCivs = (p.topCivs || []).map(c =>
    `<div class="civ"><span>${escapeHtml(titleCase(c.civ))}</span><span class="g">${c.games}g${c.winrate != null ? ` · ${c.winrate}%` : ''}</span></div>`
  ).join('') || `<div class="civ">${loading ? placeholder('loading…') : placeholder('no civ data')}</div>`;

  const recentCounts = (p.recentCivCounts || []).map(c =>
    `<div class="civ"><span>${escapeHtml(titleCase(c.civ))}</span><span class="g">${c.games}× · ${c.winrate ?? '?'}%</span></div>`
  ).join('') || `<div class="civ">${loading ? placeholder('loading…') : placeholder('no recent data')}</div>`;

  const lastCivs = (p.lastCivs || []).map(m => {
    const wl = m.won === true ? 'W' : m.won === false ? 'L' : '·';
    const cls = m.won === true ? 'w' : m.won === false ? 'l' : '';
    const diff = m.ratingDiff != null ? (m.ratingDiff > 0 ? `+${m.ratingDiff}` : `${m.ratingDiff}`) : '';
    const when = m.started ? relTime(m.started) : '';
    return `<div class="civ"><span><span class="wl ${cls}">${wl}</span> ${escapeHtml(titleCase(m.civ) || '?')}</span><span class="g">${escapeHtml(m.map || '')} ${diff}${when ? ` · ${when}` : ''}</span></div>`;
  }).join('') || `<div class="civ">${loading ? placeholder('loading…') : placeholder('no recent matches')}</div>`;

  const roleCls = isAlly ? 'ally' : 'opp';
  const roleLabel = isAlly ? 'ALLY' : 'OPP';
  const loadCls = loading ? ' card-loading' : '';
  return `
    <div class="card card-${roleCls}${loadCls}" id="${playerKey(p)}">
      <div class="name"><span class="role ${roleCls}">${roleLabel}</span> ${escapeHtml(p.name)} ${p.civ ? `<span class="g">[${escapeHtml(p.civ)}]</span>` : ''}</div>
      <div class="ratings">
        <span><span class="lbl">1v1</span>${r1.rating ?? (loading ? '…' : '—')}${r1.rank ? ` (#${r1.rank})` : ''}</span>
        <span><span class="lbl">TG</span>${rt.rating ?? (loading ? '…' : '—')}${rt.rank ? ` (#${rt.rank})` : ''}</span>
      </div>
      <div class="meta">${r1.games ?? '?'} games · ${r1.winrate ?? '?'}% wr · streak ${r1.streak ?? '?'}</div>
      <div class="sect">Top picks (this format, last 60)</div>
      <div class="civs">${topCivs}</div>
      <div class="sect">Recent picks (last 20, any format)</div>
      <div class="civs">${recentCounts}</div>
      <div class="sect">Last 5 matches</div>
      <div class="civs">${lastCivs}</div>
      ${profileLinks(p)}
    </div>
  `;
}

function profileLinks(p) {
  const c = p.profileId;
  if (!c) return '';
  return `<div class="profile-links">
    <a href="https://www.aoe2companion.com/players/${encodeURIComponent(c)}" target="_blank" rel="noopener noreferrer">view on companion</a>
  </div>`;
}

function getSelf(snap) {
  return snap?.self_ || snap?.self || (snap?.players || []).find(p => p.isSelf) || null;
}

function renderPlayers(snap) {
  const players = snap.players || [];
  const opponents = players.filter(p => !p.isSelf);
  const self = getSelf(snap);

  if (!opponents.length) { renderEmpty('No opponents parsed.'); return; }

  const selfTeam = self?.team || null;
  const selfHtml = renderSelfBar(self);
  const cards = opponents.map(p => cardHtml(p, selfTeam && p.team === selfTeam)).join('');
  $players.innerHTML = selfHtml + cards;
}

function upsertPlayer(player) {
  const self = getSelf(currentSnap);
  const isAlly = self && self.team && player.team === self.team;
  if (player.isSelf) {
    const old = document.querySelector('.selfbar');
    const html = renderSelfBar(player);
    if (old) old.outerHTML = html;
    else $players.insertAdjacentHTML('afterbegin', html);
    return;
  }
  const id = playerKey(player);
  const old = document.getElementById(id);
  const html = cardHtml(player, isAlly);
  if (old) old.outerHTML = html;
  else $players.insertAdjacentHTML('beforeend', html);
}

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

function titleCase(s) {
  if (!s) return s;
  return String(s).split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

let currentSnap = null;

async function refresh() {
  if (polling) return null;
  polling = true;
  try {
    if (!steamId) {
      const r = await window.api.getSteamId();
      if (typeof r === 'string') steamId = r;
      else { setStatus(`steam: ${r.error}`); return null; }
    }
    setStatus('fetching…');
    const snap = await window.api.fetchMatch(steamId);
    if (snap.error) { setStatus(`err: ${snap.error}`); return null; }
    if (!snap.players || !snap.players.length) {
      setStatus(snap.reason || 'no match');
      renderEmpty('No recent match. Queue up and stats will appear.');
      currentSnap = snap;
      return snap;
    }
    const when = snap.fetchedAt ? new Date(snap.fetchedAt).toLocaleTimeString() : '';
    const tag = snap.cached ? 'cached' : 'fresh';
    const live = snap.inMatch ? 'LIVE' : 'LAST';
    setStatus(`${live} · ${tag} ${when}`);
    document.body.classList.toggle('last-match', !snap.inMatch);
    if (!snap.cached) renderPlayers(snap);
    else if (!document.querySelector('.card')) renderPlayers(snap);
    currentSnap = snap;
    return snap;
  } finally {
    polling = false;
  }
}

window.api.onMatchPartial((partial) => {
  if (!partial) return;
  if (partial.stage === 'skeleton') {
    currentSnap = {
      inMatch: partial.inMatch,
      map: partial.map,
      players: partial.players,
      matchId: partial.matchId,
      pseudoId: partial.pseudoId,
    };
    renderPlayers(currentSnap);
    setStatus(`${partial.inMatch ? 'LIVE' : 'LAST'} · loading…`);
  } else if (partial.stage === 'player') {
    if (currentSnap) {
      const idx = (currentSnap.players || []).findIndex(p =>
        (p.profileId && partial.player.profileId && String(p.profileId) === String(partial.player.profileId)) ||
        p.name === partial.player.name
      );
      if (idx >= 0) currentSnap.players[idx] = partial.player;
      else (currentSnap.players ||= []).push(partial.player);
      if (partial.player.isSelf) currentSnap.self = partial.player;
    }
    upsertPlayer(partial.player);
  }
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!/^https?:\/\//i.test(href)) return;
  e.preventDefault();
  window.api.openExternal(href);
});

window.api.onMode((m) => {
  document.body.classList.toggle('pill', m === 'pill');
});

const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
bind('refresh', refresh);
bind('expand', () => window.api.setMode('full'));
bind('collapse', () => window.api.setMode('pill'));
bind('quit', () => window.api.quit());

(function setupHelp() {
  const modal = document.getElementById('helpModal');
  const openBtn = document.getElementById('help');
  const closeBtn = document.getElementById('helpClose');
  const versionEl = document.getElementById('helpVersion');
  const openLogBtn = document.getElementById('helpOpenLog');
  if (!modal) return;
  const open = () => modal.removeAttribute('hidden');
  const close = () => modal.setAttribute('hidden', '');
  if (openBtn) openBtn.onclick = open;
  if (closeBtn) closeBtn.onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hasAttribute('hidden')) close(); });
  if (openLogBtn) openLogBtn.onclick = () => window.api.openLogFolder();
  window.api.getVersion?.().then(v => { if (versionEl && v) versionEl.textContent = 'v' + v; }).catch(()=>{});
})();
window.api.onRefresh(refresh);

window.api.getVersion().then(v => {
  const el = document.getElementById('appVersion');
  if (el && v) el.textContent = 'v' + v;
}).catch(() => {});

const POLL_IDLE_MS = 10_000;
const POLL_LIVE_MS = 45_000;
const POLL_LAST_MS = 60_000;
let lastSnap = null;

async function refreshAndReschedule() {
  lastSnap = await refresh();
  const isLive = !!(lastSnap && lastSnap.inMatch);
  const isLast = !!(lastSnap && !lastSnap.inMatch && lastSnap.players && lastSnap.players.length);
  const next = isLive ? POLL_LIVE_MS : isLast ? POLL_LAST_MS : POLL_IDLE_MS;
  nextRefreshAt = Date.now() + next;
  timer = setTimeout(refreshAndReschedule, next);
}

scheduleCountdown();

(async () => {
  lastSnap = await refresh();
  const next = (lastSnap && lastSnap.inMatch) ? POLL_LIVE_MS : POLL_IDLE_MS;
  nextRefreshAt = Date.now() + next;
  timer = setTimeout(refreshAndReschedule, next);
})();
