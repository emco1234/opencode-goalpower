# Example: Basic objective

A simple refactor task that demonstrates the standard loop.

## Setup

Project: a TypeScript library with a `legacyAuth.ts` file that uses an old token format. The new format is in `auth.ts`. Multiple callers need to be updated.

## Invocation

```
/goalpower Refactor src/legacyAuth.ts to use the new token format from src/auth.ts and update all callers. Make sure `bun test` still passes.
```

## Expected loop

**Round 1 (Implementer):**
- Reads `legacyAuth.ts`, `auth.ts`, and all callers.
- Edits callers to use `auth.ts`.
- Writes `plan.md` listing the 6 callers + acceptance criteria (`bun test` green, no references to `legacyAuth.parseToken`).
- Writes `unit_exercise.log` with raw `bun test` output.

**Round 1 (Skeptic):**
- Re-reads `legacyAuth.ts` — finds 2 callers were missed.
- Writes verdict-1-0.json with `refuted: true, confidence: high`, finding `bug at src/utils/handler.ts:42 — still calling legacyAuth.parseToken`.

**Round 1 (Aggregation):** REFUTED — 1 high-confidence gap.

**Round 2 (Implementer):**
- Reads the gap. Edits `src/utils/handler.ts` and one more file the Skeptic flagged.
- Re-runs `bun test`. Writes new `unit_exercise.log`.

**Round 2 (Skeptic):**
- Re-audits the prior gap from round 1 — FIXED.
- Audits the new edits — all callers updated, tests pass.
- Writes verdict-2-0.json with `refuted: false`.

**Round 2 (Aggregation):** ACCEPTED.

**Total: 2 rounds, ~6 minutes.**
