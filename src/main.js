// Tauri 2 shim — recreates the old Electron preload `window.api` surface.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const _log = (level, target, message) => {
  try { invoke('log_msg', { level, target, message: String(message) }); } catch (_) {}
  const c = console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'];
  c(`[${target}]`, message);
};
window.log = {
  info:  (target, msg) => _log('info',  target, msg),
  warn:  (target, msg) => _log('warn',  target, msg),
  error: (target, msg) => _log('error', target, msg),
};

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
  onMatchPartial: (cb) => listen('match-partial', (e) => cb(e.payload)),
  quit: () => invoke('quit_app'),
  desktopWindow: (on) => invoke('desktop_window', { on }),
  openExternal: (url) => invoke('open_external', { url }),
  getVersion: () => invoke('app_version'),
  openLogFolder: () => invoke('open_log_folder'),
  leaderboardTotals: () => invoke('leaderboard_totals'),
};

// --- Display settings (what's shown per mode) ---
const SETTING_SECTIONS = [
  { key: 'rating',          labelKey: 'setting_rating' },
  { key: 'threat',          labelKey: 'setting_threat' },
  { key: 'formatBreakdown', labelKey: 'setting_format' },
  { key: 'activity',        labelKey: 'setting_activity' },
  { key: 'lastMatches',     labelKey: 'setting_last_matches' },
  { key: 'profileLink',     labelKey: 'setting_profile_link' },
  { key: 'selfBar',         labelKey: 'setting_self_bar' },
  { key: 'civPie',          labelKey: 'setting_civ_pie' },
  { key: 'eloTrend',        labelKey: 'setting_elo_trend' },
  { key: 'mapRecord',       labelKey: 'setting_map_record' },
  { key: 'streak',          labelKey: 'setting_streak' },
  { key: 'buildAdvice',     labelKey: 'setting_build_advice' },
  { key: 'postMatchCard',   labelKey: 'setting_post_match' },
];
const DEFAULT_SETTINGS = {
  // Per-section visibility (single full overlay view; compact mode removed).
  full:    { rating: true, threat: true, formatBreakdown: true, activity: true, lastMatches: true, profileLink: true, selfBar: true, civPie: true, eloTrend: true, mapRecord: true, streak: true, buildAdvice: true },
  postMatchCard: true,
  bgAlpha: 30,           // window background opacity 0-100 (30 = light tint, reco)
  desktopWindow: false,  // opaque resizable window for a dedicated monitor
  autoCollapse: true,    // on a new 1v1 match, auto-collapse the opponent card after a delay
  autoCollapseSecs: 120, // delay before that auto-collapse (seconds)
  telemetry: true,       // anonymous boot ping (install count only); opt-out via settings
  // Which parts of the 1v1 build-advice (PLAN) card to show. All on by default.
  buildParts: { theirPlans: true, yourPlan: true, makeUnits: true, earlyBuild: true, alternates: true, danger: true },
};
// Parts of the build-advice card, in display order (for the settings UI).
const BUILD_PARTS = [
  { key: 'theirPlans', labelKey: 'bp_their_plans' },
  { key: 'yourPlan',   labelKey: 'bp_your_plan' },
  { key: 'makeUnits',  labelKey: 'bp_make_units' },
  { key: 'earlyBuild', labelKey: 'bp_early_build' },
  { key: 'alternates', labelKey: 'bp_alternates' },
  { key: 'danger',     labelKey: 'bp_danger' },
];
// True if a build-advice part is enabled (defaults to shown).
function BP(key) { return settings.buildParts?.[key] !== false; }
const SETTINGS_KEY = 'displaySettings.v2';
const SETTINGS_KEY_V1 = 'displaySettings.v1';
let settings = loadSettings();

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      // `full` carries the section toggles (compact set, if present from an
      // older version, is ignored now that there's a single view).
      full: { ...DEFAULT_SETTINGS.full, ...(parsed.full || {}) },
      postMatchCard: parsed.postMatchCard ?? DEFAULT_SETTINGS.postMatchCard,
      bgAlpha: parsed.bgAlpha ?? DEFAULT_SETTINGS.bgAlpha,
      desktopWindow: parsed.desktopWindow ?? DEFAULT_SETTINGS.desktopWindow,
      autoCollapse: parsed.autoCollapse ?? DEFAULT_SETTINGS.autoCollapse,
      autoCollapseSecs: parsed.autoCollapseSecs ?? DEFAULT_SETTINGS.autoCollapseSecs,
      telemetry: parsed.telemetry ?? DEFAULT_SETTINGS.telemetry,
      buildParts: { ...DEFAULT_SETTINGS.buildParts, ...(parsed.buildParts || {}) },
    };
  } catch (e) {
    window.log?.warn?.('settings', `load failed, using defaults: ${e}`);
    return structuredClone(DEFAULT_SETTINGS);
  }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch (e) { window.log?.warn?.('settings', `save failed: ${e}`); }
}
// Apply window background opacity (0-100 → rgba alpha) live. Module-scoped so it
// runs both from the settings slider and on boot to honor persisted bgAlpha.
function applyAppearance() {
  const a = Math.min(100, Math.max(0, settings.bgAlpha ?? 0)) / 100;
  document.body.style.background = `rgba(15, 18, 22, ${a})`;
  document.body.classList.toggle('desktop-window', !!settings.desktopWindow);
}
// Boot: apply persisted appearance + restore desktop-window mode if it was on.
applyAppearance();
if (settings.desktopWindow) { try { window.api.desktopWindow?.(true); } catch (e) {} }

// Header pill showing which mode is active. Overlay = always-on-top in-game;
// Desktop = opaque resizable second-monitor window (not on top, by design).
function updateModeBadge() {
  const b = document.getElementById('modeBadge');
  if (!b) return;
  const desk = !!settings.desktopWindow;
  b.textContent = desk ? t('mode_desktop') : t('mode_overlay');
  b.title = desk ? t('mode_desktop_hint') : t('mode_overlay_hint');
  b.classList.toggle('is-desktop', desk);
  b.classList.toggle('is-overlay', !desk);
}

// Single entry point for switching desktop mode, shared by the header pill and
// the settings checkbox so both stay in sync.
function setDesktopMode(on) {
  settings.desktopWindow = on;
  saveSettings();
  if (on) cancelAutoFocus();   // desktop mode never auto-collapses
  selfExpanded = on;           // expand self card when there's room
  try { window.api.desktopWindow?.(on); } catch (e) {}
  const chk = document.getElementById('setDesktopWindow');
  if (chk) chk.checked = on;
  updateModeBadge();
  if (currentSnap) renderPlayers(currentSnap);
}
document.getElementById('modeBadge')?.addEventListener('click', () => setDesktopMode(!settings.desktopWindow));
function S(key) {
  // True if a card section is enabled (single full overlay view).
  return !!settings.full?.[key];
}

const $players = document.getElementById('players');
const $status = document.getElementById('status');

let steamId = null;
let polling = false;
let timer = null;
let countdownTimer = null;
let nextRefreshAt = 0;
let baseStatus = '';
// Self card defaults collapsed to a one-line header in the cramped overlay, but
// auto-expands in desktop-window mode where there's room. User can still toggle.
let selfExpanded = !!settings.desktopWindow;
let planCollapsed = false; // 1v1 build-advice (PLAN) card collapse state
const collapsedCards = new Set(); // playerKey() of opponent/ally cards collapsed to header-only

// New-match auto-focus: on a new 1v1 match keep the opponent card + PLAN card
// expanded for autoFocusSecs() (with a visible countdown), then collapse the
// opponent card so the build order becomes the focus. Cancelled the moment the
// user manually toggles any card.
function autoFocusSecs() {
  const n = Number(settings.autoCollapseSecs);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 120;
}
let autoFocusMatchKey = null;
let autoFocusOppKey = null;
let autoFocusTimer = null;
let autoFocusTick = null;
let autoFocusRemain = 0;

function startAutoFocus(matchKey, oppKey) {
  stopAutoFocusTimers();
  autoFocusMatchKey = matchKey;
  autoFocusOppKey = oppKey;
  const secs = autoFocusSecs();
  autoFocusRemain = secs;
  renderAutoFocusCountdown();
  autoFocusTick = setInterval(() => {
    autoFocusRemain = Math.max(0, autoFocusRemain - 1);
    renderAutoFocusCountdown();
    if (autoFocusRemain === 0) { clearInterval(autoFocusTick); autoFocusTick = null; }
  }, 1000);
  autoFocusTimer = setTimeout(collapseOppNow, secs * 1000);
}
function collapseOppNow() {
  if (autoFocusOppKey) {
    collapsedCards.add(autoFocusOppKey);
    const card = document.getElementById(autoFocusOppKey);
    if (card) {
      card.classList.add('collapsed');
      const caret = card.querySelector('.card-caret');
      if (caret) caret.innerHTML = '&#9656;';
    }
  }
  stopAutoFocusTimers();
}
// Cancel keeps every card in its current state (just stops the countdown).
function cancelAutoFocus() { stopAutoFocusTimers(); }
function stopAutoFocusTimers() {
  if (autoFocusTimer) { clearTimeout(autoFocusTimer); autoFocusTimer = null; }
  if (autoFocusTick) { clearInterval(autoFocusTick); autoFocusTick = null; }
  autoFocusRemain = 0;
  renderAutoFocusCountdown();
}
function renderAutoFocusCountdown() {
  let el = document.getElementById('autoFocusCountdown');
  if (autoFocusRemain <= 0) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'autoFocusCountdown';
    el.className = 'shrink-countdown';
    el.onclick = collapseOppNow;
    const app = document.getElementById('app');
    const attrib = app.querySelector('.attrib');
    if (attrib) app.insertBefore(el, attrib); else app.appendChild(el);
  }
  el.textContent = t('focus_countdown', { n: autoFocusRemain });
}

function setStatus(s) { baseStatus = s; renderStatusLine(); }

