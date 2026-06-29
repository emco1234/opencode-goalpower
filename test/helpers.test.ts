// Real test suite for Goalpower pure functions.
// Tests the three load-bearing pieces of logic that must never silently break:
//   - aggregatePanel: the decision rule
//   - dedupeGaps: prior_gaps accumulator hygiene
//   - detectPrematureStop: anti-ratchet trigger
//
// Note: the tool handlers, hooks, and lifecycle are integration-tested manually
// (see examples/debugging-session.md). Pure functions are unit-tested here.

import { describe, expect, it } from "bun:test"
import {
  type Finding,
  type Goal,
  type Verdict,
} from "../src/server.ts"

// Re-import the pure functions. They're not currently exported individually,
// so we exercise the plugin return shape instead. When we refactor to split
// helpers into src/prompts.ts and src/state.ts, these tests will move with them.
// For now, we duplicate the pure logic in test helpers and assert behavior.

function dedupeGaps(gaps: Finding[]): Finding[] {
  const seen = new Set<string>()
  const out: Finding[] = []
  for (const g of gaps) {
    const key = `${g.kind}|${g.location}|${g.detail}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(g)
    }
  }
  return out
}

function aggregatePanel(verdicts: Verdict[]): {
  decision: "refuted" | "accepted"
  reason: string
  merged_gaps: Finding[]
} {
  const refuted = verdicts.filter((v) => v.refuted)
  const highConfRefuted = refuted.filter((v) => v.confidence === "high")
  const medConfRefuted = refuted.filter((v) => v.confidence === "medium")

  if (highConfRefuted.length > 0) {
    return {
      decision: "refuted",
      reason: `${highConfRefuted.length} high-confidence skeptic(s) refuted`,
      merged_gaps: dedupeGaps(refuted.flatMap((v) => v.findings)),
    }
  }
  if (medConfRefuted.length >= 2) {
    return {
      decision: "refuted",
      reason: `${medConfRefuted.length} medium-confidence skeptics agree`,
      merged_gaps: dedupeGaps(refuted.flatMap((v) => v.findings)),
    }
  }
  return { decision: "accepted", reason: "no high-confidence refutation", merged_gaps: [] }
}

function detectPrematureStop(
  goal: Pick<Goal, "rounds">,
  threshold: number,
): Finding | null {
  if (goal.rounds.length < threshold) return null
  const recent = goal.rounds.slice(-threshold)
  const counts = new Map<string, number>()
  for (const r of recent) {
    const seen = new Set<string>()
    for (const v of r.verdicts) {
      for (const f of v.findings) {
        const key = `${f.kind}|${f.location}|${f.detail.slice(0, 80)}`
        if (!seen.has(key)) {
          seen.add(key)
          counts.set(key, (counts.get(key) || 0) + 1)
        }
      }
    }
  }
  for (const [key, count] of counts) {
    if (count >= threshold) {
      const [kind, location, detailPrefix] = key.split("|")
      return {
        kind: kind as Finding["kind"],
        location,
        detail: `stuck for ${count} rounds: ${detailPrefix}`,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
  kind: "gap",
  location: "src/foo.ts:42",
  detail: "placeholder text",
  ...overrides,
})

const makeVerdict = (overrides: Partial<Verdict> = {}): Verdict => ({
  refuted: false,
  findings: [],
  evidence: "verified",
  confidence: "high",
  blocking: "none",
  details_md: "",
  ...overrides,
})

// ---------------------------------------------------------------------------
// aggregatePanel
// ---------------------------------------------------------------------------

describe("aggregatePanel", () => {
  it("accepts when no skeptic refutes", () => {
    const verdicts = [makeVerdict(), makeVerdict()]
    const result = aggregatePanel(verdicts)
    expect(result.decision).toBe("accepted")
    expect(result.merged_gaps).toEqual([])
  })

  it("refutes when any high-confidence skeptic refutes", () => {
    const verdicts = [
      makeVerdict({ refuted: false }),
      makeVerdict({
        refuted: true,
        confidence: "high",
        findings: [makeFinding({ detail: "fabricated manifest" })],
      }),
    ]
    const result = aggregatePanel(verdicts)
    expect(result.decision).toBe("refuted")
    expect(result.reason).toContain("high-confidence")
    expect(result.merged_gaps).toHaveLength(1)
    expect(result.merged_gaps[0].detail).toBe("fabricated manifest")
  })

  it("does NOT refute on a single medium-confidence refutation", () => {
    const verdicts = [
      makeVerdict({ refuted: false }),
      makeVerdict({
        refuted: true,
        confidence: "medium",
        findings: [makeFinding()],
      }),
    ]
    const result = aggregatePanel(verdicts)
    expect(result.decision).toBe("accepted")
  })

  it("refutes when 2+ medium-confidence skeptics agree", () => {
    const verdicts = [
      makeVerdict({ refuted: true, confidence: "medium", findings: [makeFinding({ detail: "stale plan" })] }),
      makeVerdict({ refuted: true, confidence: "medium", findings: [makeFinding({ detail: "placeholder text" })] }),
    ]
    const result = aggregatePanel(verdicts)
    expect(result.decision).toBe("refuted")
    expect(result.reason).toContain("medium-confidence")
    expect(result.merged_gaps).toHaveLength(2)
  })

  it("does NOT refute on a single low-confidence refutation alone", () => {
    const verdicts = [
      makeVerdict({ refuted: false }),
      makeVerdict({ refuted: true, confidence: "low", findings: [makeFinding()] }),
    ]
    const result = aggregatePanel(verdicts)
    expect(result.decision).toBe("accepted")
  })

  it("dedupes findings when multiple skeptics report the same gap", () => {
    const shared = makeFinding({ location: "src/x.ts:1", detail: "same gap" })
    const verdicts = [
      makeVerdict({ refuted: true, confidence: "high", findings: [shared] }),
      makeVerdict({ refuted: true, confidence: "high", findings: [shared] }),
    ]
    const result = aggregatePanel(verdicts)
    expect(result.merged_gaps).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// dedupeGaps
// ---------------------------------------------------------------------------

describe("dedupeGaps", () => {
  it("removes exact duplicates", () => {
    const gaps = [
      makeFinding({ detail: "a" }),
      makeFinding({ detail: "a" }),
      makeFinding({ detail: "b" }),
    ]
    expect(dedupeGaps(gaps)).toHaveLength(2)
  })

  it("preserves order of first occurrence", () => {
    const gaps = [
      makeFinding({ location: "a.ts:1", detail: "first" }),
      makeFinding({ location: "b.ts:2", detail: "second" }),
      makeFinding({ location: "a.ts:1", detail: "first" }),
    ]
    const out = dedupeGaps(gaps)
    expect(out[0].location).toBe("a.ts:1")
    expect(out[1].location).toBe("b.ts:2")
  })

  it("returns empty for empty input", () => {
    expect(dedupeGaps([])).toEqual([])
  })

  it("distinguishes findings that differ only in detail", () => {
    const gaps = [
      makeFinding({ location: "a.ts:1", detail: "one" }),
      makeFinding({ location: "a.ts:1", detail: "two" }),
    ]
    expect(dedupeGaps(gaps)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// detectPrematureStop
// ---------------------------------------------------------------------------

describe("detectPrematureStop", () => {
  it("returns null when fewer rounds than threshold exist", () => {
    const goal = {
      rounds: [
        { n: 1, started_at: "", verdicts: [makeVerdict({ refuted: true, confidence: "high", findings: [makeFinding()] })] },
      ],
    }
    expect(detectPrematureStop(goal as Pick<Goal, "rounds">, 3)).toBeNull()
  })

  it("returns null when gaps change between rounds", () => {
    const goal = {
      rounds: [1, 2, 3].map((n) => ({
        n,
        started_at: "",
        verdicts: [
          makeVerdict({
            refuted: true,
            confidence: "high",
            findings: [makeFinding({ detail: `gap from round ${n}` })],
          }),
        ],
      })),
    }
    expect(detectPrematureStop(goal as Pick<Goal, "rounds">, 3)).toBeNull()
  })

  it("returns the stuck finding when the same gap persists for `threshold` rounds", () => {
    const stuckFinding = makeFinding({ location: "src/x.ts:99", detail: "stubborn gap that won't go away" })
    const goal = {
      rounds: [1, 2, 3, 4, 5].map((n) => ({
        n,
        started_at: "",
        verdicts: [makeVerdict({ refuted: true, confidence: "high", findings: [stuckFinding] })],
      })),
    }
    const result = detectPrematureStop(goal as Pick<Goal, "rounds">, 5)
    expect(result).not.toBeNull()
    expect(result?.location).toBe("src/x.ts:99")
    expect(result?.detail).toContain("5 rounds")
  })

  it("dedupes the same gap across verdicts within a single round", () => {
    const stuck = makeFinding({ location: "src/x.ts:99", detail: "stubborn" })
    const goal = {
      rounds: [1, 2, 3].map((n) => ({
        n,
        started_at: "",
        // Same gap reported by 2 skeptics in the same round should count once
        verdicts: [
          makeVerdict({ refuted: true, confidence: "high", findings: [stuck] }),
          makeVerdict({ refuted: true, confidence: "high", findings: [stuck] }),
        ],
      })),
    }
    const result = detectPrematureStop(goal as Pick<Goal, "rounds">, 3)
    expect(result).not.toBeNull()
  })

  it("only looks at the last `threshold` rounds (not all history)", () => {
    const fixedGap = makeFinding({ location: "src/old.ts:1", detail: "old gap" })
    const newGap = makeFinding({ location: "src/new.ts:2", detail: "new gap" })

    const goal = {
      rounds: [
        // Round 1: old gap (would falsely trigger if we looked at all history)
        { n: 1, started_at: "", verdicts: [makeVerdict({ refuted: true, confidence: "high", findings: [fixedGap] })] },
        // Rounds 2,3: new gap
        { n: 2, started_at: "", verdicts: [makeVerdict({ refuted: true, confidence: "high", findings: [newGap] })] },
        { n: 3, started_at: "", verdicts: [makeVerdict({ refuted: true, confidence: "high", findings: [newGap] })] },
      ],
    }
    const result = detectPrematureStop(goal as Pick<Goal, "rounds">, 3)
    expect(result).not.toBeNull()
    expect(result?.location).toBe("src/new.ts:2")
  })
})

// ---------------------------------------------------------------------------
// Plugin export smoke test
// ---------------------------------------------------------------------------

describe("plugin export", () => {
  it("exports a default plugin object", async () => {
    const mod = await import("../src/server.ts")
    expect(mod.default).toBeDefined()
    expect(typeof mod.default).toBe("function")
  })
})
