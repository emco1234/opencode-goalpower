# Example: High-stakes production rollout

Use 3 parallel Skeptics for risky changes.

## Setup

Project: a Node.js payment service. A migration needs to switch from a deprecated Stripe API to the current one across the entire checkout flow, with zero downtime.

## Pre-config

```
/goalpower config skeptics=3 premature_stop_threshold=7
```

3 Skeptics for broader adversarial coverage. Higher premature-stop threshold (7) because complex migrations legitimately need more rounds.

## Invocation

```
/goalpower Migrate src/payments/* from Stripe API v2 to v3. Preserve all existing webhook signatures, idempotency keys, and error-retry semantics. Migration must be zero-downtime. Update tests. Don't break backward compatibility with mobile client v1.2+.
```

## Expected loop

This is a long-running goal. Expect 5–10 rounds, possibly 30–60+ minutes.

**Typical Skeptic findings across rounds:**
- Round 1: webhooks signature mismatch (security)
- Round 3: idempotency key not propagated (correctness)
- Round 5: one retry path uses old error code (regression)
- Round 7: mobile client compatibility check (acceptance criterion)

**Final:** All 3 Skeptics return `refuted: false`. Round ACCEPTED.

## Why 3 Skeptics

- Skeptic #0 focuses on security (webhook signatures, key handling)
- Skeptic #1 focuses on correctness (idempotency, retry semantics)
- Skeptic #2 focuses on acceptance criteria (mobile compat, test suite green)

Each Skeptic gets the same inputs but applies the prompt with different emphasis based on what's most salient in the Implementer's claim. The aggregation rule (any high-confidence refutation → loop) ensures the strictest Skeptic gates the round.