function renderStatusLine() {
  if (nextRefreshAt && Date.now() < nextRefreshAt) {
    const secs = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
    $status.textContent = `${baseStatus} · ${t('next_refresh', { n: secs })}`;
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

// --- Per-format breakdown helpers ---
// Map companion leaderboard names to short labels.
// Companion returns the leaderboard as a slug ("rm_1v1", "rm_team", "ew_1v1",
// "ew_team", "unranked_1v1", "unranked_team"), or sometimes as a numeric ID
// or human name. Map all three.
const LEADERBOARD_SLUG_MAP = {
  'rm_1v1':           '1v1 RM',
  'rm_team':          'TG RM',
  'ew_1v1':           '1v1 EW',
  'ew_team':          'TG EW',
  'dm_1v1':           '1v1 DM',
  'dm_team':          'TG DM',
  'unranked_1v1':     'Unranked 1v1',
  'unranked_team':    'Unranked TG',
  'unranked':         'Unranked',
  'qm_1v1':           'QM 1v1',
  'qm_2v2':           'QM 2v2',
  'qm_3v3':           'QM 3v3',
  'qm_4v4':           'QM 4v4',
};
const LEADERBOARD_ID_MAP = {
  '0':  'Unranked',
  '1':  'Deathmatch',
  '2':  'Team DM',
  '3':  '1v1 RM',
  '4':  'TG RM',
  '13': '1v1 EW',
  '14': 'TG EW',
  '26': 'QM 1v1',
  '27': 'QM 2v2',
  '28': 'QM 3v3',
  '29': 'QM 4v4',
};
function leaderboardShort(name) {
  if (name == null || name === '') return 'Other';
  const raw = String(name).trim();
  // Slug match (companion's actual format).
  if (LEADERBOARD_SLUG_MAP[raw]) return LEADERBOARD_SLUG_MAP[raw];
  // Numeric ID.
  if (/^\d+$/.test(raw)) return LEADERBOARD_ID_MAP[raw] || `Format ${raw}`;
  const n = raw.toLowerCase();
  if (n.includes('1v1') && n.includes('random')) return '1v1 RM';
  if (n.includes('team') && n.includes('random')) return 'TG RM';
  if (n.includes('1v1') && n.includes('empire')) return '1v1 EW';
  if (n.includes('team') && n.includes('empire')) return 'TG EW';
  if (n.includes('unranked')) return 'Unranked';
  if (n.includes('death')) return n.includes('team') ? 'Team DM' : 'Deathmatch';
  if (n.includes('quick')) return n.replace(/quick\s*match\s*/i, 'QM ').trim();
  // Generic snake_case fallback: try parts.
  if (n.includes('_')) {
    const parts = n.split('_');
    if (parts.includes('1v1')) return parts.includes('rm') ? '1v1 RM' : parts.includes('ew') ? '1v1 EW' : '1v1';
    if (parts.includes('team')) return parts.includes('rm') ? 'TG RM' : parts.includes('ew') ? 'TG EW' : 'TG';
  }
  return raw;
}

function groupMatchesByFormat(matches) {
  const groups = {};
  for (const m of (matches || [])) {
    const key = leaderboardShort(m.leaderboard);
    (groups[key] ||= []).push(m);
  }
  // Sort each group by date descending (companion already returns this, but safe).
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => (new Date(b.started)) - (new Date(a.started)));
  }
  return groups;
}

