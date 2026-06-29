# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Split `src/server.ts` into focused modules (`prompts.ts`, `state.ts`)
- TUI sidebar with live round progress visualization
- Skeptic personas (security-focused, perf-focused, correctness-focused)
- MCP server variant for non-OpenCode agents
- Verdict diff visualization between rounds

## [2.0.3] — 2026-06-29

### Added

- **Dynamic K Skeptics per round** — instead of a static `config.skeptics` value, the orchestrator now picks K adaptively based on round/stakes:
  - Round 1 or simple/low-stakes goal → K = 1 skeptic
  - Round 2-3 or high-stakes (production, security, payments) → K = 2 skeptics
  - Round 4+ OR repeatedly refuted OR "stuck" signs → K = 3 skeptics
  - Why: catches issues a single Skeptic would miss — different mental models surface different gaps. Bigger stakes → broader adversarial coverage.
- **`commands/goalpower.md`** — canonical slash command template shipped in the repo. Users can drop it into `~/.config/opencode/commands/` directly (no plugin install required) to get `/goalpower`.

### Changed

- Panel aggregation rule documented explicitly in `commands/goalpower.md`: high-confidence single-refutation OR 2+ medium-confidence agreement → REFUTED.

## [2.0.2] — 2026-06-29

### Fixed

- **CRITICAL: Plugin export shape was wrong** — was using `export const plugin = (...)` + `export default plugin`. OpenCode's plugin loader expects `{ id, server }` as the default export descriptor. Switched to the canonical pattern:

  ```ts
  const server: Plugin = (async (...) => {...}) as unknown as Plugin
  export default { id: "local.opencode-goalpower.server", server }
  export { server as plugin }
  ```

  Without this exact shape, the plugin is loaded but no commands/tools/hooks register. This was the root cause of `/goalpower` not appearing in the OpenCode TUI picker.

- Updated `test/helpers.test.ts` smoke test to validate the new `{id, server}` default-export descriptor.

## [2.0.1] — 2026-06-29

### Fixed

- **Slash command registration pattern** — was using `config: [{type:"command", ...}]` array syntax which OpenCode silently ignored. Now uses the documented lifecycle-hook pattern: `config: async (cfg) => { cfg.command[name] = { description, template } }`. Matches the @prevalentware/opencode-goal-plugin shape exactly. Fixes `/goalpower` not appearing in the OpenCode TUI picker.
- Type errors blocking CI: `Plugin` type annotation replaced with safe cast, `client` binding typed explicitly, `?? ||` precedence fixed.

### Added

- **Real test suite** in `test/helpers.test.ts` — Bun tests for `aggregatePanel` decision rule, `dedupeGaps` hygiene, `detectPrematureStop` anti-ratchet logic, plus plugin export smoke test.
- **`examples/goalpower-sessions.md`** — real `/goalpower` session transcripts: quick single-round, multi-round with prior gaps, 3-parallel-skeptic high-stakes, sub-command demos, stuck handling, compaction-mid-goal behavior.
- **Real contact email** (`info@contentplanning.ai`) in `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and `package.json` author field — replaced placeholder addresses.

## [2.0.0] — 2026-06-29

### Changed — MAJOR

- **Renamed package to `opencode-goalpower`** to reflect the project's identity as *the* goal plugin for OpenCode. Old `goalpower` references continue to work as aliases.
- **README retitled to "OpenCode Goalpower V2"** with SEO keywords for users searching for `opencode goal`, `opencode goal mode`, `opencode goal plugin`, and related queries.
- Bumped to major version 2.0.0 to signal the public, stable, community-ready release. No breaking API changes from 1.2.0 — the version bump is for naming/branding clarity.

### Added

- New SEO-friendly repo URL: `github.com/emco1234/opencode-goalpower` (old URL `emco1234/goalpower` redirects automatically).
- Keyword block in README explicitly listing all common search queries this project answers.
- Expanded `package.json` keyword set: `opencode-goal`, `opencode-goal-mode`, `opencode-goalpower`, `goal-plugin`, `ai-coding-agent`, `llm`.

### Migration from 1.x

Users who installed 1.2.0 don't need to change anything in their `opencode.jsonc`. The slash command `/goalpower` is unchanged. Plugin path can be either:

```bash
git clone https://github.com/emco1234/opencode-goalpower.git \
  ~/.config/opencode/plugins/goalpower
```

(or `opencode-goalpower` as the directory name — both work)

## [1.2.0] — 2026-06-29

### Added

- **Slash command registration via `config` array** (`type: "command"`) — `/goalpower` now appears in the OpenCode TUI picker automatically. No more separate `commands/*.md` file.
- **Plugin options via 2-tuple plugin array** — `["./plugins/goalpower", { ...options }]` instead of a top-level config key. Aligns with the OpenCode plugin API.
- **`experimental.chat.system.transform` hook** — injects `<goalpower_system_reminder>` into every turn while a goal is active.
- **`experimental.chat.messages.transform` hook** — per-assistant-message token accounting + no-progress detection.
- **`experimental.session.compacting` hook** — injects `<goalpower_compaction_preserve>` block into the post-compaction context.
- **`experimental.compaction.autocontinue` hook** — gates OpenCode's built-in auto-continue while a goal is active.
- **`session.idle` event listener** — drives the loop forward on idle.
- **`goalpower_config` tool** — read/update config live from the TUI without editing JSON.
- **Mutation-queue serialized state writes** — atomic, race-free filesystem persistence.
- **History + checkpoint arrays** on each goal — capped at 50 / 8 entries respectively.
- **Anti-ratchet contract** — prior gaps re-audited every round, premature-stop detection after `premature_stop_threshold` (default 5) consecutive rounds.
- **Honesty anchor enforcement** — `changed_files_manifest.txt` diffed against harness-tracked `CHANGED_FILES` by every Skeptic.
- **9 lifecycle tools**: `goalpower_start`, `goalpower_round_implementer`, `goalpower_round_skeptic`, `goalpower_aggregate`, `goalpower_status`, `goalpower_pause`, `goalpower_resume`, `goalpower_clear`, `goalpower_config`.
- **Full README with diagrams, examples, and configuration reference.**
- **Contributing guide, Code of Conduct, Issue templates, GitHub Actions CI.**

### Changed

- Default `max_auto_turns` is now `0` (infinite). Anti-ratchet (`premature_stop_threshold`) is the only soft cap. This better matches the spirit of long-running autonomous goal execution.
- Default `premature_stop_threshold` is now `5` (was 3 in early prototypes). Gives the Implementer more runway to fix persistent gaps.

### Removed

- Top-level plugin config key in `opencode.jsonc` (schema-invalidated; replaced by 2-tuple plugin-array entry).
- `commands: [...]` block in plugin return value (silently ignored by OpenCode; replaced by `config: [{ type: "command", ... }]`).

## [1.1.0] — 2026-06-29 (prototype)

### Added

- Initial OpenCode plugin with tools but no command registration.
- Initial Grok CLI skill variant (separate codebase).

[Unreleased]: https://github.com/emco1234/opencode-goalpower/compare/v2.0.2...HEAD
[2.0.2]: https://github.com/emco1234/opencode-goalpower/releases/tag/v2.0.2
[2.0.1]: https://github.com/emco1234/opencode-goalpower/releases/tag/v2.0.1
[2.0.0]: https://github.com/emco1234/opencode-goalpower/releases/tag/v2.0.0
[1.2.0]: https://github.com/emco1234/opencode-goalpower/releases/tag/v1.2.0
[1.1.0]: https://github.com/emco1234/opencode-goalpower/releases/tag/v1.1.0
