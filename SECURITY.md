# Security Policy

## Supported Versions

Only the latest release on the [releases page](https://github.com/aliencoded/aoe2-stats-overlay-rust/releases/latest) is supported.

## Reporting a Vulnerability

Found a security issue? Please **do not** open a public GitHub issue.

Instead, use GitHub's **[private vulnerability reporting](https://github.com/aliencoded/aoe2-stats-overlay-rust/security/advisories/new)** — it sends the report directly to me, privately, with a structured disclosure flow.

If that's not an option, email the address listed on my GitHub profile.

I'll acknowledge within a few days and aim to patch within 2 weeks for confirmed issues.

## Scope

This is a read-only client. It:
- Reads `HKCU\Software\Valve\Steam\ActiveProcess\ActiveUser` from the Windows registry (local, not transmitted).
- Makes HTTPS GETs to `data.aoe2companion.com` and opens external links in the user's default browser.
- On boot, checks for a newer release and (if the usage ping is enabled) sends an anonymous install ping — see **Privacy & Telemetry** below.
- Does not store credentials, accept user input that reaches the network, or run code from the network.

## Privacy & Telemetry

The overlay sends an optional, anonymous **install ping** on startup so the maintainer can count active installs.

- **What is sent:** a random per-install UUID (generated locally, not derived from anything identifying), the app version, and the OS tag `"win"`.
- **What is never sent:** your Steam ID, aoe2companion profile, player name, match data, or IP-as-identity.
- **Where:** the project's own Cloudflare Worker (`telemetry/` in this repo) backed by a Cloudflare D1 table — no third-party analytics SDK.
- **Opt-out:** Settings → *Appearance* → **"Send anonymous usage ping"**. Turn it off and the app contacts the GitHub releases API directly for the update check instead; the telemetry endpoint never sees your install.
- The ping also returns the latest release version, so it doubles as the update check (one request, no extra calls).

Most-impactful classes of bugs to look for: command-injection via `open_external`, registry parsing crashes, malicious HTTP response handling in the companion API client.