function statsForGroup(matches, currentMap) {
  if (!matches || !matches.length) return null;
  const games = matches.length;
  const wins = matches.filter(m => m.won === true).length;
  const wr = games > 0 ? Math.round((100 * wins) / games) : null;
  // Civ counts + wins per civ
  const civAgg = {}; // { civ: { games, wins } }
  for (const m of matches) {
    if (!m.civ) continue;
    const a = civAgg[m.civ] ||= { games: 0, wins: 0 };
    a.games += 1;
    if (m.won === true) a.wins += 1;
  }
  const civEntries = Object.entries(civAgg);
  const topCivs = civEntries
    .map(([civ, v]) => ({ civ, games: v.games, wins: v.wins, wr: Math.round((100 * v.wins) / v.games) }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 5);
  const topCiv = civEntries.sort((a, b) => b[1].games - a[1].games)[0];
  // Best civ by winrate, min 3 games threshold to filter noise
  const bestCiv = civEntries
    .filter(([, v]) => v.games >= 3)
    .map(([civ, v]) => ({ civ, games: v.games, wr: Math.round((100 * v.wins) / v.games) }))
    .sort((a, b) => b.wr - a.wr)[0] || null;
  const civPool = civEntries.length;
  // Last 5 W/L (newest first → reverse to oldest→newest for display)
  const last5 = matches.slice(0, 5).reverse();
  // Rating range
  const ratings = matches.map(m => m.rating).filter(r => Number.isFinite(r));
  const ratingMin = ratings.length ? Math.min(...ratings) : null;
  const ratingMax = ratings.length ? Math.max(...ratings) : null;
  // Trend: full sequence of ratings in this format bucket (oldest→newest)
  // — companion gives us up to 40 matches total split across formats, so each
  // bucket gets however many it gets.
  const oldestFirst = matches.slice().reverse();
  const trendSeries = oldestFirst.map(m => m.rating).filter(r => Number.isFinite(r));
  // Net ELO change still scoped to last 5 (recent direction signal).
  const diffs = matches.slice(0, 5).map(m => m.ratingDiff).filter(n => Number.isFinite(n));
  const trend = diffs.length ? diffs.reduce((a, b) => a + b, 0) : null;
  // Map record on current match's map
  let mapStats = null;
  if (currentMap) {
    const lc = String(currentMap).toLowerCase();
    const onMap = matches.filter(m => (m.map || '').toLowerCase() === lc);
    if (onMap.length) {
      const onWins = onMap.filter(m => m.won === true).length;
      mapStats = { games: onMap.length, wins: onWins, winrate: Math.round((100 * onWins) / onMap.length) };
    }
  }
  return { games, wins, wr, topCiv, topCivs, bestCiv, civPool, last5, ratingMin, ratingMax, trend, trendSeries, mapStats };
}

// Inline sparkline SVG for ELO trend. Last N ratings, oldest→newest left to right.
function sparkline(ratings, w = 100, h = 20) {
  if (!ratings || ratings.length < 2) return '';
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = (max - min) || 1;
  const pad = 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const points = ratings.map((r, i) => {
    const x = pad + (i / (ratings.length - 1)) * innerW;
    const y = pad + (innerH - ((r - min) / range) * innerH);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const net = ratings[ratings.length - 1] - ratings[0];
  const stroke = net > 0 ? '#6cc46c' : net < 0 ? '#e88' : '#9aa';
  const lastX = pad + innerW;
  const lastY = pad + (innerH - ((ratings[ratings.length - 1] - min) / range) * innerH);
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="ELO trend last ${ratings.length} games">
    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="1.8" fill="${stroke}"/>
  </svg>`;
}

function buildFormatStats(player, currentMap) {
  const groups = groupMatchesByFormat(player.matches);
  // Always include the two primary formats so missing data shows as a clear
  // placeholder rather than vanishing the row.
  if (!groups['1v1 RM']) groups['1v1 RM'] = [];
  if (!groups['TG RM']) groups['TG RM'] = [];
  const labels = Object.keys(groups);
  labels.sort((a, b) => {
    if (a === currentMatchFormat && b !== currentMatchFormat) return -1;
    if (b === currentMatchFormat && a !== currentMatchFormat) return 1;
    return groups[b].length - groups[a].length;
  });
  return labels.map(lab => {
    let rank = null;
    if (lab.startsWith('1v1')) rank = player.rank1v1;
    else if (lab.startsWith('TG')) rank = player.rankTG;
    return { label: lab, stats: statsForGroup(groups[lab], currentMap), rank, isCurrent: lab === currentMatchFormat };
  });
}

// Civ → likely cheese/early-game strats (community consensus, not exhaustive).
const CIV_CHEESE = {
  Sicilians:    [{ name: 'Donjon rush', sev: 'high' }, { name: 'Serjeant FC', sev: 'med' }],
  Incas:        [{ name: 'Tower rush', sev: 'high' }, { name: 'Eagle drush', sev: 'med' }],
  Mongols:      [{ name: 'Fast scouts', sev: 'high' }, { name: 'Mangudai timing', sev: 'med' }],
  Goths:        [{ name: 'M@A → flush', sev: 'high' }, { name: 'Infantry spam', sev: 'med' }],
  Burgundians:  [{ name: 'Feudal knights', sev: 'high' }],
  Franks:       [{ name: 'Knight rush', sev: 'high' }, { name: 'Castle drop', sev: 'med' }],
  Persians:     [{ name: 'Douche', sev: 'med' }, { name: 'FC knights', sev: 'med' }],
  Aztecs:       [{ name: 'Drush FC', sev: 'high' }, { name: 'Eagle rush', sev: 'med' }],
  Chinese:      [{ name: 'Fast Feudal', sev: 'med' }],
  Lithuanians:  [{ name: 'Drush FC', sev: 'high' }, { name: 'Leitis push', sev: 'med' }],
  Britons:      [{ name: 'Archer rush', sev: 'high' }, { name: 'Tower rush', sev: 'med' }],
  Mayans:       [{ name: 'Archer rush', sev: 'high' }, { name: 'Eagle rush', sev: 'med' }],
  Ethiopians:   [{ name: 'Archer rush', sev: 'high' }],
  Vikings:      [{ name: 'Fast Feudal archers', sev: 'high' }],
  Magyars:      [{ name: 'Scout rush', sev: 'high' }],
  Berbers:      [{ name: 'Scout rush (cheap cav)', sev: 'high' }],
  Cumans:       [{ name: 'Feudal 2nd TC', sev: 'high' }, { name: 'Feudal siege', sev: 'med' }],
  Tatars:       [{ name: 'Scout rush', sev: 'med' }, { name: 'Flaming camel', sev: 'low' }],
  Khmer:        [{ name: 'Scorpion drop', sev: 'med' }, { name: 'Battle elephant', sev: 'med' }],
  Gurjaras:     [{ name: 'Shrivamsha rush', sev: 'high' }, { name: '10-vil eco', sev: 'med' }],
  Bengalis:     [{ name: 'Ratha rush', sev: 'high' }],
  Romans:       [{ name: 'Scout legionary', sev: 'med' }],
  Armenians:    [{ name: 'Warrior priest', sev: 'med' }],
  Georgians:    [{ name: 'Monaspa push', sev: 'med' }],
  Hindustanis:  [{ name: 'Light cav rush', sev: 'med' }, { name: 'Imp camel', sev: 'low' }],
  Vietnamese:   [{ name: 'Rattan archer', sev: 'med' }],
  Slavs:        [{ name: 'Boyar push', sev: 'med' }, { name: 'Druzhina inf', sev: 'med' }],
  Bohemians:    [{ name: 'Monk + tower', sev: 'high' }],
  Spanish:      [{ name: 'Tower rush', sev: 'med' }, { name: 'Fast Castle', sev: 'med' }],
  Portuguese:   [{ name: 'Tower rush', sev: 'med' }, { name: 'Feitoria boom', sev: 'low' }],
  Koreans:      [{ name: 'Tower rush', sev: 'high' }],
  Turks:        [{ name: 'Tower rush', sev: 'med' }, { name: 'FC Janissary', sev: 'med' }],
  Burmese:      [{ name: 'Tower rush', sev: 'med' }, { name: 'Arambai', sev: 'med' }],
  Saracens:     [{ name: 'Archer rush', sev: 'med' }, { name: 'Market abuse', sev: 'low' }],
  Italians:     [{ name: 'Fast Imp', sev: 'low' }],
  Japanese:     [{ name: 'M@A flush', sev: 'high' }, { name: 'Fast Castle samurai', sev: 'med' }],
  Teutons:      [{ name: 'Monk push', sev: 'med' }, { name: 'Castle drop', sev: 'med' }],
  Huns:         [{ name: 'Scout rush', sev: 'high' }, { name: 'No-house FC', sev: 'med' }],
  Celts:        [{ name: 'Siege push', sev: 'med' }, { name: 'M@A rush', sev: 'med' }],
  Malians:      [{ name: 'M@A → archer', sev: 'med' }, { name: 'Gbeto rush', sev: 'med' }],
  Malay:        [{ name: 'Fast Imp', sev: 'med' }, { name: 'Fishing boom', sev: 'low' }],
  Bulgarians:   [{ name: 'M@A rush (free upg)', sev: 'high' }],
  Dravidians:   [{ name: 'M@A rush', sev: 'high' }, { name: 'Elephant archer', sev: 'med' }],
  Poles:        [{ name: 'Folwark boom', sev: 'med' }, { name: 'Obuch push', sev: 'med' }],
  Sicilian:     null,
};

// Stable i18n key for a cheese/strat name -> `cz_<slug>` (en table in i18n.js
// holds the English source; render resolves via t() and falls back to English).
function cheeseKey(name) {
  return "cz_" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function detectSmurf(p) {
  const reasons = [];
  let score = 0;
  const r1 = p.rank1v1 || {};
  const rt = p.rankTG || {};
  const matches = p.matches || [];
  const rating = r1.rating ?? rt.rating;
  const games = r1.games ?? rt.games ?? 0;

  if (rating && rating >= 1500 && games > 0 && games < 100) {
    score += 3;
    reasons.push(`${rating} ELO in only ${games} games`);
  } else if (rating && rating >= 1300 && games > 0 && games < 50) {
    score += 2;
    reasons.push(`${rating} ELO in only ${games} games`);
  }

  // Recent rating climb from match buckets.
  const ratedRecent = matches.filter(m => typeof m.rating === 'number').slice(0, 20);
  if (ratedRecent.length >= 8) {
    const newest = ratedRecent[0].rating;
    const oldest = ratedRecent[ratedRecent.length - 1].rating;
    const delta = newest - oldest;
    if (delta >= 250) { score += 3; reasons.push(`+${delta} ELO in last ${ratedRecent.length} games`); }
    else if (delta >= 150) { score += 2; reasons.push(`+${delta} ELO in last ${ratedRecent.length} games`); }
  }

  // Recent win streak from rank API.
  const streak = r1.streak ?? rt.streak ?? 0;
  if (streak >= 6) { score += 1; reasons.push(`${streak}-game win streak`); }

  // High recent WR.
  const recent20 = matches.slice(0, 20).filter(m => m.won != null);
  if (recent20.length >= 10) {
    const wins = recent20.filter(m => m.won).length;
    const wr = wins / recent20.length;
    if (wr >= 0.80) { score += 2; reasons.push(`${Math.round(wr*100)}% WR last ${recent20.length}`); }
    else if (wr >= 0.70) { score += 1; reasons.push(`${Math.round(wr*100)}% WR last ${recent20.length}`); }
  }

  const hasSignal = (p.rank1v1 || p.rankTG || (p.matches || []).length > 0);
  if (!hasSignal) return null;
  const pct = Math.min(95, score * 12);
  const level = pct >= 60 ? 'high' : pct >= 30 ? 'med' : pct >= 10 ? 'low' : 'none';
  return { pct, level, reasons };
}

// Civ → game phase strength (community consensus, simplified).
const CIV_PHASE = {
  early: ['Mongols','Magyars','Berbers','Huns','Aztecs','Mayans','Britons','Goths','Burgundians','Franks','Sicilians','Incas','Lithuanians','Bulgarians','Dravidians','Cumans','Japanese','Gurjaras','Bengalis','Ethiopians','Romans'],
  late:  ['Teutons','Spanish','Turks','Persians','Italians','Malay','Vietnamese','Koreans','Bohemians','Slavs','Vikings','Portuguese','Byzantines','Khmer'],
};
function civPhase(civ) {
  if (!civ) return null;
  const c = titleCase(String(civ).trim());
  if (CIV_PHASE.early.some(x => x.toLowerCase() === c.toLowerCase())) return 'early';
  if (CIV_PHASE.late.some(x  => x.toLowerCase() === c.toLowerCase())) return 'late';
  return 'mid';
}
function lookupCheese(civ) {
  if (!civ) return [];
  const target = String(civ).trim().toLowerCase();
  for (const [k, v] of Object.entries(CIV_CHEESE)) {
    if (k.toLowerCase() === target) return v || [];
  }
  return [];
}
function detectFavoriteCivPhase(p) {
  const matches = p.matches || [];
  if (!matches.length) return null;
  const tally = {};
  for (const m of matches) {
    if (!m.civ) continue;
    tally[m.civ] = (tally[m.civ] || 0) + 1;
  }
  const top = Object.entries(tally).sort((a,b) => b[1] - a[1])[0];
  if (!top) return null;
  return { civ: titleCase(top[0]), games: top[1], phase: civPhase(top[0]) };
}

function detectSession(p) {
  const matches = (p.matches || []).filter(m => m.started);
  if (!matches.length) return null;
  const parseT = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
  const now = Date.now();
  const times = matches.map(m => parseT(m.started)).filter(t => t != null).sort((a,b) => b - a);
  if (!times.length) return null;
  const last = times[0];
  const sinceMin = (now - last) / 60000;
  // Count games in last 4h window from most recent (their current session).
  const sessionWin = 4 * 60 * 60 * 1000;
  const sessionGames = times.filter(t => last - t < sessionWin).length;
  const gamesToday = times.filter(t => now - t < 24 * 60 * 60 * 1000).length;
  // Gap before this session: time between most recent game and the one before the session window.
  const beforeSession = times.find(t => last - t >= sessionWin);
  const gapHrs = beforeSession ? (last - beforeSession) / 3600000 : null;

  if (sinceMin > 30 && sinceMin < 120) {
    return { label: t('warming_up', { min: Math.round(sinceMin) }), kind: 'fresh' };
  }
  if (gapHrs != null && gapHrs >= 24 && sessionGames <= 2) {
    return { label: t('fresh_break', { days: Math.round(gapHrs / 24) }), kind: 'fresh' };
  }
  if (gapHrs != null && gapHrs >= 6 && sessionGames <= 2) {
    return { label: t('fresh_today'), kind: 'fresh' };
  }
  if (sessionGames >= 8) {
    return { label: t('deep_grind', { n: sessionGames }), kind: 'tired' };
  }
  if (sessionGames >= 4) {
    return { label: t('session_in_progress', { n: sessionGames }), kind: 'warm' };
  }
  if (gamesToday >= 1) {
    return { label: t(gamesToday > 1 ? 'games_today' : 'game_today', { n: gamesToday }), kind: 'warm' };
  }
  return null;
}

function renderThreatSection(p) {
  const smurf = detectSmurf(p);
  const session = detectSession(p);
  const fav = detectFavoriteCivPhase(p);
  const civ = p.civ;
  const cheeses = lookupCheese(civ);
  const hasData = (p.matches || []).length > 0 || p.rank1v1 || p.rankTG;
  if (!hasData && !cheeses.length) {
    return `
      <div class="sect">${t('scout_summary')} <span class="sect-sub-note">· ${t('scout_sub')}</span></div>
      <div class="sect-empty">${t('no_data')}</div>
    `;
  }
  const smurfTag = smurf && smurf.pct > 0
    ? `<span class="threat-tag smurf-${smurf.level}" title="${escapeHtml(smurf.reasons.join(' · '))}">${smurf.pct >= 30 ? '⚠' : '✓'} ${t('smurf_prob')}: ${smurf.pct}%</span>`
    : (smurf
        ? `<span class="threat-tag smurf-none" title="${escapeHtml(t('tip_smurf_none'))}">✓ ${t('smurf_none')}</span>`
        : '');
  const sessionTag = session
    ? `<span class="threat-tag session-${session.kind}">${escapeHtml(session.label)}</span>`
    : '';
  const phaseLabel = fav ? t(`${fav.phase}_player`) : '';
  const phaseTag = fav
    ? `<span class="threat-tag phase-${fav.phase}" title="${escapeHtml(t('tip_phase', { civ: localizeCiv(fav.civ), n: fav.games }))}">${phaseLabel}</span>`
    : '';
  const drops = (p.rank1v1 && p.rank1v1.drops) || (p.rankTG && p.rankTG.drops) || 0;
  const dropTag = drops > 0
    ? `<span class="threat-tag drops-tag" title="${escapeHtml(t('tip_drops'))}">${t('drops', { n: drops })}</span>`
    : '';
  const sevPct = { high: 65, med: 40, low: 22 };
  const matches = p.matches || [];
  const civGames = civ ? matches.filter(m => (m.civ || '').toLowerCase() === civ.toLowerCase()) : [];
  const civPlayCount = civGames.length;
  const civWins = civGames.filter(m => m.won).length;
  const civWR = civPlayCount > 0 ? civWins / civPlayCount : null;
  const recentTotal = matches.length || 1;
  const civShare = civPlayCount / recentTotal;
  let famMult = 0.8;
  if (civPlayCount === 0) famMult = 0.6;
  else if (civPlayCount >= 8 || civShare >= 0.25) famMult = 1.2;
  else if (civPlayCount >= 3) famMult = 1.0;
  const wrMult = civWR == null ? 1.0 : (civWR >= 0.65 ? 1.15 : civWR <= 0.35 ? 0.85 : 1.0);

  // Game-length signal: short avg duration of recent wins → early-aggression player.
  const durs = matches.filter(m => typeof m.duration === 'number' && m.duration > 60).map(m => m.duration);
  const winDurs = matches.filter(m => m.won && typeof m.duration === 'number' && m.duration > 60).map(m => m.duration);
  const avgWinMin = winDurs.length >= 3 ? (winDurs.reduce((a,b)=>a+b,0) / winDurs.length) / 60 : null;
  const avgAllMin = durs.length >= 5 ? (durs.reduce((a,b)=>a+b,0) / durs.length) / 60 : null;
  let durMult = 1.0;
  let durNote = '';
  if (avgWinMin != null) {
    const n = avgWinMin.toFixed(0);
    if (avgWinMin < 13) { durMult = 1.35; durNote = t('tz_dur_vearly', { n }); }
    else if (avgWinMin < 18) { durMult = 1.15; durNote = t('tz_dur_early', { n }); }
    else if (avgWinMin > 35) { durMult = 0.7; durNote = t('tz_dur_late', { n }); }
    else if (avgWinMin > 28) { durMult = 0.85; durNote = t('tz_dur_midlate', { n }); }
    else { durNote = t('tz_dur_avgwin', { n }); }
  } else if (avgAllMin != null) {
    durNote = t('tz_dur_avggame', { n: avgAllMin.toFixed(0) });
  }

  const famNote = civPlayCount === 0
    ? t('tz_fam_first', { civ: localizeCiv(civ) || 'civ' })
    : t('tz_fam_games', { n: civPlayCount }) + (civWR != null ? t('tz_fam_wr', { pct: Math.round(civWR*100) }) : '');
  const tagNote = [famNote, durNote].filter(Boolean).join(' · ');
  const cheeseTags = cheeses.map(c => {
    const base = sevPct[c.sev] ?? 30;
    const pct = Math.max(5, Math.min(95, Math.round(base * famMult * wrMult * durMult)));
    const ck = cheeseKey(c.name);
    const cname = t(ck);
    return `<span class="threat-tag cheese-${c.sev}" title="${escapeHtml(tagNote || t('tip_opening'))}">${escapeHtml(cname === ck ? c.name : cname)} ${pct}%</span>`;
  }).join('');
  return `
    <div class="sect">${t('scout_summary')} <span class="sect-sub-note">· ${t('scout_sub')}</span></div>
    <div class="threat-line">${smurfTag}${sessionTag}${phaseTag}${dropTag}${cheeseTags}</div>
  `;
}

function renderEloRow(label, st, isCurrent, rank) {
  // Empty bucket — show placeholder with career rank if available.
  if (!st) {
    const careerStr = rank
      ? `<span class="g">${t('career_short')}</span> ${rank.games ?? '?'}g · ${rank.winrate ?? '?'}%`
      : '';
    return `
      <div class="fmt ${isCurrent ? 'fmt-current' : ''} fmt-empty">
        <div class="fmt-row">
          <span class="fmt-label">${escapeHtml(label)}</span>
          <span class="fmt-empty-note g">${t('no_games_window')}</span>
          ${careerStr}
        </div>
      </div>`;
  }
  const wlSeq = st.last5.map(m =>
    m.won === true ? '<span class="wl w">W</span>' :
    m.won === false ? '<span class="wl l">L</span>' :
    '<span class="wl">·</span>'
  ).join('');
  const trendStr = (S('eloTrend') && st.trendSeries && st.trendSeries.length >= 2)
    ? `<span class="trend-block"><span class="g">${t('trend')}</span> ${sparkline(st.trendSeries)} ${st.trend != null ? `<span class="trend ${st.trend > 0 ? 'trend-up' : st.trend < 0 ? 'trend-down' : 'trend-flat'}" title="${escapeHtml(t('tip_net_elo'))}">${st.trend > 0 ? '+' : ''}${st.trend}</span>` : ''}</span>`
    : '';
  const rangeStr = (st.ratingMin != null && st.ratingMax != null)
    ? `<span class="g">${t('range')}</span> ${st.ratingMin}–${st.ratingMax}` : '';
  const mapStr = (S('mapRecord') && st.mapStats && currentMatchMap)
    ? `<span class="g">${t('on_map', { map: escapeHtml(currentMatchMap) })}</span> <strong>${st.mapStats.wins}W-${st.mapStats.games - st.mapStats.wins}L</strong>` : '';
  let streakBadge = '';
  if (rank && rank.streak != null) {
    const n = Number(rank.streak);
    const cls = n > 0 ? 'streak-win' : n < 0 ? 'streak-loss' : 'streak-flat';
    const sign = n > 0 ? `${n}W` : n < 0 ? `${Math.abs(n)}L` : '0';
    streakBadge = `<span class="streak-badge ${cls}">${sign}</span>`;
  }
  const careerStr = rank
    ? `<span class="career-block"><span class="g">${t('career_full')}</span> <strong>${(rank.games ?? '?').toLocaleString()}</strong> ${t('games_short')} · <strong>${rank.winrate ?? '?'}%</strong> ${t('wr_short')}</span>`
    : '';
  return `
    <div class="fmt ${isCurrent ? 'fmt-current' : ''}">
      <div class="fmt-row fmt-header">
        <span class="fmt-label">${escapeHtml(label)}</span>
        ${careerStr}
      </div>
      <div class="fmt-row">
        <span class="fmt-window-count g" title="${escapeHtml(t('tip_window40'))}">${t('last_n', { n: st.games })} <strong>${st.wr}%</strong> ${t('wr_short')} (${st.wins}W-${st.games - st.wins}L)</span>
        ${trendStr}
      </div>
      <div class="fmt-row fmt-sub">
        ${rangeStr}
        ${(S('streak') && (streakBadge || wlSeq)) ? `<span class="g">${t('recent_short')}</span> ${streakBadge} <span class="fmt-wl">${wlSeq}</span>` : ''}
        ${mapStr}
      </div>
    </div>`;
}

function renderCivRow(label, st, isCurrent, selfCiv) {
  if (!st) {
    return `
      <div class="fmt ${isCurrent ? 'fmt-current' : ''} fmt-empty">
        <div class="fmt-row">
          <span class="fmt-label">${escapeHtml(label)}</span>
          <span class="fmt-empty-note g">${t('no_games_civs')}</span>
        </div>
      </div>`;
  }
  const topCivs = st.topCivs || [];
  const totalCivGames = topCivs.reduce((a, c) => a + (c.games || 0), 0) || st.games || 0;
  const topShare = (st.topCiv && totalCivGames) ? st.topCiv[1].games / totalCivGames : 0;
  // Tendency classification.
  let tendencyTag;
  if (!totalCivGames) {
    tendencyTag = `<span class="civ-tend tend-none">${t('no_civ_data')}</span>`;
  } else if (topShare >= 0.40) {
    tendencyTag = `<span class="civ-tend tend-strong">${t('most_played')} ${escapeHtml(localizeCiv(st.topCiv[0]))} (${Math.round(topShare*100)}%)</span>`;
  } else if (topShare >= 0.25) {
    tendencyTag = `<span class="civ-tend tend-lean">${t('most_played')} ${escapeHtml(localizeCiv(st.topCiv[0]))} (${Math.round(topShare*100)}%)</span>`;
  } else {
    tendencyTag = `<span class="civ-tend tend-flex">${t('flex_picker')}</span>`;
  }
  const bestStr = st.bestCiv
    ? `<span class="civ-tend tend-best">${t('highest_wr')} ${escapeHtml(localizeCiv(st.bestCiv.civ))} ${st.bestCiv.wr}% (${st.bestCiv.games}g)</span>`
    : '';
  const poolStr = '';
  const mirror = selfCiv && st.topCiv && st.topCiv[0].toLowerCase() === selfCiv.toLowerCase()
    ? `<span class="mirror-alert">${t('mirror_alert', { civ: escapeHtml(localizeCiv(selfCiv)) })}</span>` : '';

  // SVG pie chart of civ distribution (top 5 + "others"). Toggleable — off
  // leaves just the text tendency list above.
  let chart = '';
  if (S('civPie') && totalCivGames > 0) {
    const palette = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8'];
    const shown = topCivs.slice(0, 5);
    const shownGames = shown.reduce((a, c) => a + (c.games || 0), 0) || 1;
    const slices = shown.map((c, i) => ({ name: localizeCiv(c.civ), games: c.games, wr: c.wr, color: palette[i] }));

    const cx = 32, cy = 32, r = 30;
    let acc = 0;
    const arcs = slices.map(s => {
      const frac = s.games / shownGames;
      const a0 = acc * 2 * Math.PI - Math.PI / 2;
      acc += frac;
      const a1 = acc * 2 * Math.PI - Math.PI / 2;
      // Full circle case (single slice = 100%): draw as full circle path.
      if (frac >= 0.999) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"><title>${escapeHtml(s.name)}: ${s.games}g${s.wr != null ? ' · ' + s.wr + '%' : ''}</title></circle>`;
      }
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = frac > 0.5 ? 1 : 0;
      const d = `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
      return `<path d="${d}" fill="${s.color}" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"><title>${escapeHtml(s.name)}: ${s.games}g${s.wr != null ? ' · ' + s.wr + '%' : ''}</title></path>`;
    }).join('');
    const legend = slices.map(s => {
      const share = Math.round((s.games / shownGames) * 100);
      return `<span class="civbar-leg"><span class="civbar-dot" style="background:${s.color.startsWith('url') ? 'repeating-linear-gradient(45deg,#555,#555 2px,#666 2px,#666 4px)' : s.color}"></span>${escapeHtml(s.name)} <span class="g">${share}% (${s.games}g${s.wr != null ? ' · ' + s.wr + '% WR' : ''})</span></span>`;
    }).join('');
    chart = `
      <div class="civpie-wrap">
        <svg class="civpie" viewBox="0 0 64 64" width="110" height="110">
          <defs><pattern id="civPieOther" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#555"/><rect width="3" height="6" fill="#666"/></pattern></defs>
          ${arcs}
        </svg>
        <div class="civbar-legend">${legend}</div>
      </div>`;
  }

  return `
    <div class="fmt ${isCurrent ? 'fmt-current' : ''}">
      <div class="fmt-row">
        <span class="fmt-label">${escapeHtml(label)}</span>
        <span class="fmt-window-count g" title="${escapeHtml(t('tip_window40'))}">${st.games} recent · <strong>${st.wr}%</strong> WR (${st.wins}W-${st.games - st.wins}L)</span>
        <span class="civ-tend-group">${tendencyTag}${bestStr}</span>
        ${poolStr}
        ${mirror}
      </div>
      ${chart}
    </div>`;
}

