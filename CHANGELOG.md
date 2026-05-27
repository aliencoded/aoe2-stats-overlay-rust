# Changelog

All notable changes to this project will be documented here.

## [Unreleased] - v0.2.1 work-in-progress (2026-05-27)

### Added — Scout summary section (above ELO performance, per opponent)
- **Smurf probability tag** (0–95%): combines ELO trend across recent rated games, games count vs current rating, recent winrate, and win streak. Hover tag for contributing signals. Shows "✓ smurfing activity not detected" when data is sufficient and no signals fire.
- **Session-state tag**: detects fresh session (back after 6h+/24h+ break), warming up (last game 30–120min ago), active session (4–7 games), deep grind (8+ games).
- **Playstyle tag**: classifies opponent as early/mid/late-game player based on their most-played civ across recent matches.
- **Likely openings** by civ pick: ~45 civs mapped to common opening strats (Tower rush, Donjon rush, Drush FC, Fast scouts, M@A flush, Knight rush, etc.). Confidence % adjusts based on civ familiarity (mains vs first-pick), per-civ winrate, and average game length of recent wins. Short-win-time players (<13min) get boosted opening probability; long-game players (>35min) get it reduced.
- **Drops badge** moved from Activity section to Scout summary where it actually belongs.

### Added — Civ tendencies redesign
- Top 5 civs now visualized as a **pie chart** (110px SVG, semi-transparent, hover-tooltip per slice). Single-column legend with share %, games, and per-civ winrate.
- "Most-played X (40%)" and "highest WR Y 78% (5g)" tags grouped in a single inline box (different metrics — explained in tooltip).
- Civ-pool count and per-civ list removed (redundant with pie + key metrics).
- Section renamed "Civ tendencies" → "Top 5 civ tendencies".

### Added — Empty-state placeholders
- Every section (Scout summary, ELO performance, Top 5 civ tendencies, Activity) now renders a dashed-outline "no data yet / loading…" sub-card when its content is empty, instead of collapsing the section entirely. Card outline always visible while enrichment streams in.

### Added — Title bar + UI polish
- **Scout cavalry icon** in title bar with "INSTA" wordmark above it. Replaces the "Insta Scout" text.
- **Footer log link** ("logs" next to "contact dev") opens the log folder in Explorer.
- **Post-match card** reworded: drops the BMAC link + redundant attribution; reads "View this match to see full stats and breakdown" with the link inline.

### Added — Logging
- Backend logs now tagged **`[WEB]`** (http.rs outbound calls) or **`[LOCAL]`** (everything else — focus, mode, cache, hotkeys, boot, enrichment orchestration). Makes it easy to triage network-vs-local issues when reading `app.log`.
- Frontend update-check now logs its GitHub Releases GET as `[WEB]`.

### Fixed
- **Match URL was broken**: post-match "View this match" link pointed to `/match/<id>` (404). Companion's actual path is `/matches/<id>` (plural). Now correct.
- **Compact ↔ full mode cards disappearing**: consolidated two competing `'mode'` event listeners into one with explicit `prev !== m` guard. Re-render deferred via `setTimeout 0` so CSS class change commits before DOM rebuild. Mode-change events now log `prev → m · re-render with N opps` for traceability.
- **Civ-name case mismatch**: opening + playstyle lookups previously did case-sensitive matches against the civ map. If companion returned a differently-cased civ string, all tags silently dropped. Lookups now case-insensitive (`lookupCheese` helper + normalized `civPhase`).

### Privacy
- **Focus log no longer captures window title**. Previously the focus watcher logged every foreground window title (browser tab names, email subjects, document names). Now logs only the process name + game/self/other decision. Users attaching `app.log` to bug reports no longer leak their browsing history.

### Window
- Default full window 780 → 900 px tall (fits new Scout summary + pie chart without scroll).
- Default compact 280 → 200 px tall (tighter fit per opponent).

### Backend
- **Match duration** now plumbed end-to-end (companion `RecentMatch` → `PlayerMatch` → frontend). Parsed from companion's `duration` field with fallback to `finished - started` rfc3339 math. Feeds the opening-probability game-length adjustment.

### Dev
- Removed dead code: legacy drops badge variables, dual mode listener.

## [0.2.0] - 2026-05-26

