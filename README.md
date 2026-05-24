# AoE2 Opponent Stats Overlay

[![Release](https://img.shields.io/github/v/release/aliencoded/aoe2-stats-overlay-rust)](https://github.com/aliencoded/aoe2-stats-overlay-rust/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

In-game overlay for **Age of Empires II: Definitive Edition**. Shows your opponent's rating, top civs, and last 5 matches — right on top of the game, while you play.

Project page: https://www.thinkingslightly.com/aoe2-opponent-stats-ui-overlay/

## Download

- **[Portable .exe](https://github.com/aliencoded/aoe2-stats-overlay-rust/releases/latest/download/aoe2-stats-overlay.exe)** (~6 MB, no install)
- [NSIS / MSI installers](https://github.com/aliencoded/aoe2-stats-overlay-rust/releases/latest)

Windows 10/11. Steam version of AoE2DE. SmartScreen will warn — click **More info → Run anyway** (not signed; codesign certs are ~$200/yr).

## What you get

- **Live opponent stats** the moment a match loads: 1v1 + TG ELO, rank, games, winrate, streak
- **Top civs** in current format (last 60 matches) + last 5 picks with W/L, map, ELO change, time ago
- **Self bar** with your own ratings
- **Auto full ↔ pill mode** based on game focus
- **Hotkeys:** `Ctrl+Shift+S` toggle · `Ctrl+Shift+R` refresh · `Ctrl+Shift+C` click-through

## Data source

[aoe2companion.com](https://www.aoe2companion.com/) — same data their mobile app and site use. Polite User-Agent identifies the app, links back here so their maintainer can reach me. No analytics, no error reporting, no account, no Microsoft/Xbox calls.

## Tech

Tauri 2 + Rust. Vanilla HTML/CSS/JS frontend, no build step. Native Win32 calls (`GetForegroundWindow`, registry read for SteamID) instead of shelling out. ~6 MB portable build vs ~80 MB Electron prototype.

## Build from source

Requires:
- Rust MSVC toolchain (`rustup default stable-x86_64-pc-windows-msvc`)
- VS 2022 Build Tools + VCTools workload + Windows 11 SDK
- Node 18+

```
git clone https://github.com/aliencoded/aoe2-stats-overlay-rust
cd aoe2-stats-overlay-rust
npm install
npm run tauri dev      # dev, hot-reload
npm run tauri build    # release exe + installers
```

Plain PowerShell lacks `link.exe` in PATH. Run from "x64 Native Tools Command Prompt for VS 2022", or `call vcvars64.bat` first.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

Not affiliated with Microsoft, Xbox Game Studios, World's Edge, or Forgotten Empires. Age of Empires II: Definitive Edition is a trademark of its respective owners. Use at your own risk.