// Legacy combined renderer (kept in case of fallback usage).
function renderFormatBlock(label, st, isCurrent, rank) {
  if (!st) return '';
  const wlSeq = st.last5.map(m =>
    m.won === true ? '<span class="wl w">W</span>' :
    m.won === false ? '<span class="wl l">L</span>' :
    '<span class="wl">·</span>'
  ).join('');
  const trendStr = (st.trendSeries && st.trendSeries.length >= 2)
    ? `<span class="g">ELO trend:</span> ${sparkline(st.trendSeries)} ${st.trend != null ? `<span class="trend ${st.trend > 0 ? 'trend-up' : st.trend < 0 ? 'trend-down' : 'trend-flat'}">${st.trend > 0 ? '+' : ''}${st.trend}</span>` : ''}`
    : (st.trend != null ? `<span class="g">ELO trend:</span> <span class="trend ${st.trend > 0 ? 'trend-up' : st.trend < 0 ? 'trend-down' : 'trend-flat'}">${st.trend > 0 ? '+' : ''}${st.trend}</span>` : '');
  const civStr = st.topCiv ? `${escapeHtml(titleCase(st.topCiv[0]))} <span class="g">${st.topCiv[1]}×</span>` : '<span class="g">—</span>';
  const rangeStr = (st.ratingMin != null && st.ratingMax != null) ? 'y' : '';
  const mapStr = (st.mapStats && currentMatchMap)
    ? `<span class="g">on ${escapeHtml(currentMatchMap)}: <strong>${st.mapStats.wins}W-${st.mapStats.games - st.mapStats.wins}L</strong></span>` : '';
  // Career streak from rank API (honest per format).
  let streakBadge = '';
  if (rank && rank.streak != null) {
    const n = Number(rank.streak);
    const cls = n > 0 ? 'streak-win' : n < 0 ? 'streak-loss' : 'streak-flat';
    const sign = n > 0 ? `${n}W` : n < 0 ? `${Math.abs(n)}L` : '0';
    streakBadge = `<span class="streak-badge ${cls}">${sign}</span>`;
  }
  // Career line: total games + lifetime winrate from rank.
  const careerStr = rank
    ? `<span class="g">career ${rank.games ?? '?'}g · ${rank.winrate ?? '?'}%</span>`
    : '';
  return `
    <div class="fmt ${isCurrent ? 'fmt-current' : ''}">
      <div class="fmt-row">
        <span class="fmt-label">${escapeHtml(label)}</span>
        ${careerStr}
        ${trendStr}
        ${(streakBadge || wlSeq) ? `<span class="g">recent:</span> ${streakBadge} <span class="fmt-wl">${wlSeq}</span>` : ''}
      </div>
      <div class="fmt-row fmt-sub">
        <span class="fmt-window g"><strong>${st.wr}%</strong> WR on last ${st.games} games (${st.wins}W-${st.games - st.wins}L)</span>
        <span class="fmt-civ">top played: ${civStr}</span>
        ${rangeStr ? `<span class="g">range: ${st.ratingMin}–${st.ratingMax}</span>` : ''}
        ${mapStr}
      </div>
    </div>`;
}

