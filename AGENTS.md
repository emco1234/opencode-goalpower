# AGENTS.md — guidance for AI agents working in this repo

> This file is intended for AI coding agents (Claude, GPT, Cursor, etc.) who are asked to make changes to this repository. It captures the architecture invariants and conventions that are easy to break by accident.

## What this repo is

Goalpower is an OpenCode plugin (TypeScript, runs on Bun) that adds a multi-round Skeptic-Verified goal-execution loop. The plugin lives in `src/server.ts` (single file for now; roadmap: split into `prompts.ts`, `state.ts`).

## Load-bearing invariants — DO NOT BREAK

1. **Honesty anchor.** Every Skeptic MUST diff `implementer/changed_files_manifest.txt` against the harness-tracked `CHANGED_FILES`. Listing files not really edited, or omitting files that were edited, is the highest-severity finding.

2. **Anti-ratchet.** Prior gaps from previous rounds MUST be re-audited every round. They don't disappear because new code was written. If the same gap persists for `premature_stop_threshold` consecutive rounds, the goal auto-pauses with `status="stuck"`.

3. **Infinite loop by default.** `max_auto_turns = 0` means infinite. The only soft cap is `premature_stop_threshold`. Do not introduce a static round cap "for safety" — that's a regression in behavior, not an improvement.

4. **Atomic state writes.** All state writes go through `tmp → rename`, file mode `0o600`, parent dirs `0o700`. Mutation-queue serialized. Never write to `goal.json` directly without going through `writeGoal()`.

5. **Compaction preservation.** When `/compact` fires mid-goal, the `experimental.session.compacting` hook MUST inject a `<goalpower_compaction_preserve>` block into the post-compaction context. State files on disk are the source of truth — even if the in-context block is lost, the agent must be able to re-read `goal.json` and resume.

6. **No personal paths in source.** Use `os.homedir()` + `path.join(...)`. Never hard-code `/c/Users/corov/...` or `/Users/...`.

7. **Schema-safe plugin options.** Plugin options flow in via the 2-tuple plugin array: `["./plugins/goalpower", { options }]`. NOT via a top-level key in `opencode.jsonc` (OpenCode schema-strict validation rejects unknown top-level keys).

8. **Slash command via `config` array.** The `/goalpower` command is registered programmatically in the plugin's return value: `config: [{ type: "command", name, description, template }]`. NOT via a separate `commands/*.md` file.

## Common agent mistakes (don't do these)

- ❌ Adding a top-level `goalpower: {...}` key to `opencode.jsonc` — schema-invalidates
- ❌ Putting a `commands: [...]` block in the plugin return value — silently ignored
- ❌ Reading `params.config` — there is no `config` field in the OpenCode plugin params
- ❌ Hard-coding paths like `~/.grok/state/...` — that's a sibling project, not this one
- ❌ Adding a `max_rounds` hard cap "because 8 seems reasonable" — it's intentionally infinite
- ❌ Skipping the Skeptic phase "to save time" — Skeptics are the entire point
- ❌ Replacing `JSON.parse(verdictFile)` with a "safer" schema validator — verdicts are untrusted, but the schema is documented in `src/server.ts` and parsing is intentionally lenient

## What "done" means for a PR

A PR is mergeable when:

- [ ] `bun run typecheck` clean (strict mode)
- [ ] `bun run lint` clean
- [ ] `bun test` passing
- [ ] No personal paths introduced
- [ ] If a tool/hook was added: a test exists for the happy path
- [ ] If user-facing: CHANGELOG.md `[Unreleased]` updated
- [ ] Conventional commit messages

## Architecture cheat-sheet

```
src/server.ts (current single-file layout)
├── Options (config via plugin-array 2-tuple)
├── State (atomic, filesystem-backed, mutation-queued)
├── Prompt builders (continuation, systemReminder, compactionContext, limitPrompt)
├── Subagent prompts (implementerSubagentPrompt, skepticSubagentPrompt)
├── Panel aggregation (aggregatePanel, dedupeGaps, detectPrematureStop)
└── Plugin export
    ├── config: [{ type: "command" }] — 1 slash command
    ├── tool: [...] — 9 tools
    ├── hooks: [...] — 5 hooks (system.transform, messages.transform, session.compacting, compaction.autocontinue, session.idle)
    └── events: []
```

## When in doubt

Open an issue with the question. Don't guess.