### Rebrand
- **App is now "AoE2 Insta Scout"** (was "AoE2 Stats Overlay"). Repository name, GitHub URLs, and Windows install identifier are unchanged — your existing settings and update path are preserved.
- Executable renamed: `aoe2-stats-overlay.exe` → `aoe2-insta-scout.exe`. Installer files follow the same pattern. Existing v0.1.x users: download the new file from the releases page.

### Added
- **Per-format breakdown** on each card: 1v1 / TG / Unranked rows with games, winrate, ELO trend, last-5 W/L, top civ in that format, rating range, and record on the current map. Current match's format is highlighted. Career streak from companion's per-format rank shown next to the matching row.
- **Settings panel** (gear icon): pick which sections show in full vs. compact mode. Persisted across restarts.
- **Post-match "support aoe2companion" card** with Buy-Me-a-Coffee + match-link buttons.
- **In-app update banner** polls GitHub Releases on boot, shows a dismissible banner when a newer version is available.
- **"Check now" button** when app is idle — short-circuits the 90s poll cycle for users who just queued.
- **Rating range, activity counts (today/week), map record, ELO trend, colored streak badge** — all derived client-side from existing fetched data.
- **Frontend → Rust log bridge**: silently-swallowed errors (update-check failures, dropped shortcuts, companion outages) now land in `app.log`.

### Fixed
- **Wrong-player stats bug**: rank-search by name returned fuzzy matches on companion's side, causing stats from a stranger to load under your opponent's name. Now uses canonical `profile_id` from the match endpoint; name never overwritten by rank-search results.
- **Compact-mode quit button** was hidden — now visible in both modes.
- **Shrink countdown** no longer overlaps the hotkey hint footer.

### Performance / API courtesy
- **Idle poll interval bumped 10s → 90s.** Drops idle backend load from ~720 calls/hr to ~40 calls/hr per user. The new "Check now" button covers the few seconds after queue pop where users want it immediately.
- **Player enrichment is fully parallel**: across players (was sequential, ~30s for a 4v4) and within a player (1v1 and TG rank calls fire together).
- **Single 40-match fetch** per player (was 1 recent + 3 deep = 4 calls). Halves the per-enrichment cost.

### Honesty
- Server-side aggregates (top civs, rating range, map record) are now labeled "any format". Companion's `/api/matches` endpoint ignores the `leaderboard_id` filter param, so previously-labeled "this format" stats were actually mixed. The per-format breakdown gives the honest per-format view.

### Window
- **Dynamic compact-mode resize** auto-fits content (100–800 px range), no spurious scrollbar.
- **Auto-shrink countdown** with visible timer + "click to keep full" cancel.
- Renamed "pill mode" → "compact mode" everywhere user-facing. Settings auto-migrate.
- Default window width 420 → 520 px to fit the per-format breakdown without wrapping.

## [0.1.1] - 2026-05-26

### Fixed
- **Wrong-player stats bug**: rank-search by name returned fuzzy matches on companion's side, causing the overlay to display a stranger's stats under your opponent's name. Now uses the canonical `profile_id` from the match endpoint whenever available; name is never overwritten by rank-search results.
- **Pill mode quit button**: the close `×` was hidden in pill mode. Now visible in both modes.

### Performance
- **Parallel player enrichment**: previously enriched players one at a time (≥7s per player), so a 4v4 took 30+ seconds. Now all players enriched concurrently via `futures::join_all` (~5–8s total regardless of team size).
- **Parallel rank lookups**: 1v1 and TG rank queries within a single player now fire together instead of sequentially.

### Added
- **Rating range** per player: min and max ELO across the last 60 games in the current format, displayed prominently under the main rating line.

## [0.1.0] - 2026-05-24

Initial release. Tauri 2 + Rust rewrite of the original Electron prototype.

- Live opponent stats: 1v1 + TG rating, rank, games, winrate, streak
- Top civs in current format (last 60) and recent picks (last 20)
- Last 5 matches with W/L, civ, map, ELO change, time ago
- Auto full ↔ pill mode based on game focus
- Hotkeys: `Ctrl+Shift+S` toggle · `Ctrl+Shift+R` refresh · `Ctrl+Shift+C` click-through
- Tray icon with show/hide, open log folder, quit
- Single ~6 MB portable .exe; ~2–3 MB MSI/NSIS installers