function playerKey(p) {
  return `card-${(p.profileId || p.name || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

// Total players per RM ladder (rm_1v1 / rm_team), fetched once at boot. Lets us
// show a rank as a percentile (top X%) next to the rank number.
let ladderTotals = { rm_1v1: null, rm_team: null };
function rankPctSuffix(rank, total) {
  if (!rank || !total) return '';
  const pct = (rank / total) * 100;
  const s = pct < 1 ? pct.toFixed(1) : Math.round(pct);
  return ` · top ${s}%`;
}

function cardHtml(p, isAlly) {
  const r1 = p.rank1v1 || {};
  const rt = p.rankTG || {};
  const loading = p.loading;
  const placeholder = (s) => `<span class="g">${s}</span>`;

  // Use raw matches[] (has leaderboard) over lastCivs (doesn't). Take first 5.
  const lastCivs = (p.matches || []).slice(0, 5).map(m => {
    const wl = m.won === true ? 'W' : m.won === false ? 'L' : '·';
    const cls = m.won === true ? 'w' : m.won === false ? 'l' : '';
    const diff = m.ratingDiff != null ? (m.ratingDiff > 0 ? `+${m.ratingDiff}` : `${m.ratingDiff}`) : '';
    const when = m.started ? relTime(m.started) : '';
    const fmt = leaderboardShort(m.leaderboard);
    const fmtCls = fmt.startsWith('1v1') ? 'fmt-tag-1v1' : fmt.startsWith('TG') ? 'fmt-tag-tg' : 'fmt-tag-other';
    return `<div class="civ"><span><span class="wl ${cls}">${wl}</span> <span class="fmt-tag ${fmtCls}">${escapeHtml(fmt)}</span> ${escapeHtml(localizeCiv(m.civ) || '?')}</span><span class="g">${escapeHtml(m.map || '')} ${diff}${when ? ` · ${when}` : ''}</span></div>`;
  }).join('') || `<div class="civ">${loading ? placeholder(t('loading')) : placeholder(t('no_recent_matches'))}</div>`;

  const roleCls = p.isSelf ? 'self' : isAlly ? 'ally' : 'opp';
  const roleLabel = p.isSelf ? t('you') : isAlly ? t('role_ally') : t('role_opp');
  const loadCls = loading ? ' card-loading' : '';
  // All cards (self + opponents) collapse to a one-line header (name + civ +
  // ratings). Self uses the selfExpanded flag; others use collapsedCards.
  const collapsible = true;
  const collapsed = p.isSelf ? !selfExpanded : collapsedCards.has(playerKey(p));
  const collapsedCls = collapsed ? ' collapsed' : '';
  const caret = collapsible
    ? `<span class="card-caret" title="${escapeHtml(t('toggle_card') !== 'toggle_card' ? t('toggle_card') : 'Show / hide details')}">${collapsed ? '&#9656;' : '&#9662;'}</span>`
    : '';
  const showRating = S('rating');
  const showActivity = S('activity') && (p.games24h != null || p.games7d != null);
  const showFormatBreakdown = S('formatBreakdown') && (p.matches || []).length > 0;
  const showThreat = S('threat') && !isAlly;
  const threatHtml = showThreat ? renderThreatSection(p) : '';
  const showLastMatches = S('lastMatches');
  const showProfileLink = S('profileLink');

  const activityStr = showActivity
    ? `<span><span class="g">${t('activity_label')}</span> ${t(p.games24h === 1 ? 'game_today' : 'games_today', { n: p.games24h ?? 0 })} · ${p.games7d ?? 0}/7d</span>`
    : '';

  // Build per-format buckets once, reused for ELO + Civ sections.
  const fmtBuckets = showFormatBreakdown ? buildFormatStats(p, currentMatchMap) : [];

  const dropsStr = '';

  return `
    <div class="card card-${roleCls}${loadCls}${collapsedCls}" id="${playerKey(p)}">
      <div class="name"><span class="role ${roleCls}">${roleLabel}</span> ${escapeHtml(p.name)} ${p.civ ? `<span class="g">[${escapeHtml(localizeCiv(p.civ))}]</span>` : ''}${caret}</div>
      ${showRating ? `<div class="ratings">
        <span><span class="lbl">1v1</span>${r1.rating ?? (loading ? '…' : '—')}${r1.rank ? ` (#${r1.rank}${rankPctSuffix(r1.rank, ladderTotals.rm_1v1)})` : ''}</span>
        <span><span class="lbl">TG</span>${rt.rating ?? (loading ? '…' : '—')}${rt.rank ? ` (#${rt.rank}${rankPctSuffix(rt.rank, ladderTotals.rm_team)})` : ''}</span>
      </div>` : ''}

      ${threatHtml}

      ${showFormatBreakdown ? (fmtBuckets.length ? `
        <div class="sect">${t('elo_perf')} <span class="sect-sub-note">· ${t('elo_sub')}</span></div>
        <div class="fmt-list">${fmtBuckets.map(b => renderEloRow(b.label, b.stats, b.isCurrent, b.rank)).join('')}</div>

        <div class="sect">${t('civ_tend')} <span class="sect-sub-note">· ${t('elo_sub')}</span></div>
        <div class="fmt-list">${fmtBuckets.map(b => renderCivRow(b.label, b.stats, b.isCurrent, currentMatchSelfCiv)).join('')}</div>
      ` : `
        <div class="sect">${t('elo_perf')}</div>
        <div class="sect-empty">${loading ? t('loading') : t('no_matches_fetched')}</div>
        <div class="sect">${t('civ_tend')}</div>
        <div class="sect-empty">${loading ? t('loading') : t('no_matches_analyze')}</div>
      `) : ''}

      ${(showActivity || showLastMatches || showProfileLink) ? `
        <div class="sect">${t('activity_section')}</div>
        ${(activityStr || (showLastMatches && (p.matches || []).length))
          ? `<div class="activity-line">${activityStr}${dropsStr}</div>
             ${showLastMatches && (p.matches || []).length ? `<div class="sect-sub">${t('recent_matches')}</div><div class="civs">${lastCivs}</div>` : ''}`
          : `<div class="sect-empty">${t('no_activity')}</div>`}
      ` : ''}

      ${showProfileLink ? profileLinks(p) : ''}
    </div>
  `;
}

function profileLinks(p) {
  const c = p.profileId;
  if (!c) return '';
  return `<div class="profile-links">
    <a href="https://www.aoe2companion.com/players/${encodeURIComponent(c)}" target="_blank" rel="noopener noreferrer">${t('view_on_companion')}</a>
  </div>`;
}

// Build / counter recommendation — a standalone card shown in 1v1 only,
// toggled via the buildAdvice setting. Heuristic + offline (see strategy.js).
// Confidence-tagged: "likely", never certain. `opp` is the single opponent.
function buildAdviceCardHtml(opp) {
  if (!window.strategy) return '';
  const adv = window.strategy.buildAdvice(
    currentMatchSelfCiv,
    { civ: opp.civ, matches: opp.matches },
    currentMatchMap
  );
  if (!adv) return '';

  // Danger window from the existing CIV_PHASE knowledge.
  const phase = civPhase(opp.civ);
  const danger = phase === 'early'
    ? t('ba_danger_early')
    : phase === 'late'
      ? t('ba_danger_late')
      : t('ba_danger_even');

  const icon = (k) => `<img class="ba-ico" src="assets/icons/${k}.png" alt="" draggable="false">`;
  const confCls = `conf-${adv.their.confidence}`;
  const reasons = adv.their.reasons.map(r => `<span class="ba-chip">${escapeHtml(r)}</span>`).join('');
  // Secondary / tertiary likely plans, each with a brief counter.
  const altPlans = (adv.their.plans || []).slice(1).map(p => `
    <div class="ba-alt"><span class="ba-k">${t('ba_also')}</span>
      <span class="ba-plan2">${escapeHtml(p.planLabel)}</span>
      <span class="ba-conf conf-${p.confidence}">${p.confidence}</span>
      <span class="ba-alt-c">→ ${escapeHtml(p.counter.text)} ${(p.counter.units || []).map(icon).join('')}</span>
    </div>`).join('');
  const steps = adv.build.darkAge.map(s => `<li>${icon(s.icon)}${escapeHtml(s.text)}</li>`).join('');
  const dos = adv.your.dos.map(d => `<li>${escapeHtml(d)}</li>`).join('');
  const donts = adv.your.donts.map(d => `<li>${escapeHtml(d)}</li>`).join('');
  const selfCivName = escapeHtml(localizeCiv(adv.your.civ) || adv.your.civ);
  const oppCivName = escapeHtml(localizeCiv(adv.their.civ) || adv.their.civ);

  const caret = `<span class="card-caret" title="${escapeHtml(t('toggle_card'))}">${planCollapsed ? '&#9656;' : '&#9662;'}</span>`;
  return `
    <div class="card card-build${planCollapsed ? ' collapsed' : ''}" id="build-advice-card">
      <div class="name"><span class="role build">${t('ba_plan_title')}</span> ${selfCivName} <span class="g">${t('ba_vs')}</span> ${oppCivName}
        <span class="sect-sub-note">· ${t('ba_subtitle')}</span>${caret}</div>

      <div class="build-card">
        ${BP('theirPlans') ? `
        <div class="ba-line"><span class="ba-k">${t('ba_likely')}</span>
          <span class="ba-plan">${escapeHtml(adv.their.planLabel)}</span>
          <span class="ba-conf ${confCls}">${adv.their.confidence}</span>
        </div>
        <div class="ba-chips">${reasons}</div>
        ${altPlans}` : ''}

        ${BP('yourPlan') ? `
        <div class="ba-line"><span class="ba-k">${t('ba_your_plan')}</span>
          <span class="ba-civ">${selfCivName}</span>
          <span class="ba-opener">${escapeHtml(adv.build.opener)}</span>
        </div>
        <div class="ba-advice">${escapeHtml(adv.your.plan)}</div>` : ''}
        ${(BP('makeUnits') && adv.your.keyUnits && adv.your.keyUnits.length) ? `<div class="ba-make"><span class="ba-k">${t('ba_make')}</span> ${adv.your.keyUnits.map(u => icon(u)).join('')}</div>` : ''}
        ${BP('yourPlan') ? `
        <div class="ba-cols">
          <div class="ba-do"><div class="ba-h">${t('ba_do')}</div><ul>${dos}</ul></div>
          <div class="ba-dont"><div class="ba-h">${t('ba_avoid')}</div><ul>${donts}</ul></div>
        </div>` : ''}

        ${BP('earlyBuild') ? `
        <div class="ba-sub">${t('ba_early_build')} <b>${escapeHtml(adv.build.opener)}</b></div>
        <ol class="ba-build">${steps}</ol>
        <div class="ba-feudal">${icon(adv.build.feudal.icon)}${escapeHtml(adv.build.feudal.text)}</div>` : ''}
        ${(BP('alternates') && adv.your.builds && adv.your.builds.length > 1) ? `
          <div class="ba-sub">${t('ba_alternates')}</div>
          ${adv.your.builds.slice(1).map(b => `<div class="ba-altbuild">${icon(b.feudal.icon)}<b>${escapeHtml(b.opener)}</b> <span class="ba-altb-why">— ${escapeHtml(b.why)}</span><div class="ba-altb-feudal">${escapeHtml(b.feudal.text)}</div></div>`).join('')}
        ` : ''}

        ${BP('danger') ? `<div class="ba-danger"><span class="ba-k">${t('ba_danger')}</span> ${escapeHtml(danger)}</div>` : ''}
      </div>
    </div>
  `;
}

function getSelf(snap) {
  return snap?.self_ || snap?.self || (snap?.players || []).find(p => p.isSelf) || null;
}

let currentMatchFormat = null; // short label like '1v1 RM' for current match
let currentMatchMap = null;
let currentMatchSelfCiv = null;
function renderPlayers(snap) {
  const players = snap.players || [];
  const opponents = players.filter(p => !p.isSelf);
  const self = getSelf(snap);
  currentMatchMap = snap?.map || null;
  currentMatchSelfCiv = self?.civ || null;
  currentMatchFormat = null;
  for (const p of players) {
    const first = (p.matches || [])[0];
    if (first?.leaderboard) { currentMatchFormat = leaderboardShort(first.leaderboard); break; }
  }

  if (!opponents.length) {
    // A match resolved but no opponent surfaced — usually the live-text parser
    // choked on an unusual name. Don't blank the whole app: still show self plus
    // an explicit notice so the user sees their own data and knows why the
    // opponent is missing (vs. a silent total failure).
    if (self && S('selfBar')) {
      $players.innerHTML =
        `<div class="empty notice">${escapeHtml(t('opp_parse_fail'))}</div>` +
        cardHtml(self, false);
    } else {
      renderEmpty(t('empty_no_opps'));
    }
    return;
  }

  const selfTeam = self?.team || null;
  const show1v1 = !!(currentMatchFormat && currentMatchFormat.startsWith('1v1'));
  const showBuild = show1v1 && S('buildAdvice') && opponents.length === 1
    && opponents[0].civ && currentMatchSelfCiv;

  // New 1v1 match → keep the opponent card + PLAN card expanded, then collapse
  // the opponent after a visible countdown so the build order is the focus.
  const matchKey = snap?.matchId || snap?.pseudoId || null;
  const oppKey = (showBuild && opponents.length === 1) ? playerKey(opponents[0]) : null;
  // Auto-collapse is opt-out via settings; also always off in desktop-window
  // mode (dedicated second monitor) where the overlay isn't covering the game.
  const autoCollapseOn = settings.autoCollapse && !settings.desktopWindow;
  const isNewFocus = autoCollapseOn && showBuild && matchKey && matchKey !== autoFocusMatchKey;
  if (isNewFocus) {
    planCollapsed = false;
    if (oppKey) collapsedCards.delete(oppKey); // ensure opponent starts expanded
  }

  // Self renders as a collapsible card (same layout as opponents), collapsed by
  // default to a one-line header. Sits first, above opponents + build card.
  const selfHtml = (self && S('selfBar')) ? cardHtml(self, false) : '';
  const cards = opponents.map(p => cardHtml(p, selfTeam && p.team === selfTeam)).join('');
  const buildCard = showBuild ? buildAdviceCardHtml(opponents[0]) : '';
  $players.innerHTML = selfHtml + cards + buildCard;

  if (isNewFocus) startAutoFocus(matchKey, oppKey);
}

function upsertPlayer(player) {
  if (!currentSnap) return;
  const self = getSelf(currentSnap);
  const isAlly = self && self.team && player.team === self.team;
  if (player.isSelf) {
    if (!S('selfBar')) return;
    const id = playerKey(player);
    const old = document.getElementById(id);
    const html = cardHtml(player, false);
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
  const ts = new Date(iso).getTime(); // not `t` — that shadows the i18n fn
  if (!Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return t('time_just_now');
  if (m < 60) return t('time_min_ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('time_hr_ago', { n: h });
  const d = Math.round(h / 24);
  if (d === 1) return t('time_yesterday');
  if (d < 30) return t('time_day_ago', { n: d });
  const mo = Math.round(d / 30);
  return t('time_mo_ago', { n: mo });
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
      else { setStatus(t('status_steam_err', { err: r.error })); return null; }
    }
    setStatus(t('status_fetching'));
    const snap = await window.api.fetchMatch(steamId);
    if (snap.error) { setStatus(t('status_err', { err: snap.error })); return null; }
    if (!snap.players || !snap.players.length) {
      setStatus(snap.reason || t('status_no_match'));
      renderEmpty(t('empty_no_match'));
      currentSnap = snap;
      return snap;
    }
    const when = snap.fetchedAt ? new Date(snap.fetchedAt).toLocaleTimeString() : '';
    const tag = snap.cached ? 'cached' : 'fresh';
    const live = snap.inMatch ? 'LIVE' : 'LAST';
    setStatus(`${snap.inMatch ? t('live') : t('last')} · ${snap.cached ? t('cached') : t('fresh')} ${when}`);
    document.body.classList.toggle('last-match', !snap.inMatch);
    updatePostMatchCard(snap);
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
    setStatus(`${partial.inMatch ? t('live') : t('last')} · ${t('loading')}`);
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
    refreshBuildCard();
  }
});

// Insert / update / remove the standalone 1v1 build-advice card in place,
// without a full re-render (so it tracks opponent enrichment as it arrives).
function refreshBuildCard() {
  const opps = (currentSnap?.players || []).filter(p => !p.isSelf);
  const show1v1 = !!(currentMatchFormat && currentMatchFormat.startsWith('1v1'));
  const selfCiv = getSelf(currentSnap)?.civ || currentMatchSelfCiv;
  const existing = document.getElementById('build-advice-card');
  const ok = show1v1 && S('buildAdvice') && opps.length === 1 && opps[0].civ && selfCiv;
  if (!ok) { if (existing) existing.remove(); return; }
  const html = buildAdviceCardHtml(opps[0]);
  if (!html) { if (existing) existing.remove(); return; }
  if (existing) existing.outerHTML = html;
  else $players.insertAdjacentHTML('beforeend', html);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!/^https?:\/\//i.test(href)) return;
  e.preventDefault();
  window.api.openExternal(href);
});

// Click a card's name row to collapse/expand. Self toggles selfExpanded; the
// build card has no body collapse; opponents/allies use collapsedCards (keyed
// by playerKey === card.id, surviving per-player upsert re-renders).
document.addEventListener('click', (e) => {
  if (e.target.closest('a[href]')) return;
  const nameRow = e.target.closest('.card .name');
  if (!nameRow) return;
  const card = nameRow.closest('.card');
  if (!card || !card.id) return;
  cancelAutoFocus(); // any manual card toggle cancels the new-match auto-focus
  if (card.classList.contains('card-build')) {
    planCollapsed = !planCollapsed;
    card.classList.toggle('collapsed', planCollapsed);
    const caret = nameRow.querySelector('.card-caret');
    if (caret) caret.innerHTML = planCollapsed ? '&#9656;' : '&#9662;';
    return;
  }
  if (card.classList.contains('card-self')) {
    selfExpanded = !selfExpanded;
    if (currentSnap) renderPlayers(currentSnap);
    return;
  }
  if (collapsedCards.has(card.id)) collapsedCards.delete(card.id);
  else collapsedCards.add(card.id);
  const nowCollapsed = card.classList.toggle('collapsed');
  const caret = nameRow.querySelector('.card-caret');
  if (caret) caret.innerHTML = nowCollapsed ? '&#9656;' : '&#9662;';
});

function updatePostMatchCard(snap) {
  const card = document.getElementById('postmatchCard');
  if (!card) return;
  const showIt = settings.postMatchCard && snap && !snap.inMatch && (snap.players || []).length > 0;
  if (!showIt) { card.setAttribute('hidden', ''); return; }
  card.removeAttribute('hidden');
  const selfLink = document.getElementById('pmSelfLink');
  const selfWrap = document.getElementById('pmSelfWrap');
  const self = getSelf(snap);
  if (selfLink && selfWrap && self?.profileId && snap.matchId) {
    selfLink.href = `https://www.aoe2companion.com/matches/${encodeURIComponent(snap.matchId)}`;
    selfLink.textContent = t('view_match');
    selfWrap.removeAttribute('hidden');
  } else if (selfLink && selfWrap && self?.profileId) {
    selfLink.href = `https://www.aoe2companion.com/players/${encodeURIComponent(self.profileId)}`;
    selfLink.textContent = t('view_profile');
    selfWrap.removeAttribute('hidden');
  } else if (selfWrap) {
    selfWrap.setAttribute('hidden', '');
  }
}

const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
bind('refresh', refresh);
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
  window.api.getVersion?.().then(v => { if (versionEl && v) versionEl.textContent = 'v' + v; }).catch(e => window.log.warn('help-modal', `[LOCAL] getVersion failed: ${e}`));
})();
const openLogLink = document.getElementById('openLogLink');
if (openLogLink) openLogLink.onclick = e => { e.preventDefault(); window.api.openLogFolder(); };
window.api.onRefresh(refresh);

