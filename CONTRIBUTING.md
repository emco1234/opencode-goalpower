# Contributing to Goalpower

First off — **thank you** for taking the time to contribute. 🎉

This document describes how to set up a development environment, the conventions this project follows, and how to submit changes.

## Code of Conduct

By participating in this project you agree to abide by its [Code of Conduct](./CODE_OF_CONDUCT.md). Please report unacceptable behavior to the maintainers.

## Project status

Goalpower is actively maintained. The architecture follows the OpenCode plugin pattern (v1.17.1+) and the multi-round Skeptic-Verified pattern documented in [README.md](./README.md).

## Development setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.1 (for runtime + tests + lint)
- [OpenCode](https://opencode.ai) >= 1.17.1 (for manual testing)
- Git

### Get the code

```bash
git clone https://github.com/emco1234/goalpower.git
cd goalpower
bun install
```

### Useful scripts

```bash
bun run typecheck   # TypeScript strict mode, no emit
bun run lint        # ESLint
bun run format      # Prettier write
bun test            # Run unit tests
```

### Manual testing in OpenCode

1. **Symlink your dev checkout into the OpenCode plugins directory:**

```bash
# macOS / Linux
ln -sf "$PWD" ~/.config/opencode/plugins/goalpower

# Windows (PowerShell, admin)
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.config\opencode\plugins\goalpower" -Target "$PWD"
```

2. **Make sure `opencode.jsonc` registers it:**

```jsonc
{
  "plugin": [
    ["./plugins/goalpower", { "skeptics": 1 }]
  ]
}
```

3. **Restart OpenCode.** Run `/goalpower status` to confirm the plugin loaded.

## Architecture overview

The plugin is organized around four concepts:

| Concept | File | Responsibility |
|---|---|---|
| Orchestrator | `src/server.ts` | Plugin entry; tools, hooks, command registration |
| Prompts | `src/prompts.ts` (planned) | System reminder, continuation prompt, compaction context |
| State | `src/state.ts` (planned) | Filesystem-backed atomic state with mutation queue |
| TUI | `src/tui.tsx` | Status-line rendering (optional) |

Currently everything lives in `src/server.ts` for ease of review. Splitting into the above files is on the roadmap — see [open issues](https://github.com/emco1234/goalpower/issues).

### Key invariants

These invariants are load-bearing. Do not break them in a PR without discussion:

1. **Honesty anchor** — `changed_files_manifest.txt` MUST be diffed against the harness-tracked `CHANGED_FILES` by every Skeptic.
2. **Anti-ratchet** — prior gaps MUST be re-audited every round.
3. **Atomic writes** — all state writes go through `tmp → rename`, mode `0o600`, parents `0o700`.
4. **Compaction preservation** — goal state MUST survive `/compact` via both context injection AND disk source-of-truth.
5. **Infinite loop by default** — `max_auto_turns = 0` is the documented default. Anti-ratchet (`premature_stop_threshold`) is the only soft cap.

## Coding standards

- **TypeScript strict mode.** No `any`, no `// @ts-ignore` without an inline justification comment.
- **No external deps for trivial utilities.** Crypto, fs, path — use Node builtins.
- **Error messages are actionable.** "No active goalpower session" is bad. "No active goalpower session. Start one with /goalpower <objective>." is good.
- **Tests for new tools.** Every new `tool[]` entry should have at least one unit test exercising the happy path.

## Commit message conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `refactor` — code change that neither fixes a bug nor adds a feature
- `perf` — code change that improves performance
- `test` — adding missing tests or correcting existing tests
- `chore` — build, deps, config, tooling

Example:

```
feat(skeptic): add per-prior-gap status output in verdict details_md

Each verdict now includes a "Per-Prior-Gap Status" section that
classifies every prior gap as FIXED / PARTIAL / UNFIXED / REGRESSED.
This makes the anti-ratchet contract more transparent to the next
round's Implementer.
```

## Pull request flow

1. **Open an issue first** for any non-trivial change. Discuss the approach before writing code.
2. **Fork & branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Write code + tests.** Run `bun run typecheck && bun run lint && bun test` locally.
4. **Commit using conventional commits.** Small, focused commits preferred.
5. **Open a PR** against `main`. Fill in the PR template:
   - What does this change?
   - Why is it needed?
   - How was it tested?
   - Any breaking changes?
6. **Address review feedback.** Push additional commits; do not force-push during review unless asked.

CI runs `typecheck`, `lint`, and `test` on every PR. All three must pass for merge.

## Issue triage

Issues are labeled with:

- `bug` — something doesn't work as documented
- `enhancement` — new feature request
- `question` — usage question
- `good first issue` — small, well-scoped, beginner-friendly
- `help wanted` — bigger contribution wanted
- `documentation` — docs improvements

If you're new, look for `good first issue` first.

## Releasing

Releases are cut from `main` and tagged with semver:

```
v1.2.0   # minor: new feature, backward compatible
v1.2.1   # patch: bug fix
v2.0.0   # major: breaking change
```

The release process is documented in `scripts/release.md` and automated via GitHub Actions (`.github/workflows/release.yml`).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

## Questions?

Open a [discussion](https://github.com/emco1234/goalpower/discussions) or an [issue](https://github.com/emco1234/goalpower/issues/new). Maintainers respond within 1–2 days typically.
