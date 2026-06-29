# Security Policy

## Supported versions

Goalpower is a young project. We currently security-fix:

| Version | Supported |
| ------- | --------- |
| 1.2.x   | ✅        |
| < 1.2   | ❌        |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email the maintainer at: **security@ goalpower.example** (replace with real contact before publishing).

Please include:

1. Description of the issue and its potential impact
2. Affected versions
3. Reproduction steps (minimal if possible)
4. Suggested fix if you have one
5. Whether you'd like credit in the disclosure

We will acknowledge receipt within 48 hours and aim to ship a fix within 14 days for high-severity issues.

## Disclosure

We follow coordinated disclosure:

1. Reporter reports privately
2. Maintainer acknowledges + triages
3. Fix is developed privately
4. Fix is released
5. Public advisory is published alongside the release

## Scope

**In scope:**
- Anything in `src/` that handles untrusted input
- State-file corruption vectors
- Path traversal in state directory handling
- Hook execution vulnerabilities

**Out of scope:**
- Vulnerabilities in OpenCode itself (report to the OpenCode maintainers)
- Vulnerabilities in dependencies (report upstream)
- Theoretical issues without a reproduction

## Hardening notes

Goalpower follows these security-conscious defaults:

- **File permissions:** State files are written with mode `0o600`. Parent directories `0o700`.
- **Atomic writes:** All state writes go through a `tmp → rename` pattern. Crashes mid-write leave the previous state intact.
- **No network:** The plugin makes zero outbound network calls. All state is local to `~/.config/opencode/state/goalpower/`.
- **No eval:** The plugin never `eval`s user input or LLM output. Verdict JSON is parsed with `JSON.parse` and treated as untrusted data.
- **Objective escapes:** User-provided objective text is XML-escaped (`&`, `<`, `>`) before being injected into any prompt template.
