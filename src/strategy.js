// strategy.js — build-order / counter recommendation engine.
//
// Loaded as a plain <script> after i18n.js, before main.js; exposes
// window.strategy. All knowledge is heuristic and OFFLINE — we never fetch a
// real build order (the companion API has no build telemetry). We INFER the
// opponent's likely plan from: their civ's archetype, the map, and their
// recent civ habits, then recommend a counter direction + a generic early-game
// build for your civ.
//
// LOCALIZED: all user-facing prose is emitted via i18n keys resolved through
// window.t() at output time (en table in i18n.js holds the English source, so
// any missing locale falls back to English). Internal table keys, civ keys,
// archetype/opener identifiers stay English (they are lookup keys, never
// shown). Output is confidence-tagged — "likely", never "will".

(function () {
  // Resolve an i18n key to the current language; fall back to the raw key's
  // English (t() already does en-fallback, then raw-key). L() localizes a civ
  // name for display. Both are global by load order (i18n.js runs first).
  const T = (k, v) => (typeof window !== 'undefined' && window.t ? window.t(k, v) : k);
  const L = (c) => (typeof window !== 'undefined' && window.localizeCiv ? (window.localizeCiv(c) || c) : c);

  // --- Archetypes -----------------------------------------------------------
  // Each civ maps to a primary archetype (its dominant open/early identity) and
  // an optional secondary. `flex: true` means the civ has no strong default
  // opener (drops inferred confidence). `eco` is internal context only (never
  // rendered) so it stays English.
  const CIV_ARCHETYPE = {
    Franks:       { primary: 'knight',  eco: 'free farm upgrades' },
    Burgundians:  { primary: 'knight',  secondary: 'archer',  eco: 'early eco upgrades, feudal knights' },
    Lithuanians:  { primary: 'knight',  eco: 'drush-FC, relic-boosted knights' },
    Persians:     { primary: 'knight',  eco: 'faster TC/dock' },
    Georgians:    { primary: 'knight',  eco: 'monaspa cavalry' },
    Sicilians:    { primary: 'knight',  secondary: 'infantry', eco: 'donjon serjeants, tanky cavalry' },
    Teutons:      { primary: 'knight',  secondary: 'infantry', eco: 'defensive, monks; slow' },
    Britons:      { primary: 'archer',  eco: 'range archers, +range Castle' },
    Mayans:       { primary: 'archer',  secondary: 'eagle',   eco: 'cheaper archers, strong eagles' },
    Ethiopians:   { primary: 'archer',  eco: 'M@A→archers, extra resources' },
    Vietnamese:   { primary: 'archer',  eco: 'rattan archers, vision' },
    Chinese:      { primary: 'archer',  flex: true, eco: 'big eco lead, flexible' },
    Vikings:      { primary: 'archer',  secondary: 'infantry', eco: 'fast feudal archers, cheap eco' },
    Italians:     { primary: 'archer',  flex: true, eco: 'cheaper upgrades, gunpowder late' },
    Saracens:     { primary: 'archer',  secondary: 'camel',   eco: 'market abuse, camels' },
    Portuguese:   { primary: 'archer',  flex: true, eco: 'cheaper-gold units, water' },
    Aztecs:       { primary: 'eagle',   secondary: 'archer',  eco: 'military discount, monks, drush-FC' },
    Incas:        { primary: 'eagle',   secondary: 'infantry', eco: 'tower rush, cheap buildings' },
    Goths:        { primary: 'infantry', eco: 'M@A→flush, infantry spam late' },
    Japanese:     { primary: 'infantry', secondary: 'archer',  eco: 'M@A flush, strong infantry' },
    Celts:        { primary: 'infantry', secondary: 'siege',  eco: 'fast siege, infantry' },
    Slavs:        { primary: 'infantry', secondary: 'knight', eco: 'cheaper farms, boyars' },
    Malians:      { primary: 'infantry', secondary: 'archer', eco: 'M@A→archer, gbeto' },
    Bulgarians:   { primary: 'infantry', secondary: 'knight', eco: 'free M@A upgrades, konnik' },
    Dravidians:   { primary: 'infantry', secondary: 'archer', eco: 'M@A rush, elephant archers' },
    Armenians:    { primary: 'infantry', secondary: 'monk',   eco: 'warrior priests' },
    Romans:       { primary: 'infantry', secondary: 'scout',  eco: 'scout-legionary, scorpions' },
    Mongols:      { primary: 'scout',   secondary: 'archer',  eco: 'fast scouts, mangudai/cav-archer' },
    Huns:         { primary: 'scout',   secondary: 'knight',  eco: 'no houses, fast cav' },
    Magyars:      { primary: 'scout',   eco: 'cheaper scouts, mobile' },
    Berbers:      { primary: 'scout',   secondary: 'knight',  eco: 'cheap stable units' },
    Tatars:       { primary: 'scout',   secondary: 'archer',  eco: 'cav-archers, scouts' },
    Cumans:       { primary: 'scout',   secondary: 'knight',  eco: 'feudal 2nd TC, feudal siege' },
    Poles:        { primary: 'knight',  secondary: 'scout',   eco: 'folwark boom, obuch' },
    Turks:        { primary: 'scout',   flex: true, eco: 'light cav, gunpowder late' },
    Gurjaras:     { primary: 'camel',   secondary: 'scout',   eco: 'shrivamsha, mill eco' },
    Hindustanis:  { primary: 'camel',   secondary: 'scout',   eco: 'light cav, imp camels' },
    Khmer:        { primary: 'elephant', secondary: 'siege',  eco: 'scorpions, battle elephants' },
    Bengalis:     { primary: 'elephant', eco: 'ratha, elephants' },
    Burmese:      { primary: 'infantry', secondary: 'elephant', eco: 'arambai, monks' },
    Malay:        { primary: 'infantry', secondary: 'elephant', eco: 'cheap battle ele, water, fast imp' },
    Bohemians:    { primary: 'monk',    secondary: 'siege',   eco: 'monk+tower, hand cannon' },
    Koreans:      { primary: 'archer',  secondary: 'tower',   eco: 'tower rush, war wagons late' },
    Spanish:      { primary: 'knight',  flex: true, eco: 'tower/FC flex, conquistadors' },
    Byzantines:   { primary: 'knight',  flex: true, eco: 'cheap counter-units, defensive' },
  };

  // Counter knowledge: their primary archetype → how YOU respond. advice / dos
  // / donts are i18n keys (resolved at output). pref + keyUnits stay English
  // (opener lookup key + icon keys).
  const ARCHETYPE_COUNTER = {
    archer:   { advice: 'sg_adv_archer',
                dos: ['sg_do_archer_0', 'sg_do_archer_1', 'sg_do_archer_2'],
                donts: ['sg_dont_archer_0', 'sg_dont_archer_1'],
                pref: 'Scouts', keyUnits: ['skirmisher', 'scout'] },
    knight:   { advice: 'sg_adv_knight',
                dos: ['sg_do_knight_0', 'sg_do_knight_1', 'sg_do_knight_2'],
                donts: ['sg_dont_knight_0', 'sg_dont_knight_1'],
                pref: 'Archers', keyUnits: ['spearman', 'archer'] },
    scout:    { advice: 'sg_adv_scout',
                dos: ['sg_do_scout_0', 'sg_do_scout_1', 'sg_do_scout_2'],
                donts: ['sg_dont_scout_0', 'sg_dont_scout_1'],
                pref: 'Archers', keyUnits: ['spearman', 'archer'] },
    infantry: { advice: 'sg_adv_infantry',
                dos: ['sg_do_infantry_0', 'sg_do_infantry_1', 'sg_do_infantry_2'],
                donts: ['sg_dont_infantry_0', 'sg_dont_infantry_1'],
                pref: 'Archers', keyUnits: ['archer', 'skirmisher'] },
    eagle:    { advice: 'sg_adv_eagle',
                dos: ['sg_do_eagle_0', 'sg_do_eagle_1', 'sg_do_eagle_2'],
                donts: ['sg_dont_eagle_0', 'sg_dont_eagle_1'],
                pref: 'Archers', keyUnits: ['archer', 'skirmisher'] },
    monk:     { advice: 'sg_adv_monk',
                dos: ['sg_do_monk_0', 'sg_do_monk_1', 'sg_do_monk_2'],
                donts: ['sg_dont_monk_0', 'sg_dont_monk_1'],
                pref: 'Scouts', keyUnits: ['scout', 'skirmisher'] },
    siege:    { advice: 'sg_adv_siege',
                dos: ['sg_do_siege_0', 'sg_do_siege_1', 'sg_do_siege_2'],
                donts: ['sg_dont_siege_0', 'sg_dont_siege_1'],
                pref: 'Scouts', keyUnits: ['knight', 'scout'] },
    camel:    { advice: 'sg_adv_camel',
                dos: ['sg_do_camel_0', 'sg_do_camel_1', 'sg_do_camel_2'],
                donts: ['sg_dont_camel_0'],
                pref: 'Archers', keyUnits: ['archer', 'spearman'] },
    elephant: { advice: 'sg_adv_elephant',
                dos: ['sg_do_elephant_0', 'sg_do_elephant_1', 'sg_do_elephant_2'],
                donts: ['sg_dont_elephant_0', 'sg_dont_elephant_1'],
                pref: 'Fast Castle', keyUnits: ['spearman', 'knight'] },
    tower:    { advice: 'sg_adv_tower',
                dos: ['sg_do_tower_0', 'sg_do_tower_1', 'sg_do_tower_2'],
                donts: ['sg_dont_tower_0', 'sg_dont_tower_1'],
                pref: 'Scouts', keyUnits: ['knight', 'archer'] },
    water:    { advice: 'sg_adv_water',
                dos: ['sg_do_water_0', 'sg_do_water_1', 'sg_do_water_2'],
                donts: ['sg_dont_water_0', 'sg_dont_water_1'],
                pref: 'Fast Castle', keyUnits: ['fishingship'] },
  };

  // Generic early build. The dark age (~first 21 vils) is near-identical across
  // scouts / archers / M@A; openers diverge at the feudal transition. Shown as
  // a teaching template, not a frame-perfect pro build. Each step carries a
  // primary icon key (resolved to assets/icons/<key>.png in main.js) + an i18n
  // text key. AoE2's UI represents sheep/boar/deer/berries with the food icon.
  const DARK_AGE = [
    { icon: 'sheep', text: 'sg_da_0' },
    { icon: 'wood', text: 'sg_da_1' },
    { icon: 'boar', text: 'sg_da_2' },
    { icon: 'house', text: 'sg_da_3' },
    { icon: 'berries', text: 'sg_da_4' },
    { icon: 'gold', text: 'sg_da_5' },
    { icon: 'age_feudal', text: 'sg_da_6' },
  ];
  // Feudal tail, keyed by opener (English lookup key). text = i18n key.
  const FEUDAL_TAIL = {
    'Scouts':      { icon: 'scout',       text: 'sg_ft_scouts' },
    'Archers':     { icon: 'archer',      text: 'sg_ft_archers' },
    'M@A':         { icon: 'manatarms',   text: 'sg_ft_maa' },
    'Fast Castle': { icon: 'age_castle',  text: 'sg_ft_fc' },
    'Trush':       { icon: 'watchtower',  text: 'sg_ft_trush' },
    'Drush-FC':    { icon: 'militia',     text: 'sg_ft_drushfc' },
    'Water':       { icon: 'fishingship', text: 'sg_ft_water' },
  };
  // Opener → i18n key for its display label. Internal opener strings stay
  // English (lookup keys for FEUDAL_TAIL / OPENER_ARCHETYPE / ARCHETYPE_OPENER).
  const OPENER_LABEL_KEY = {
    'Scouts': 'sg_op_scouts', 'Archers': 'sg_op_archers', 'M@A': 'sg_op_maa',
    'Fast Castle': 'sg_op_fc', 'Trush': 'sg_op_trush', 'Drush-FC': 'sg_op_drushfc',
    'Water': 'sg_op_water',
  };
  const openerLabel = (op) => OPENER_LABEL_KEY[op] ? T(OPENER_LABEL_KEY[op]) : op;
  // Which opener an archetype naturally produces (used to pick YOUR opener).
  const ARCHETYPE_OPENER = {
    archer: 'Archers', knight: 'Scouts', scout: 'Scouts', infantry: 'M@A',
    eagle: 'Archers', camel: 'Scouts', elephant: 'Fast Castle', monk: 'Fast Castle',
    siege: 'Fast Castle', tower: 'Trush', water: 'Water',
  };
  // Archetype that a given opener represents (for matching to your civ).
  const OPENER_ARCHETYPE = {
    'Archers': 'archer', 'Scouts': 'scout', 'M@A': 'infantry',
    'Fast Castle': null, 'Trush': 'tower', 'Drush-FC': null, 'Water': 'water',
  };

  // Civ-specific notes appended to the generic counter advice (keyed by civ).
  // Value is an i18n key (resolved at output).
  const CIV_SPECIFIC = {
    Goths:       { dont: 'sg_cs_goths' },
    Mongols:     { dont: 'sg_cs_mongols' },
    Huns:        { dont: 'sg_cs_huns' },
    Britons:     { dont: 'sg_cs_britons' },
    Mayans:      { dont: 'sg_cs_mayans' },
    Franks:      { dont: 'sg_cs_franks' },
    Aztecs:      { dont: 'sg_cs_aztecs' },
    Lithuanians: { dont: 'sg_cs_lithuanians' },
    Bulgarians:  { dont: 'sg_cs_bulgarians' },
    Khmer:       { dont: 'sg_cs_khmer' },
  };

  const MAP_GAMEPLAN = {
    // key matched as a lowercase substring of the map name. `note` is internal
    // context only (never rendered) — `style` drives scoring.
    arabia:    { style: 'open' },
    arena:     { style: 'closed' },
    'black forest': { style: 'closed' },
    hideout:   { style: 'closed' },
    fortress:  { style: 'closed' },
    islands:   { style: 'water' },
    migration: { style: 'water' },
    'water nomad': { style: 'water' },
    nomad:     { style: 'open' },
  };

  function norm(s) { return String(s || '').trim(); }
  function key(s) { return norm(s).toLowerCase(); }

  // Generic fallback for civs we don't have an archetype for yet (e.g. a brand
  // new DLC civ). `flex` keeps confidence low and the advice non-committal.
  const FALLBACK_ARCHETYPE = { primary: 'knight', flex: true, eco: 'unknown civ — generic advice', fallback: true };

  function archetypeOf(civ) {
    const c = norm(civ);
    for (const k of Object.keys(CIV_ARCHETYPE)) {
      if (k.toLowerCase() === c.toLowerCase()) return CIV_ARCHETYPE[k];
    }
    return null;
  }

  function mapGameplan(mapName) {
    const m = key(mapName);
    if (!m) return null;
    for (const k of Object.keys(MAP_GAMEPLAN)) {
      if (m.includes(k)) return MAP_GAMEPLAN[k];
    }
    return null;
  }

  // Dominant archetype across an opponent's recent civ picks (their *habit*,
  // independent of this match's civ). Returns {archetype, share, n} or null.
  function habitArchetype(matches) {
    const tally = {};
    let n = 0;
    for (const m of (matches || []).slice(0, 20)) {
      const a = archetypeOf(m.civ);
      if (!a) continue;
      tally[a.primary] = (tally[a.primary] || 0) + 1;
      n++;
    }
    if (!n) return null;
    let best = null, bestN = 0;
    for (const [a, c] of Object.entries(tally)) if (c > bestN) { best = a; bestN = c; }
    return { archetype: best, share: bestN / n, n };
  }

  // Localized display label for an archetype. Falls back to the raw archetype
  // identifier if the key is somehow missing.
  function labelFor(arch) {
    const lbl = T('sg_arch_' + arch);
    return lbl === 'sg_arch_' + arch ? arch : lbl;
  }

  // Short counter hint for a plan (used on secondary/tertiary rows). Resolves
  // the localized advice, then takes its first clause.
  function counterBriefFor(arch) {
    const c = ARCHETYPE_COUNTER[arch];
    if (!c) return { text: T('sg_brief_default'), units: [] };
    const units = (c.keyUnits || []).slice(0, 2);
    return { text: T(c.advice).split(/[.;(]/)[0].trim(), units };
  }

  // Alternate builds for YOU (the player): the direct counter, your civ's own
  // strength, and a safe Fast Castle. Dark age is shared; only the opener +
  // feudal tail differ. First entry is the recommended primary. Returns
  // display-ready objects (localized opener label + why + feudal text).
  function buildOptions(counter, yourArch, planLabel) {
    const seen = new Set();
    const out = [];
    const push = (opener, why) => {
      if (!opener || seen.has(opener)) return;
      seen.add(opener);
      const ft = FEUDAL_TAIL[opener] || FEUDAL_TAIL['Scouts'];
      out.push({ opener: openerLabel(opener), why, feudal: { icon: ft.icon, text: T(ft.text) } });
    };
    const { opener: pref } = chooseOpener(counter.pref, yourArch);
    push(pref, T('sg_why_counter', { plan: planLabel }));
    if (yourArch && !yourArch.flex) push(ARCHETYPE_OPENER[yourArch.primary], T('sg_why_strength', { arch: yourArch.primary }));
    push('Fast Castle', T('sg_why_fc'));
    push('Drush-FC', T('sg_why_drushfc'));
    return out.slice(0, 3);
  }

  // Pick YOUR opener: prefer the counter's recommended opener, but if your civ
  // can't execute it well, fall back to your civ's natural opener and note that
  // you're still respecting their plan.
  function chooseOpener(prefOpener, yourArch) {
    if (!yourArch) return { opener: prefOpener, adapted: false };
    const need = OPENER_ARCHETYPE[prefOpener];
    if (need == null) return { opener: prefOpener, adapted: false }; // flex opener, anyone can do it
    if (yourArch.flex) return { opener: prefOpener, adapted: false };
    const fits = yourArch.primary === need || yourArch.secondary === need;
    if (fits) return { opener: prefOpener, adapted: false };
    const natural = ARCHETYPE_OPENER[yourArch.primary] || prefOpener;
    return { opener: natural, adapted: true };
  }

  // Main entry. selfCiv: your civ this match. opp: { civ, matches }. mapName.
  // Returns null if we can't say anything useful.
  function buildAdvice(selfCiv, opp, mapName) {
    const oppCiv = norm(opp && opp.civ);
    if (!oppCiv) return null;
    // Unknown civ (e.g. new DLC) → generic flex fallback instead of no card.
    const theirArch = archetypeOf(oppCiv) || FALLBACK_ARCHETYPE;

    const gameplan = mapGameplan(mapName);
    const habit = habitArchetype(opp && opp.matches);
    const oppL = L(oppCiv); // localized civ name for display in reason chips

    // Build a ranked list of candidate plans (primary, secondary, recent habit,
    // map-driven), then surface the top 3 with per-plan confidence. `why` on a
    // candidate is internal (not rendered) so it stays English; `reasons` are
    // the rendered chips and are localized via T().
    const reasons = [];
    const cand = {}; // arch -> { score, why }
    const bump = (arch, score, why) => {
      if (!arch) return;
      if (!cand[arch]) cand[arch] = { score, why };
      else { cand[arch].score += score; if (score >= 1.2) cand[arch].why = why; }
    };

    if (gameplan && gameplan.style === 'water') {
      // Water maps override land plans entirely.
      bump('water', 3, `${mapName}: water map`);
      reasons.push(T('sg_rs_water', { map: mapName }));
    } else {
      bump(theirArch.primary, 2.0, `${oppCiv} default`);
      if (theirArch.secondary) bump(theirArch.secondary, 1.2, `${oppCiv} 2nd line`);
      reasons.push(T('sg_rs_arrow', { civ: oppL, arch: labelFor(theirArch.primary) }));

      if (gameplan && gameplan.style === 'closed') {
        // Closed maps suppress rushes, reward boom / Fast Castle play.
        if (cand.scout) cand.scout.score -= 1.2;
        if (cand.tower) cand.tower.score -= 1.2;
        bump('knight', 1.0, `${mapName}: closed → FC/boom`);
        reasons.push(T('sg_rs_closed', { map: mapName }));
      } else if (gameplan && gameplan.style === 'open') {
        reasons.push(T('sg_rs_open', { map: mapName }));
      }

      if (theirArch.flex) { if (cand[theirArch.primary]) cand[theirArch.primary].score -= 0.6; reasons.push(T('sg_rs_flex')); }

      if (habit && habit.n >= 5) {
        const w = habit.share >= 0.5 ? 1.6 : 1.0;
        bump(habit.archetype, w, `recent picks ${Math.round(habit.share * 100)}% ${habit.archetype}`);
        reasons.push(T('sg_rs_recent', { pct: Math.round(habit.share * 100), arch: labelFor(habit.archetype) }));
      }
    }

    const confOf = (s) => s >= 2.5 ? 'high' : s >= 1.4 ? 'med' : 'low';
    const ranked = Object.entries(cand)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 3)
      .map(([arch, v]) => ({ planArch: arch, planLabel: labelFor(arch), confidence: confOf(v.score), why: v.why }));

    // Primary plan drives the full build + counter.
    const primary = ranked[0] || { planArch: theirArch.primary, planLabel: labelFor(theirArch.primary), confidence: 'low', why: `${oppCiv} default` };
    const planArch = primary.planArch;
    const planLabel = primary.planLabel;
    const confidence = primary.confidence;

    const counter = ARCHETYPE_COUNTER[planArch] || ARCHETYPE_COUNTER.knight;
    const yourArch = archetypeOf(selfCiv);
    const { opener, adapted } = chooseOpener(counter.pref, yourArch);
    const adviceText = T(counter.advice);

    const yourPlanText = adapted
      ? `${adviceText} ${T('sg_adapted', { civ: L(selfCiv) || selfCiv, opener: openerLabel(opener), plan: planLabel })}`
      : adviceText;

    // Append any civ-specific note (e.g. Goths → don't clump).
    let spec = null;
    for (const k of Object.keys(CIV_SPECIFIC)) {
      if (k.toLowerCase() === oppCiv.toLowerCase()) { spec = CIV_SPECIFIC[k]; break; }
    }
    const dos = (spec && spec.do ? counter.dos.concat(spec.do) : counter.dos.slice()).map(T);
    const donts = (spec && spec.dont ? counter.donts.concat(spec.dont) : counter.donts.slice()).map(T);

    // Attach a brief counter to each ranked plan (for secondary/tertiary rows).
    const plans = ranked.map(p => ({ ...p, counter: counterBriefFor(p.planArch) }));
    // Alternate builds for the player (primary first).
    const builds = buildOptions(counter, yourArch, planLabel);

    const primaryFt = FEUDAL_TAIL[opener] || FEUDAL_TAIL['Scouts'];
    return {
      their: { civ: oppCiv, planArch, planLabel, confidence, reasons, plans },
      your: { civ: norm(selfCiv) || 'your civ', plan: yourPlanText, dos, donts, keyUnits: (counter.keyUnits || []).slice(), builds },
      build: { opener: openerLabel(opener), darkAge: DARK_AGE.map(s => ({ icon: s.icon, text: T(s.text) })), feudal: { icon: primaryFt.icon, text: T(primaryFt.text) } },
      danger: null, // filled by caller from CIV_PHASE (lives in main.js)
    };
  }

  window.strategy = { buildAdvice, archetypeOf };
})();
