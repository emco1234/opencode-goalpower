# Real `/goalpower` Session Examples

This doc captures what running `/goalpower` actually looks like in the OpenCode TUI.

## Example 1 — Quick refactor (single-round acceptance)

**Invocation:**

```
/goalpower Add type annotations to src/utils/format.ts and ensure bun test passes
```

**Round 1 — Implementer:**
- Reads `src/utils/format.ts`, `src/utils/format.test.ts`
- Adds annotations: `formatDate(date: Date): string`, `formatBytes(bytes: number): string`
- Runs `bun test` — passes
- Writes `plan.md` with acceptance criteria: "all functions annotated; tests green"
- Writes `unit_exercise.log` with raw `bun test` output
- Writes `changed_files_manifest.txt`: 1 file (format.ts)

**Round 1 — Skeptic:**
- Re-reads `format.ts` — annotations present ✓
- Re-reads `format.test.ts` — tests still reference same exports ✓
- Re-runs `bun test` independently — passes ✓
- `verdict-1-0.json`:
  ```json
  {
    "refuted": false,
    "findings": [],
    "evidence": "format.ts:14 has `formatDate(date: Date): string`; bun test green",
    "confidence": "high"
  }
  ```

**Aggregation:** ACCEPTED. **Total: 1 round, ~2 minutes.**

---

## Example 2 — Multi-round with prior gaps (typical case)

**Invocation:**

```
/goalpower Migrate the checkout flow from Stripe API v2 to v3. Preserve all webhook signatures, idempotency keys, and error-retry semantics. Update tests.
```

### Round 1

**Implementer:**
- Edits 6 files in `src/payments/`
- Updates test fixtures
- Writes plan with 5 acceptance criteria
- Runs tests → 1 failing
- Notes the failure in `verif_self.txt`

**Skeptic finds:**
1. `bug` — `src/payments/webhook.ts:42` still uses `stripe.events.construct` (v2 API)
2. `gap` — `unit_exercise.log` is missing the raw webhook test output

**Aggregation:** REFUTED. 2 gaps.

### Round 2

**Implementer (sees prior_gaps from round 1):**
- Re-audits gap 1: fixes webhook.ts
- Re-audits gap 2: re-runs webhook tests, captures raw output to log
- Updates plan to reflect the fix
- Notes both gaps as FIXED in `verif_self.txt`

**Skeptic re-audits:**
- Per-Prior-Gap Status: gap 1 = FIXED, gap 2 = FIXED
- New check: finds a 3rd gap — idempotency key not propagated in one retry path
- `verdict-2-0.json`: `refuted: true`, 1 new finding

**Aggregation:** REFUTED. 1 new gap (prior gaps fixed).

### Round 3

**Implementer:**
- Fixes idempotency key propagation
- All prior gaps confirmed fixed in `verif_self.txt`

**Skeptic re-audits:**
- All prior gaps still FIXED
- No new findings

**Aggregation:** ACCEPTED. **Total: 3 rounds, ~15 minutes.**

---

## Example 3 — High-stakes with 3 parallel Skeptics

**Pre-config:**
```
/goalpower config skeptics=3 premature_stop_threshold=7
```

**Invocation:**

```
/goalpower Add user authentication with JWT, refresh tokens, and role-based access control. Migration must be zero-downtime. Add tests for all auth flows.
```

**Round N — 3 Skeptics in parallel:**

Each Skeptic gets the same inputs but typically focuses on different concerns:

- **Skeptic #0** (security focus): catches that JWT secret is logged on error
- **Skeptic #1** (correctness focus): catches refresh token rotation bug
- **Skeptic #2** (acceptance criteria focus): catches missing admin-role test

All 3 write their verdicts in parallel. **Aggregation rule:** any high-confidence refutation → round refuted. So the union of findings goes back to the Implementer.

This pattern catches issues a single Skeptic would miss — different mental models surface different gaps.

---

## Sub-command examples

```
/goalpower status                              # → "Round 2/active, 3 prior gaps"
/goalpower pause                               # halts after current round
/goalpower resume                              # continues from where paused
/goalpower clear                               # drops state (asks confirmation)
/goalpower edit Migrate to Auth0 instead       # new objective, keep prior gaps
/goalpower config skeptics=2                   # bump parallel panel size
/goalpower config premature_stop_threshold=10  # more runway before stuck
```

---

## When the loop gets stuck

If the same gap persists for `premature_stop_threshold` rounds (default 5):

```
Round 5: REFUTED (1 gap) — same gap as rounds 1-4
[goalpower] Goal is stuck on: src/auth.ts:42 — refresh token not rotated
[goalpower] Status changed to "stuck". Manual intervention needed.
[goalpower] State preserved at ~/.config/opencode/state/goalpower/<sid>/
[goalpower] Run /goalpower resume to continue with a fresh budget of rounds.
```

The state is preserved on disk. You can:
1. Manually fix the gap
2. Run `/goalpower resume` — the Implementer will see your fix and re-audit
3. Or `/goalpower clear` to drop the goal entirely

---

## Compaction mid-goal

If the context fills up mid-round and `/compact` fires:

1. The `experimental.session.compacting` hook injects a `<goalpower_compaction_preserve>` block into the post-compaction context
2. The block contains: objective (verbatim), current_round, prior_gaps (full list), recent verdicts, state_dir path
3. After compaction, the orchestrator re-reads `goal.json` from disk as source of truth
4. Loop continues from `current_round + 1` with all prior_gaps intact

You won't lose hours of progress to a context-window cleanup.
