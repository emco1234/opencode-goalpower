# Example: When Skeptics caught what the Implementer missed

Real examples of fabrication patterns the Skeptic panel is designed to catch.

## Pattern 1: Phantom file edits

**Implementer claim:** "Edited src/auth.ts and src/auth.test.ts"

**Skeptic finding:**
```json
{
  "kind": "bug",
  "location": "implementer/changed_files_manifest.txt vs CHANGED_FILES",
  "detail": "Implementer claims src/auth.test.ts edited but CHANGED_FILES only contains src/auth.ts. Manifest is fabricated."
}
```

**Why it matters:** Without Skeptics, the orchestrator would trust the claim and skip the test edits.

---

## Pattern 2: Placeholder research

**Implementer claim:** "Researched the API and documented findings in research_notes.txt"

**Skeptic finding:**
```json
{
  "kind": "gap",
  "location": "implementer/research_notes.txt:15-22",
  "detail": "Contains [verbatim from tool ...] placeholder text instead of actual quotes. Either paste the real quote or write 'not retrieved'."
}
```

**Why it matters:** Placeholder text is the most common form of "research theater" — the agent looks like it did research but actually didn't.

---

## Pattern 3: Curated logs

**Implementer claim:** "All tests pass — see unit_exercise.log"

**Skeptic finding:**
```json
{
  "kind": "gap",
  "location": "implementer/unit_exercise.log:1-18",
  "detail": "Only 18 lines; claims 4 clean python -c blocks but log shows 'BLOCK1 partial' + powershell syntax errors; missing POINTS/MEAN_VEL/VALIDATOR observables from real runs. Looks curated, not pristine."
}
```

**Why it matters:** If the agent only shows the green-block lines, it's hiding failures. Pristine raw stdout is the honesty anchor for "did the test actually run?"

---

## Pattern 4: Stale plan

**Implementer claim:** "Plan executed successfully"

**Skeptic finding:**
```json
{
  "kind": "gap",
  "location": "implementer/plan.md",
  "detail": "Plan is unchanged from round 1; still lists 'TODO: figure out acceptance criteria'. Implementer did not update the plan this round."
}
```

**Why it matters:** A stale plan means the Implementer can't be held accountable — the Skeptic can't tell what was supposed to happen vs. what did.

---

## Pattern 5: Skipped prior gap (anti-ratchet trigger)

**Round N Implementer claim:** "All gaps addressed"

**Round N Skeptic finding:**
```json
{
  "kind": "gap",
  "location": "PRIOR_GAPS / item 2",
  "detail": "Gap from round N-2 unfixed: unit_exercise.log still has 'LOG CLEARED' on line 5. Implementer did new work but didn't address prior gap. Anti-ratchet violation."
}
```

**Why it matters:** Without re-auditing prior gaps, the Implementer can claim forward progress while leaving old failures in place. After `premature_stop_threshold` rounds, the loop pauses for manual review.