// Fetch RM ladder sizes once for rank percentiles; re-render if a match is up.
window.api.leaderboardTotals?.().then(tot => {
  if (tot && typeof tot === 'object') {
    ladderTotals = { rm_1v1: tot.rm_1v1 ?? null, rm_team: tot.rm_team ?? null };
    if (currentSnap?.players?.length) renderPlayers(currentSnap);
  }
}).catch(e => window.log?.warn?.('ladder-totals', `[LOCAL] fetch failed: ${e}`));

// --- Settings modal ---
(function setupSettings() {
  const modal = document.getElementById('settingsModal');
  const openBtn = document.getElementById('settings');
  const closeBtn = document.getElementById('settingsClose');
  const body = document.getElementById('settingsBody');
  const resetBtn = document.getElementById('settingsReset');
  if (!modal || !body) return;

  function renderTable() {
    const buildOff = !settings.full.buildAdvice;
    body.innerHTML = SETTING_SECTIONS.map(s => {
      const checked = s.key === 'postMatchCard' ? settings.postMatchCard : settings.full[s.key];
      let row = `
      <tr>
        <td>${t(s.labelKey)}</td>
        <td><input type="checkbox" data-key="${s.key}" ${checked ? 'checked' : ''}></td>
      </tr>`;
      // Indent the build-advice part toggles directly under their master row.
      if (s.key === 'buildAdvice') {
        row += BUILD_PARTS.map(p => `
      <tr class="settings-subrow${buildOff ? ' is-disabled' : ''}">
        <td>${t(p.labelKey)}</td>
        <td><input type="checkbox" data-buildpart="${p.key}" ${BP(p.key) ? 'checked' : ''} ${buildOff ? 'disabled' : ''}></td>
      </tr>`).join('');
      }
      return row;
    }).join('');
    // Apply translated labels every time the modal opens (so it reflects
    // current language even after a change).
    applyI18nToSettings();
    renderLangSelect();
  }

  function applyI18nToSettings() {
    const setText = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key); };
    setText('settingsTitle', 'settings_title');
    setText('settingsHdrSection', 'settings_section');
    setText('settingsHdrLang', 'settings_language');
    setText('settingsHdrOther', 'settings_other');
    setText('settingsLangLabel', 'settings_language');
    const reset = document.getElementById('settingsReset');
    if (reset) reset.textContent = t('settings_reset');
    setText('settingsDone', 'settings_done');
  }

  function renderLangSelect() {
    const sel = document.getElementById('langSelect');
    if (!sel || !window.i18n) return;
    const current = window.i18n.getStored();
    sel.innerHTML = `<option value="auto">${t('lang_auto')}</option>` +
      window.i18n.LANGS.map(l => `<option value="${l.code}" ${current === l.code ? 'selected' : ''}>${l.name}</option>`).join('');
    sel.onchange = () => {
      window.i18n.setLang(sel.value);
      renderTable();
      applyI18nToSettings();
      applyStaticI18n();
      if (currentSnap?.players?.length) renderPlayers(currentSnap);
    };
  }

  body.addEventListener('change', (e) => {
    const el = e.target;
    if (el.tagName !== 'INPUT') return;
    const key = el.dataset.key;
    if (!key) return;
    if (key === 'postMatchCard') {
      settings.postMatchCard = el.checked;
      saveSettings();
      updatePostMatchCard(currentSnap);
      return;
    }
    settings.full[key] = el.checked;
    saveSettings();
    if (key === 'buildAdvice') renderTable(); // refresh sub-row enabled state
    rerenderForSettings();
  });
  modal.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset?.other === 'postMatchCard') {
      settings.postMatchCard = el.checked;
      saveSettings();
      updatePostMatchCard(currentSnap);
    } else if (el.dataset?.buildpart) {
      settings.buildParts[el.dataset.buildpart] = el.checked;
      saveSettings();
      refreshBuildCard();
    }
  });

  function rerenderForSettings() {
    if (currentSnap?.players?.length) renderPlayers(currentSnap);
  }

  // --- Appearance controls (opacity slider + desktop-window toggle) ---
  const RECO_ALPHA = 30;  // recommended/default = light tint, still see-through
  const opacitySlider = document.getElementById('opacitySlider');
  const opacityValue = document.getElementById('opacityValue');
  const opacityReco = document.getElementById('opacityReco');
  const desktopCheck = document.getElementById('setDesktopWindow');
  const autoCollapseCheck = document.getElementById('setAutoCollapse');
  const autoCollapseSlider = document.getElementById('autoCollapseSlider');
  const autoCollapseValue = document.getElementById('autoCollapseValue');
  const telemetryCheck = document.getElementById('setTelemetry');

  // Park the reco marker over the slider track at the recommended value.
  if (opacityReco) opacityReco.style.left = `${RECO_ALPHA}%`;

  function syncAppearanceUI() {
    if (opacitySlider) opacitySlider.value = String(settings.bgAlpha ?? 0);
    if (opacityValue) {
      const v = settings.bgAlpha ?? 0;
      opacityValue.textContent = v === RECO_ALPHA ? `${v}% (reco)` : `${v}%`;
      opacityValue.classList.toggle('is-reco', v === RECO_ALPHA);
    }
    if (opacityReco) opacityReco.classList.toggle('snapped', (settings.bgAlpha ?? 0) === RECO_ALPHA);
    if (desktopCheck) desktopCheck.checked = !!settings.desktopWindow;
    if (autoCollapseCheck) autoCollapseCheck.checked = settings.autoCollapse !== false;
    if (autoCollapseSlider) autoCollapseSlider.value = String(settings.autoCollapseSecs ?? 120);
    if (autoCollapseValue) autoCollapseValue.textContent = `${settings.autoCollapseSecs ?? 120}s`;
    // Delay slider only matters when auto-collapse is on.
    if (autoCollapseSlider) autoCollapseSlider.disabled = settings.autoCollapse === false;
  }

  if (opacitySlider) {
    opacitySlider.addEventListener('input', () => {
      settings.bgAlpha = parseInt(opacitySlider.value, 10) || 0;
      applyAppearance();
      syncAppearanceUI();
    });
    opacitySlider.addEventListener('change', saveSettings);
  }
  // Click the green reco marker to jump back to the recommended/default value.
  if (opacityReco) {
    opacityReco.addEventListener('click', () => {
      settings.bgAlpha = RECO_ALPHA;
      if (opacitySlider) opacitySlider.value = String(RECO_ALPHA);
      applyAppearance();
      syncAppearanceUI();
      saveSettings();
    });
  }
  if (desktopCheck) {
    desktopCheck.addEventListener('change', () => setDesktopMode(desktopCheck.checked));
  }
  if (autoCollapseCheck) {
    autoCollapseCheck.addEventListener('change', () => {
      settings.autoCollapse = autoCollapseCheck.checked;
      saveSettings();
      // Switching off cancels any countdown already running this match.
      if (!autoCollapseCheck.checked) cancelAutoFocus();
      syncAppearanceUI();
    });
  }
  if (autoCollapseSlider) {
    autoCollapseSlider.addEventListener('input', () => {
      settings.autoCollapseSecs = parseInt(autoCollapseSlider.value, 10) || 120;
      if (autoCollapseValue) autoCollapseValue.textContent = `${settings.autoCollapseSecs}s`;
    });
    autoCollapseSlider.addEventListener('change', saveSettings);
  }
  if (telemetryCheck) {
    // Opt-out toggle; takes effect on next boot ping. Off → app talks to GitHub
    // directly and the Worker never sees this install.
    telemetryCheck.addEventListener('change', () => {
      settings.telemetry = telemetryCheck.checked;
      saveSettings();
    });
  }

  function open() { renderTable(); syncAppearanceUI(); modal.removeAttribute('hidden'); }
  function close() { modal.setAttribute('hidden', ''); }
  const doneBtn = document.getElementById('settingsDone');
  if (openBtn) openBtn.onclick = open;
  if (closeBtn) closeBtn.onclick = close;
  if (doneBtn) doneBtn.onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hasAttribute('hidden')) close(); });
  if (resetBtn) resetBtn.onclick = () => {
    settings = structuredClone(DEFAULT_SETTINGS);
    saveSettings();
    renderTable();
    rerenderForSettings();
  };
})();


