---
description: Goalpower — autonomous long-running goal mode with multi-round skeptic verification (local reimplementation)
agent: build
---

The user has run `/goalpower` with these arguments:

```
$ARGUMENTS
```

You are now in GOALPOWER MODE — autonomous, multi-round, skeptic-verified goal execution.

## Routing rules

Read the arguments and follow the matching branch. **Do NOT ask the user to clarify.**

- **Empty OR `status`** → call `goalpower_status`, summarize in 3-5 lines.
- **`pause`** → call `goalpower_pause`.
- **`resume`** → call `goalpower_resume`.
- **`clear`** → call `goalpower_clear`.
- **`edit <new objective>`** → replace the active session's objective with the new text. Reset round counter; keep prior_gaps as anti-ratchet.
- **`config` OR `config <k=v k=v ...>`** → call `goalpower_config` with the remaining args as `updates`.
- **Otherwise** → treat the entire `$ARGUMENTS` as the OBJECTIVE and start a new goal loop.

## Default config (lives in ~/.config/opencode/state/goalpower/config.json)

- `max_auto_turns = 0` (INFINITE — no static cap, mirrors the original)
- `skeptics = 1` (bump to 2-3 for high-stakes goals)
- `premature_stop_threshold = 5` (anti-ratchet: same gap 5 consecutive rounds → auto-pause)
- `preserve_on_compact = true`

## Loop protocol (when starting a new goal)

1. **Start session.** Call `goalpower_start` with `{objective: $ARGUMENTS}`. Receive `{session_id, state_dir}`. Persist this — every subsequent tool call needs it.

2. **Round loop** (N starts at 1, INFINITE unless premature-stop):

   **2a. Implementer phase.** Call `goalpower_round_implementer` with `{session_id}`. Receive the subagent prompt. Spawn a `goalpower-implementer` subagent with that prompt. Wait for the subagent to return its summary. The subagent writes its files (plan.md, research_notes.txt, unit_exercise.log, verif_self.txt, changed_files_manifest.txt, final_response.md, patch.diff) to `state_dir/implementer/` before returning.

   **2b. Skeptic phase (parallel panel — DYNAMIC K).** Decide K based on stakes:
   - Round 1 or simple/low-stakes goal → **K = 1** skeptic
   - Round 2-3 or high-stakes (production, security, payments) → **K = 2** skeptics
   - Round 4+ OR repeatedly refuted OR "stuck" signs (3+ consecutive rounds same gap) → **K = 3** skeptics

   Call `goalpower_round_skeptic` K times, each with `{session_id, skeptic_index=0..K-1, implementer_summary=<from 2a>, changed_files=[harness-tracked list]}`. Receive `{subagent_prompt, output_files}`. Spawn K `goalpower-skeptic` subagents **in parallel** with those prompts. Each writes `verdict-{N}-{k}.json` and `skeptic-{N}-{k}.md` to state_dir.

   Why dynamic K: catches issues a single Skeptic would miss — different mental models surface different gaps. Bigger stakes → broader adversarial coverage.

   **2c. Aggregation.** Call `goalpower_aggregate` with `{session_id}`. Receive `{decision, reason, merged_gaps, prior_gaps_next_round, premature_stop?, max_rounds_reached?}`. Aggregation rule:
   - ANY skeptic with `refuted=true AND confidence=high` → REFUTED
   - 2+ skeptics with `refuted=true AND confidence=medium` → REFUTED
   - Otherwise → ACCEPTED

   **2d. Branch on decision:**
   - `decision === "accepted"` → Report final success (objective, rounds used, total elapsed, patch path, top 3 acceptance criteria with verification evidence) and EXIT.
   - `decision === "refuted"` AND `premature_stop === true` → report "Goal stuck on: <gap>. Manual intervention needed." Surface the round summary path. STOP.
   - `decision === "refuted"` AND `max_rounds_reached === true` (only when `max_rounds > 0`) → report "Max rounds reached without acceptance." STOP.
   - `decision === "refuted"` otherwise → feed `merged_gaps` back into the Implementer's prompt for round N+1 (this happens automatically inside `goalpower_round_implementer` because it reads prior_gaps from goal.json). Increment N, go to 2a.

3. **Heartbeat discipline.** During the loop: minimal output. One heartbeat every 60s: `[round N, skeptic k/K, elapsed Xm]`. Round boundary: single line `Round N: REFUTED (K gaps) | ACCEPTED`. Never narrate internal reasoning.

## Compact preservation (CRITICAL)

If the context window approaches its limit and `/compact` is needed mid-loop:

1. **Before compacting**, the plugin's `experimental.session.compacting` hook automatically injects a `<goalpower_compaction_preserve>` block into the post-compaction context.

2. **After compacting**, re-read `state_dir/goal.json` from disk as the source of truth — do not rely on in-context summaries alone. The disk file is authoritative.

3. **Compaction mid-round is forbidden** — wait for the round boundary (after `goalpower_aggregate`, before next `goalpower_round_implementer` call).

4. The objective, current_round, and prior_gaps list MUST survive compaction. If you forget these, the user loses hours of progress.

## Stop conditions (hard pauses)

ALWAYS pause and surface to user before:

- `git push` to any remote
- Deploy / publish / external API write
- `rm -rf` or destructive filesystem op outside state_dir
- 3 consecutive rounds with the same gap (anti-ratchet trigger; auto-pause via `status="stuck"`)

## What "achieved" means

The goal is achieved iff ALL skeptics return `refuted=false` (or only low-confidence refutations with no high agreement). Concretely:

- Every acceptance criterion in `plan.md` verified by a real artifact (file edit, test pass, grep result)
- `patch.diff` matches `changed_files_manifest.txt` matches the harness-tracked `CHANGED_FILES`
- `unit_exercise.log` contains pristine raw stdout (no "LOG CLEARED", no wrapper summaries)
- `research_notes.txt` contains verbatim source quotes (no `[placeholder]` text)
- `verif_self.txt` claims match actual file contents when re-read

If ANY skeptic finds a mismatch → round refuted. The bar is honesty + verifiability.
