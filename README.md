# AoE2 Insta Scout

[![Release](https://img.shields.io/github/v/release/aliencoded/aoe2-stats-overlay-rust)](https://github.com/aliencoded/aoe2-stats-overlay-rust/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Instant in-game opponent scouting for **Age of Empires II: Definitive Edition**. Shows your opponent's rating, civ tendencies, likely openings, smurf probability, and session state — right on top of the game, while you play.

![Hero](docs/screenshots/hero-v2.webp)

Project page: https://www.thinkingslightly.com/aoe2-opponent-stats-ui-overlay/

## Download

- **[Portable .exe (latest)](https://github.com/aliencoded/aoe2-stats-overlay-rust/releases/latest/download/aoe2-insta-scout.exe)** — ~6 MB, no install, just run
- [All releases + installers](https://github.com/aliencoded/aoe2-stats-overlay-rust/releases) — MSI / NSIS / older versions

See [CHANGELOG.md](CHANGELOG.md) for what's new.

Windows 10/11. Steam version of AoE2DE. SmartScreen will warn — click **More info → Run anyway** (not signed).

## Screenshots

| Full card | Scout summary detail |
|---|---|
| ![Full](docs/screenshots/full-card-v2.webp) | ![Scout summary](docs/screenshots/scout-summary.webp) |

## What you get per opponent

**Scout summary**
- **Smurf probability** (0–95%). Hover for the signals behind it.
- **Session state**: fresh session, warming up, deep grind
- **Playstyle**: early / mid / late-game player
- **Likely openings** by their civ pick (Tower rush, Donjon rush, Fast scouts, Drush FC, etc.) with confidence %
- **Drops badge**: rage-quit signal

**ELO performance** (per format — 1v1 / TG)
- Career games, winrate, streak
- ELO trend chart + net change
- Rating range, last 5 W/L sequence
- Record on the current match's map

**Top 5 civ tendencies** (per format)
- Pie chart of top 5 civs with share %, games, winrate
- Most-played vs highest-WR civ called out separately
- ⚠ Mirror civ alert if their main matches your pick

**Activity**
- Games today / this week
- Their last 5 matches: civ, map, ELO change, time ago

Plus your own stats bar above the opponents and a faded "last match" view after the game ends.

## Hotkeys

- `Ctrl+Shift+S` — toggle full ↔ compact
- `Ctrl+Shift+R` — force refresh
- `Ctrl+Shift+C` — toggle click-through (clicks pass to the game)
- ⚙ gear icon — settings: pick which sections show in each mode, change language

Auto switches full ↔ compact when you focus / unfocus the game.

## Languages

English, Español, Deutsch, Français, Italiano, Português (BR), Русский, Polski, 中文, 한국어. Civ names use the official AoE2DE translations. Pick yours in Settings — no restart needed.

## Comparison

| Tool | Auto-detect opp | Per-format split | Smurf detection | Opening prediction | Civ pie chart | In-game |
|---|---|---|---|---|---|---|
| aoe2companion (web/mobile) | ✗ manual lookup | partial | ✗ | ✗ | ✗ | ✗ browser/phone |
| aoe2insights.com | ✗ manual lookup | ✗ | ✗ | ✗ | ✗ | ✗ |
| Discord !opp bots | ✗ chat command | ✗ | ✗ | ✗ | ✗ | ✗ |
| CaptureAge | spectator only | ✗ | ✗ | ✗ | ✗ | spec client |
| OBS browser overlays | partial | ✗ | ✗ | ✗ | ✗ | viewer only |
| **Insta Scout** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Data source

All stats come from [aoe2companion.com](https://www.aoe2companion.com/) — the same public data their app and site use. No analytics, no error reporting, no account, no Microsoft/Xbox calls.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

Not affiliated with Microsoft, Xbox Game Studios, World's Edge, or Forgotten Empires. Age of Empires II: Definitive Edition is a trademark of its respective owners. Use at your own risk.