// Translate static HTML elements that aren't re-rendered per snap.
function applyStaticI18n() {
  const setText = (sel, key, vars) => { const el = document.querySelector(sel); if (el) el.textContent = t(key, vars); };
  setText('#checkNowBtn strong', 'check_now');
  // "Just queued? Check now" — split: the leading text + bold action.
  const checkBtn = document.getElementById('checkNowBtn');
  if (checkBtn) {
    const strong = checkBtn.querySelector('strong');
    checkBtn.firstChild && checkBtn.removeChild(checkBtn.firstChild);
    checkBtn.insertBefore(document.createTextNode(t('check_now_q') + ' '), strong);
    if (strong) strong.textContent = t('check_now');
  }
  setText('.pm-title', 'match_over');
  setText('#pmSelfSuffix', 'view_suffix');
  setText('#footerData', 'footer_data');
  setText('#footerContact', 'footer_contact');
  setText('#openLogLink', 'footer_logs');
  setText('#hintBar', 'hint_hotkeys');
  setText('#helpLogIntro', 'help_log_intro');
  setText('#helpIssueLag', 'help_issues_lag');
  setText('#helpIssueClick', 'help_issues_click');
  setText('#helpIssueSteam', 'help_issues_steam');
  setText('#settingsHelpText', 'settings_help');
  // Help modal headers
  // Help-modal section headers — id-based (index-based broke when Credits was added).
  setText('#helpHdrHotkeys', 'help_hotkeys');
  setText('#helpHdrModes', 'help_modes');
  setText('#faqOverlayQ', 'faq_overlay_q');
  setText('#faqOverlayA', 'faq_overlay_a');
  setText('#faqDesktopQ', 'faq_desktop_q');
  setText('#faqDesktopA', 'faq_desktop_a');
  setText('#faqSwitchQ', 'faq_switch_q');
  setText('#faqSwitchA', 'faq_switch_a');
  setText('#faqTopQ', 'faq_top_q');
  setText('#faqTopA', 'faq_top_a');
  setText('#faqSelfQ', 'faq_self_q');
  setText('#faqSelfA', 'faq_self_a');
  setText('#faqCollapseQ', 'faq_collapse_q');
  setText('#faqCollapseA', 'faq_collapse_a');
  setText('#helpHdrLog', 'help_log');
  setText('#helpHdrLinks', 'help_links');
  setText('#helpHdrCredits', 'help_credits');
  setText('#helpHdrIssues', 'help_issues');
  const openLogBtn = document.getElementById('helpOpenLog');
  if (openLogBtn) openLogBtn.textContent = t('help_open_log');
  // Help-modal body text + link labels + credits.
  setText('#helpMit', 'mit_licensed');
  setText('#hkRefresh', 'hotkey_refresh');
  setText('#hkClick', 'hotkey_clickthrough');
  setText('#lnkProject', 'link_project');
  setText('#lnkSource', 'link_source');
  setText('#lnkSourceMit', 'mit_licensed');
  setText('#lnkContact', 'link_contact');
  setText('#creditsStats', 'credits_stats');
  setText('#creditsAge', 'credits_age');
  setText('#creditsMicrosoft', 'credits_microsoft');
  // Header + appearance controls.
  setText('#settingsHelpText', 'settings_help');
  setText('#settingsHdrAppearance', 'settings_appearance');
  setText('#appearanceBg', 'appearance_bg');
  setText('#appearanceDesktop', 'appearance_desktop');
  setText('#appearanceAutoCollapse', 'appearance_auto_collapse');
  setText('#appearanceAutoCollapseSecs', 'appearance_auto_collapse_secs');
  setText('#appearanceTelemetry', 'appearance_telemetry');
  // Header button tooltips (title attribute, not text).
  const setTitle = (id, key) => { const el = document.getElementById(id); if (el) el.title = t(key); };
  setTitle('settings', 'title_settings');
  setTitle('help', 'title_help');
  setTitle('quit', 'title_quit');
  setTitle('updateClose', 'title_dismiss');
  setTitle('openLogLink', 'title_open_log');
  updateModeBadge();
}
applyStaticI18n();

