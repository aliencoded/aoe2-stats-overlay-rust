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
- Does not store credentials, accept user input that reaches the network, or run code from the network.

Most-impactful classes of bugs to look for: command-injection via `open_external`, registry parsing crashes, malicious HTTP response handling in the companion API client.
