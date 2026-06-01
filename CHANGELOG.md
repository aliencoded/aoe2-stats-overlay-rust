# Changelog

All notable changes to this project will be documented here.

## [0.3.0] - 2026-06-01

### Added
- **Build advice (PLAN) card** in 1v1: predicts the opponent's likely opening from their civ, the map, and their recent picks, then recommends a counter direction, a generic early-game build order, key units, do's/don'ts, and the danger window — all confidence-tagged ("likely", never certain). Fully offline heuristics.
- **New-match auto-focus**: on a new 1v1, the opponent + PLAN cards stay open for 2 minutes (visible countdown), then the opponent card auto-collapses so the build order stays in focus. Any manual card click cancels the timer.
- **All cards collapsible** — click any card header to expand/collapse; hover glow on every card.
- **Desktop-window mode** (Settings): opaque, resizable, decorated window for a second monitor.
- **Adjustable overlay opacity** slider in Settings.
- **Rank percentile** shown alongside ladder rank.
- **Anonymous, opt-out usage ping** so install counts can be tracked. Sends only a random per-install ID, the app version, and `"win"` — never your Steam ID, profile, name, or match data. Toggle in Settings → Appearance; off by switch and the app talks to GitHub directly. See SECURITY.md.
- New app icon.

### Changed
- **Compact / pill mode removed** — one always-on-top overlay; in-game simplification is handled by per-card auto-collapse instead.
- Settings reorganized: per-section toggles, build-advice part toggles, post-match card toggle, appearance (opacity + desktop window).
- **Strategy, build-advice, and opening-prediction text is now fully localized** in all 10 languages (previously English-only).

### Fixed
- **Blank card vs non-Latin opponent names** — opponents with CJK/Cyrillic/other non-Latin names (e.g. `惠惠神獸`) failed to parse from the live-match feed, leaving the card empty. The parser now accepts Unicode names.
- Settings **"Done"** button now translates.

### Removed
- `Ctrl+Shift+S` show/hide hotkey (compact mode is gone).

## [0.2.0] - 2026-05-27

Rebranded from "AoE2 Stats Overlay" to **AoE2 Insta Scout**. Executable renamed to `aoe2-insta-scout.exe`.

### Added
- **Scout summary** section per opponent: smurf probability, session state (fresh / warming up / deep grind), playstyle tag (early / mid / late-game), likely openings by civ pick with confidence %, drops badge.
- **Per-format breakdown** (1v1 / TG): career stats, ELO trend chart, rating range, last 5 W/L, map record.
- **Top 5 civ tendencies** as a pie chart with share %, games, and per-civ winrate. Most-played and highest-WR civs called out. Mirror civ alert if their main matches your pick.
- **Language support**: English, Español, Deutsch, Français, Italiano, Português (BR), Русский, Polski, 中文, 한국어. Official AoE2DE civ names.
- **Settings panel** (gear icon): pick which sections show in full vs compact mode, change language.
- **In-app update banner** on boot when a newer version is available.
- **"Check now" button** when idle, for when you just queued.
- **Post-match card** with link to view the match on aoe2companion.

### Fixed
- **Wrong-player stats**: now uses canonical profile ID instead of fuzzy name search.
- **Cards disappearing** when switching between full and compact mode.
- Compact-mode quit button is no longer hidden.

### Privacy
- Focus log no longer captures window titles. Safe to attach `app.log` to bug reports.

### Performance
- Idle poll interval bumped from 10s to 90s (~18× less load on aoe2companion).
- Player enrichment is now fully parallel (4v4 enriches in seconds instead of ~30s).

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