window.api.getVersion().then(v => {
  const el = document.getElementById('appVersion');
  if (el && v) el.textContent = 'v' + v;
  if (v) checkForUpdate(v);
}).catch(e => window.log.warn('footer-version', `[LOCAL] getVersion failed: ${e}`));

// Compare semver-ish "x.y.z" strings. Returns >0 if a > b, <0 if a < b, 0 equal.
function semverCmp(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Set this to your deployed Cloudflare Worker URL (see telemetry/README.md) to
// enable the anonymous install-count ping. Empty string = always use GitHub
// directly (no telemetry), regardless of the settings toggle — safe default
// until the Worker is deployed.
const TELEMETRY_URL = 'https://insta-scout-telemetry.aoe2-insta-scout.workers.dev';

// Random per-install id (anonymous; NOT steam id / profile). Created once and
// persisted; only ever sent when telemetry is enabled.
function installId() {
  let id = localStorage.getItem('installId');
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('installId', id);
  }
  return id;
}

const GH_LATEST_URL = 'https://api.github.com/repos/aliencoded/aoe2-stats-overlay-rust/releases/latest';
const GH_RELEASES_URL = 'https://github.com/aliencoded/aoe2-stats-overlay-rust/releases/latest';

async function checkForUpdate(currentVersion) {
  // Suppress for 6h after user dismisses a specific version banner.
  const dismissed = JSON.parse(localStorage.getItem('updateDismissed') || '{}');
  // Telemetry ON + Worker configured → ping the Worker (logs install + returns
  // latest). Otherwise → GitHub directly, sending nothing about this install.
  const useTelemetry = settings.telemetry !== false && !!TELEMETRY_URL;
  let latest = '';
  let htmlUrl = '';
  try {
    if (useTelemetry) {
      window.log.info('update-check', `[WEB] POST ${TELEMETRY_URL}/check`);
      const r = await fetch(`${TELEMETRY_URL}/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: installId(), v: currentVersion, os: 'win' }),
      });
      if (r.ok) latest = ((await r.json()).latest || '').replace(/^v/, '');
    } else {
      window.log.info('update-check', '[WEB] GET api.github.com/repos/aliencoded/aoe2-stats-overlay-rust/releases/latest');
      const r = await fetch(GH_LATEST_URL, { headers: { 'Accept': 'application/vnd.github+json' } });
      if (r.ok) {
        const data = await r.json();
        latest = (data.tag_name || '').replace(/^v/, '');
        htmlUrl = data.html_url || '';
      }
    }
  } catch (e) {
    window.log.warn('update-check', `[WEB] update-check unreachable: ${e?.message || e}`);
    return;
  }

  if (!latest) return;
  if (semverCmp(latest, currentVersion) <= 0) return;
  if (dismissed[latest] && Date.now() - dismissed[latest] < 6 * 60 * 60 * 1000) return;

  const banner = document.getElementById('updateBanner');
  const text = banner.querySelector('.update-text');
  const link = document.getElementById('updateLink');
  const close = document.getElementById('updateClose');
  text.textContent = t('update_available', { latest, current: currentVersion });
  link.textContent = t('download');
  link.href = htmlUrl || GH_RELEASES_URL;
  close.onclick = () => {
    banner.setAttribute('hidden', '');
    dismissed[latest] = Date.now();
    localStorage.setItem('updateDismissed', JSON.stringify(dismissed));
  };
  banner.removeAttribute('hidden');
}

// Idle = hunting for a new match. Heaviest by far (always-on).
// 90s default keeps background load minimal. User short-circuits with the
// "Check now" button (appears 10s after last poll) when they've just queued.
const POLL_IDLE_MS = 90_000;
const POLL_LIVE_MS = 45_000;
const POLL_LAST_MS = 60_000;
const CHECK_NOW_DELAY_MS = 10_000;
let lastSnap = null;

let checkNowTimer = null;
function scheduleCheckNowReveal(delayMs) {
  clearTimeout(checkNowTimer);
  hideCheckNow();
  checkNowTimer = setTimeout(() => {
    // Only show in idle mode (no live/past match displayed).
    const idle = !lastSnap || !(lastSnap.inMatch || (lastSnap.players || []).length);
    if (idle) showCheckNow();
  }, delayMs);
}
function showCheckNow() {
  const btn = document.getElementById('checkNowBtn');
  if (btn) btn.removeAttribute('hidden');
}
function hideCheckNow() {
  const btn = document.getElementById('checkNowBtn');
  if (btn) btn.setAttribute('hidden', '');
}
(function wireCheckNow() {
  const btn = document.getElementById('checkNowBtn');
  if (btn) btn.onclick = async () => {
    hideCheckNow();
    clearTimeout(timer);
    await refreshAndReschedule();
  };
})();

async function refreshAndReschedule() {
  lastSnap = await refresh();
  const isLive = !!(lastSnap && lastSnap.inMatch);
  const isLast = !!(lastSnap && !lastSnap.inMatch && lastSnap.players && lastSnap.players.length);
  const next = isLive ? POLL_LIVE_MS : isLast ? POLL_LAST_MS : POLL_IDLE_MS;
  nextRefreshAt = Date.now() + next;
  clearTimeout(timer);
  timer = setTimeout(refreshAndReschedule, next);
  // Show "Check now" button after CHECK_NOW_DELAY_MS only if still idle.
  if (!isLive && !isLast) scheduleCheckNowReveal(CHECK_NOW_DELAY_MS);
  else hideCheckNow();
}

scheduleCountdown();

// Boot via refreshAndReschedule so check-now reveal scheduling fires on
// the very first idle cycle, not only on the second poll onwards.
refreshAndReschedule();
