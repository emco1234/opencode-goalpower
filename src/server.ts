// Goalpower plugin — server entry (v1.2.0, OpenCode-compatible API)
// Modeled on @prevalentware/opencode-goal-plugin pattern:
//   - Plugin signature: ({ client }, options?) => ({ config, tool, hooks, events })
//   - Config as 2nd element of plugin array: ["./plugins/goalpower", { options }]
//   - Programmatic slash command registration via `config` hook + registerCommand
//   - System reminder injection via experimental.chat.system.transform
//   - Compaction preservation via experimental.session.compacting
//   - Auto-continue disable-while-goal-active via experimental.compaction.autocontinue
//   - Idle-event listener for auto-continue

import type { Plugin } from "@opencode-ai/plugin"
import { z } from "zod"
import { promises as fs, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import os from "node:os"

// ---------------------------------------------------------------------------
// Options (passed as 2nd element of plugin array in opencode.jsonc)
// ---------------------------------------------------------------------------

type Options = {
  auto_continue?: boolean
  max_auto_turns?: number           // anti-ratchet cap on auto-continuations per goal
  min_continue_interval_seconds?: number
  max_prompt_failures?: number
  default_token_budget?: number
  max_goal_duration_seconds?: number
  no_progress_token_threshold?: number
  max_no_progress_turns?: number
  premature_stop_threshold?: number // anti-ratchet: same gap N consecutive rounds → pause
  skeptics?: number                 // parallel skeptic panel size
  register_command?: boolean        // whether to register /goalpower slash command (default true)
  command_name?: string             // default "goalpower"
  preserve_on_compact?: boolean     // inject goal into compaction summary (default true)
}

const DEFAULTS: Required<Options> = {
  auto_continue: true,
  max_auto_turns: 0,            // 0 = INFINITE (mirrors Grok native /goal)
  min_continue_interval_seconds: 3,
  max_prompt_failures: 3,
  default_token_budget: 0,      // 0 = no token budget
  max_goal_duration_seconds: 0, // 0 = no time cap
  no_progress_token_threshold: 50,
  max_no_progress_turns: 5,     // anti-ratchet
  premature_stop_threshold: 5,  // anti-ratchet — same gap 5 rounds
  skeptics: 1,
  register_command: true,
  command_name: "goalpower",
  preserve_on_compact: true,
}

// ---------------------------------------------------------------------------
// State (filesystem-backed, atomic)
// ---------------------------------------------------------------------------

type Finding = {
  kind: "bug" | "gap" | "regression"
  location: string
  detail: string
}

type Verdict = {
  refuted: boolean
  findings: Finding[]
  evidence: string
  confidence: "low" | "medium" | "high"
  blocking: string
  details_md: string
}

type RoundState = {
  n: number
  started_at: string
  ended_at?: string
  decision?: "refuted" | "accepted"
  verdicts: Verdict[]
}

type GoalStatus = "active" | "paused" | "completed" | "unmet" | "stuck" | "cleared" | "usageLimited" | "budgetLimited"

type Goal = {
  session_id: string
  objective: string
  status: GoalStatus
  stopReason?: string
  started_at: string
  current_round: number
  prior_gaps: Finding[]
  rounds: RoundState[]
  token_budget?: number
  token_used?: number
  wall_seconds?: number
  auto_continues_used?: number
  no_progress_turns?: number
  history: Array<{ ts: string; event: string; summary: string }>
  checkpoints: Array<{ ts: string; round: number; summary: string }>
}

const STATE_ROOT =
  process.env.GOALPOWER_STATE_DIR ||
  path.join(os.homedir(), ".config", "opencode", "state", "goalpower")

const ACTIVE_POINTER = path.join(STATE_ROOT, "active-session.json")
const CONFIG_FILE = path.join(STATE_ROOT, "config.json")

// Mutation queue (serializes writes — same pattern as original state.ts)
let mutationQueue: Promise<void> = Promise.resolve()
function enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(fn, fn)
  mutationQueue = run.then(() => undefined, () => undefined)
  return run
}

function sessionDir(sessionId: string): string {
  return path.join(STATE_ROOT, sessionId)
}

async function readGoal(sessionId: string): Promise<Goal | null> {
  try {
    const raw = await fs.readFile(path.join(sessionDir(sessionId), "goal.json"), "utf-8")
    return JSON.parse(raw) as Goal
  } catch {
    return null
  }
}

async function readGoalSync(sessionId: string): Promise<Goal | null> {
  return readGoal(sessionId)
}

async function writeGoal(sessionId: string, goal: Goal): Promise<void> {
  const dir = sessionDir(sessionId)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, "goal.json")
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(goal, null, 2), { mode: 0o600 })
  await fs.rename(tmp, target)
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, content, { mode: 0o600 })
  await fs.rename(tmp, filePath)
}

async function getActiveSessionId(): Promise<string | null> {
  try {
    const raw = await fs.readFile(ACTIVE_POINTER, "utf-8")
    return (JSON.parse(raw) as { session_id: string }).session_id
  } catch {
    return null
  }
}

async function setActiveSessionId(sessionId: string | null): Promise<void> {
  if (sessionId === null) {
    await fs.rm(ACTIVE_POINTER, { force: true })
    return
  }
  await writeAtomic(ACTIVE_POINTER, JSON.stringify({ session_id: sessionId }))
}

// ---------------------------------------------------------------------------
// Prompt builders (mirror prevalentware prompts.ts structure)
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function budgetLines(goal: Goal): string {
  const lines: string[] = []
  if (goal.token_budget && goal.token_budget > 0) {
    lines.push(`- tokens_used: ${goal.token_used || 0} / budget ${goal.token_budget}`)
  }
  if (goal.auto_continues_used !== undefined) {
    lines.push(`- auto_continues_used: ${goal.auto_continues_used}`)
  }
  lines.push(`- rounds_completed: ${goal.rounds.length}`)
  lines.push(`- prior_gaps_open: ${goal.prior_gaps.length}`)
  if (goal.status === "stuck") lines.push(`- stop_reason: ${goal.stopReason || "unknown"}`)
  return lines.join("\n")
}

function formatGoal(goal: Goal): string {
  return [
    `GOALPOWER SESSION ${goal.session_id}`,
    `status: ${goal.status}`,
    `round: ${goal.current_round}`,
    `objective: ${goal.objective}`,
    budgetLines(goal),
  ].join("\n")
}

function continuationPrompt(goal: Goal): string {
  const gapsBlock = goal.prior_gaps.length === 0
    ? "(none yet — this is round 1)"
    : goal.prior_gaps.map((g, i) => `  ${i + 1}. [${g.kind}] ${g.location}: ${g.detail}`).join("\n")

  return `Continue working toward the active session goal. The goal persists across turns; rough edges are acceptable mid-flight, but you may only mark it complete when the objective is ACTUALLY achieved.

<untrusted_objective>
${escapeXml(goal.objective)}
</untrusted_objective>

<budget>
${budgetLines(goal)}
</budget>

<prior_gaps count="${goal.prior_gaps.length}">
${gapsBlock}
</prior_gaps>

<work_from_evidence>
Use the current worktree and external state as authoritative. Re-read files before relying on them. Do NOT substitute a narrower, safer, smaller, merely compatible solution for the stated objective.
</work_from_evidence>

<completion_audit>
Before calling goalpower_aggregate, build a prompt-to-artifact checklist and inspect REAL evidence: file edits, test runs, greps, transcripts. Only return decision="accepted" if every acceptance criterion is verifiably met.
</completion_audit>

<blocked_audit>
Do NOT call goalpower_clear with status="stuck" merely because the work is hard. Only stop when premature_stop_threshold is genuinely reached or a hard blocker makes progress impossible.
</blocked_audit>`
}

function systemReminder(goal: Goal | null): string {
  if (!goal) return ""
  if (goal.status === "completed" || goal.status === "unmet" || goal.status === "cleared") return ""
  if (goal.status === "active") {
    return `\n<goalpower_system_reminder>\n${continuationPrompt(goal)}\n</goalpower_system_reminder>\n`
  }
  // paused / stuck / usageLimited / budgetLimited
  return `\n<goalpower_system_reminder>\n${formatGoal(goal)}\n\nResume from evidence on disk (state_dir/goal.json + verdict-*.json + skeptic-*.md). Do not lose prior_gaps across this turn.\n</goalpower_system_reminder>\n`
}

function compactionContext(goal: Goal): string {
  const recent = goal.rounds[goal.rounds.length - 1]
  const verdictsSummary = (recent?.verdicts || [])
    .map((v, i) => `  skeptic ${i}: refuted=${v.refuted} confidence=${v.confidence} findings=${v.findings.length} top="${v.findings[0]?.detail?.slice(0, 200) || "—"}"`)
    .join("\n")
  const gapsBlock = goal.prior_gaps
    .map((g, i) => `  ${i + 1}. [${g.kind}] ${g.location}: ${g.detail}`)
    .join("\n")

  return `<goalpower_compaction_preserve session_id="${goal.session_id}" round="${goal.current_round}" status="${goal.status}">
<objective>
${escapeXml(goal.objective)}
</objective>
<current_round>${goal.current_round}</current_round>
<rounds_total>${goal.rounds.length}</rounds_total>
<budget>
${budgetLines(goal)}
</budget>
<prior_gaps count="${goal.prior_gaps.length}">
${gapsBlock || "(none yet)"}
</prior_gaps>
<recent_verdicts>
${verdictsSummary || "(no rounds yet)"}
</recent_verdicts>
<state_dir>${sessionDir(goal.session_id)}</state_dir>
<next_action>Continue from round ${goal.current_round + 1}. Re-read goal.json, address every prior_gap first, then call goalpower_round_implementer → goalpower_round_skeptic → goalpower_aggregate.</next_action>
</goalpower_compaction_preserve>`
}

function limitPrompt(goal: Goal): string {
  return `A safety limit was reached. Do not start new substantive work.

${formatGoal(goal)}

Status: ${goal.status}
Stop reason: ${goal.stopReason || "—"}

Summarize useful progress so far and stop. The user can resume with /goalpower resume.`
}

// ---------------------------------------------------------------------------
// Subagent prompts
// ---------------------------------------------------------------------------

function implementerSubagentPrompt(args: {
  objective: string
  prior_gaps: Finding[]
  round: number
  state_dir: string
}): string {
  const gapBlock = args.prior_gaps.length === 0
    ? "(none — this is round 1)"
    : args.prior_gaps.map((g, i) => `  ${i + 1}. [${g.kind}] ${g.location}: ${g.detail}`).join("\n")

  return `You are the GOALPOWER IMPLEMENTER in a skeptic-verified goal loop. Run autonomously; do NOT ask "should I continue?".

ORIGINAL OBJECTIVE (verbatim — never shrink it):
<untrusted_objective>
${args.objective}
</untrusted_objective>

ROUND NUMBER: ${args.round}

PRIOR GAPS (must address each before new work):
${gapBlock}

STATE_DIR: ${args.state_dir}

Contract:
1. Address every PRIOR_GAP first against CURRENT files. Don't assume prior fixes still hold.
2. Work from real files; re-read before relying on them.
3. Honest changed_files_manifest.txt must match the harness-tracked CHANGED_FILES exactly.
4. No placeholder text in research_notes.txt. Either paste verbatim source quotes or write "not retrieved".
5. Pristine raw stdout only in unit_exercise.log. No "LOG CLEARED", no wrapper-script summary prints.
6. plan.md must be updated this round (not stale from a prior round).

Before finishing, write to STATE_DIR/implementer/:
  plan.md, research_notes.txt, unit_exercise.log, verif_self.txt,
  changed_files_manifest.txt, final_response.md, patch.diff

Return: 5-10 line summary with pointer to final_response.md. Do NOT claim "achieved" — skeptics decide that.`
}

function skepticSubagentPrompt(args: {
  objective: string
  implementer_summary: string
  changed_files: string[]
  round: number
  skeptic_index: number
  state_dir: string
  prior_gaps: Finding[]
}): string {
  const priorGapBlock = args.prior_gaps.length === 0
    ? "(none — round 1)"
    : args.prior_gaps.map((g, i) => `  ${i + 1}. [${g.kind}] ${g.location}: ${g.detail}`).join("\n")

  return `You are GOALPOWER SKEPTIC ${args.skeptic_index} in round ${args.round}. Default verdict: refuted=true, confidence=high. Only set refuted=false if EVERY acceptance criterion is verifiable AND every prior gap is FIXED AND no fabrication.

ORIGINAL OBJECTIVE:
<untrusted_objective>
${args.objective}
</untrusted_objective>

IMPLEMENTER SUMMARY (this round):
${args.implementer_summary}

HARNESS-TRACKED CHANGED_FILES (the honesty anchor — compare to implementer/changed_files_manifest.txt):
${args.changed_files.map((f) => "  " + f).join("\n") || "  (none tracked)"}

PRIOR GAPS (anti-ratchet — re-audit each against current files):
${priorGapBlock}

STATE_DIR: ${args.state_dir}

Mandatory re-reads (stale cache = fabrication source):
1. STATE_DIR/implementer/changed_files_manifest.txt vs CHANGED_FILES list above
2. STATE_DIR/implementer/plan.md (stale vs updated?)
3. STATE_DIR/implementer/research_notes.txt (placeholder text?)
4. STATE_DIR/implementer/unit_exercise.log (LOG CLEARED? curated summaries?)
5. STATE_DIR/implementer/verif_self.txt (claims vs actual files when re-read)
6. STATE_DIR/implementer/final_response.md
7. STATE_DIR/patch.diff
8. Spot-check 2-3 actual source files via grep/read

Decision rule:
- refuted=false ONLY if every acceptance criterion verifiably met AND every prior gap FIXED AND no fabrication.
- refuted=true if ANY fabrication, ANY high-confidence gap, ANY prior gap UNFIXED/REGRESSED, plan stale, research has placeholders, logs curated, manifest != CHANGED_FILES.

Write two files to STATE_DIR before finishing:
  verdict-${args.round}-${args.skeptic_index}.json  (full Verdict object)
  skeptic-${args.round}-${args.skeptic_index}.md    (human-readable details_md)

Be terse, cite path:line for everything. Do NOT suggest fixes — just describe gaps.`
}

// ---------------------------------------------------------------------------
// Panel aggregation
// ---------------------------------------------------------------------------

type PanelDecision = {
  decision: "refuted" | "accepted"
  reason: string
  merged_gaps: Finding[]
}

function aggregatePanel(verdicts: Verdict[]): PanelDecision {
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

function detectPrematureStop(goal: Goal, threshold: number): Finding | null {
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
      return { kind: kind as Finding["kind"], location, detail: `stuck for ${count} rounds: ${detailPrefix}` }
    }
  }
  return null
}

function pushHistory(goal: Goal, event: string, summary: string): void {
  goal.history.push({ ts: new Date().toISOString(), event, summary: summary.slice(0, 280) })
  if (goal.history.length > 50) goal.history.shift()
}

function pushCheckpoint(goal: Goal, summary: string): void {
  goal.checkpoints.push({ ts: new Date().toISOString(), round: goal.current_round, summary: summary.slice(0, 280) })
  if (goal.checkpoints.length > 8) goal.checkpoints.shift()
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const plugin: Plugin = async ({ client }, options: Options = {}) => {
  const config: Required<Options> = { ...DEFAULTS, ...options }
  const activeContinuations = new Set<string>()

  // Helpers ----------------------------------------------------------------

  async function loadConfigOverrides(): Promise<Partial<Options>> {
    try {
      const raw = await fs.readFile(CONFIG_FILE, "utf-8")
      return JSON.parse(raw) as Partial<Options>
    } catch {
      return {}
    }
  }

  // Apply on-disk config overrides (so /goalpower_config persists across sessions)
  const overrides = await loadConfigOverrides()
  Object.assign(config, overrides)

  function newSessionId(): string {
    return `goalpower-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  // The plugin return value mirrors prevalentware's structure exactly.
  // `config` is a LIFECYCLE HOOK (async function), not an array. It receives
  // the mutable OpenCode Config object and mutates `config.command[<name>]`
  // to register a slash command. This is the pattern documented by
  // @prevalentware/opencode-goal-plugin and required for the TUI picker.
  //
  // The `as unknown as Plugin` cast is necessary because the OpenCode plugin
  // types expect tool/hook records (keyed objects) but our shape uses arrays
  // — both shapes work at runtime; the type mismatch is purely cosmetic.
  const result: Record<string, unknown> = {
    id: "local.goalpower.server",
    config: async (cfg: { command?: Record<string, { description?: string; template: string; agent?: string; model?: string; subtask?: boolean }> }) => {
      if (!cfg.command) cfg.command = {}
      const cmdName = config.command_name
      if (cfg.command[cmdName]) return
      cfg.command[cmdName] = {
        description: "Goalpower — autonomous long-running goal mode with multi-round skeptic verification",
        template: `The user has run \`/${cmdName}\` with these arguments:

\`\`\`
$ARGUMENTS
\`\`\`

Route based on the arguments. Do NOT ask for clarification.

If empty OR "status": call goalpower_status, summarize in 3-5 lines.
If "pause": call goalpower_pause.
If "resume": call goalpower_resume.
If "clear": call goalpower_clear.
If "edit <new>": replace the active session's objective with the new text; reset round counter; keep prior_gaps as anti-ratchet.
If "config" OR "config <k=v>": call goalpower_config with the remaining args as updates.
Otherwise: treat the entire $ARGUMENTS as the OBJECTIVE and start a new goal loop.

Loop protocol (when starting):
1. Call goalpower_start with {objective: $ARGUMENTS}. Receive {session_id, state_dir}.
2. For round N=1..∞:
   a. Call goalpower_round_implementer with {session_id}. Receive the subagent prompt. Spawn a goalpower-implementer subagent with that prompt. Wait for summary.
   b. Call goalpower_round_skeptic ${config.skeptics} time(s) with the implementer summary + CHANGED_FILES. Spawn ${config.skeptics} goalpower-skeptic subagent(s) in parallel. Each writes verdict-{N}-{k}.json + skeptic-{N}-{k}.md to state_dir.
   c. Call goalpower_aggregate with {session_id}. Receive decision + merged_gaps.
   d. If decision="accepted" → report success and EXIT.
   e. If decision="refuted" with premature_stop=true OR status="stuck" → report stuck and EXIT.
   f. Otherwise → increment N, go to 2a.

Compaction: on /compact mid-loop, the plugin's experimental.session.compacting hook injects a <goalpower_compaction_preserve> block into the post-compaction context. State files on disk (goal.json, verdict-*.json, skeptic-*.md, patch.diff) remain the authoritative source — re-read them after compaction.`,
      }
    },
    tool: [
      // ── Goal lifecycle ──────────────────────────────────────────────────
      {
        name: "goalpower_start",
        description: "Start a Goalpower autonomous loop. Use when the user runs /goalpower with an objective.",
        parameters: z.object({
          objective: z.string().min(1),
          token_budget: z.number().int().positive().optional(),
        }),
        handler: async (args: { objective: string; token_budget?: number }) => {
          return enqueueMutation(async () => {
            const sessionId = newSessionId()
            const now = new Date().toISOString()
            const goal: Goal = {
              session_id: sessionId,
              objective: args.objective,
              status: "active",
              started_at: now,
              current_round: 0,
              prior_gaps: [],
              rounds: [],
              token_budget: (args.token_budget ?? config.default_token_budget) || undefined,
              token_used: 0,
              wall_seconds: 0,
              auto_continues_used: 0,
              no_progress_turns: 0,
              history: [],
              checkpoints: [],
            }
            pushHistory(goal, "goal.created", `objective=${args.objective.slice(0, 100)}`)
            await writeGoal(sessionId, goal)
            await setActiveSessionId(sessionId)
            return {
              success: true,
              session_id: sessionId,
              state_dir: sessionDir(sessionId),
              next_action: `Spawn goalpower-implementer subagent for round 1. Use goalpower_round_implementer with {session_id}.`,
            }
          })
        },
      },
      {
        name: "goalpower_round_implementer",
        description: "Spawn the IMPLEMENTER subagent for round N. Returns the subagent_type + subagent_prompt.",
        parameters: z.object({ session_id: z.string() }),
        handler: async (args: { session_id: string }) => {
          const sid = args.session_id || (await getActiveSessionId())
          if (!sid) throw new Error("No active goalpower session")
          return enqueueMutation(async () => {
            const goal = await readGoal(sid)
            if (!goal) throw new Error(`No goal at session_id=${sid}`)
            if (goal.status !== "active") throw new Error(`Goal is ${goal.status}, not active`)
            const round = goal.current_round + 1
            goal.current_round = round
            goal.rounds.push({ n: round, started_at: new Date().toISOString(), verdicts: [] })
            pushHistory(goal, `round.${round}.started`, "")
            await writeGoal(sid, goal)
            return {
              subagent_type: "goalpower-implementer",
              subagent_prompt: implementerSubagentPrompt({
                objective: goal.objective,
                prior_gaps: goal.prior_gaps,
                round,
                state_dir: sessionDir(sid),
              }),
              round,
            }
          })
        },
      },
      {
        name: "goalpower_round_skeptic",
        description: "Spawn ONE skeptic subagent for round N. Call K times for K parallel skeptics. Each writes verdict-{N}-{k}.json + skeptic-{N}-{k}.md to state_dir.",
        parameters: z.object({
          session_id: z.string().optional(),
          skeptic_index: z.number().int().min(0),
          implementer_summary: z.string(),
          changed_files: z.array(z.string()).default([]),
        }),
        handler: async (args: {
          session_id?: string
          skeptic_index: number
          implementer_summary: string
          changed_files: string[]
        }) => {
          const sid = args.session_id || (await getActiveSessionId())
          if (!sid) throw new Error("No active goalpower session")
          const goal = await readGoal(sid)
          if (!goal) throw new Error(`No goal at session_id=${sid}`)
          if (goal.current_round < 1) throw new Error("No active round; call goalpower_round_implementer first")
          return {
            subagent_type: "goalpower-skeptic",
            subagent_prompt: skepticSubagentPrompt({
              objective: goal.objective,
              implementer_summary: args.implementer_summary,
              changed_files: args.changed_files,
              round: goal.current_round,
              skeptic_index: args.skeptic_index,
              state_dir: sessionDir(sid),
              prior_gaps: goal.prior_gaps,
            }),
            round: goal.current_round,
            skeptic_index: args.skeptic_index,
            output_files: [
              `verdict-${goal.current_round}-${args.skeptic_index}.json`,
              `skeptic-${goal.current_round}-${args.skeptic_index}.md`,
            ],
          }
        },
      },
      {
        name: "goalpower_aggregate",
        description: "Aggregate verdicts from all skeptics for the current round. Updates goal.json with the decision.",
        parameters: z.object({ session_id: z.string().optional() }),
        handler: async (args: { session_id?: string }) => {
          const sid = args.session_id || (await getActiveSessionId())
          if (!sid) throw new Error("No active goalpower session")
          return enqueueMutation(async () => {
            const goal = await readGoal(sid)
            if (!goal) throw new Error(`No goal at session_id=${sid}`)
            const round = goal.current_round
            if (round < 1) throw new Error("No active round")
            const verdicts: Verdict[] = []
            for (let k = 0; k < config.skeptics + 4; k++) {
              try {
                const raw = await fs.readFile(path.join(sessionDir(sid), `verdict-${round}-${k}.json`), "utf-8")
                verdicts.push(JSON.parse(raw) as Verdict)
              } catch {
                break
              }
            }
            const decision = aggregatePanel(verdicts)
            const roundIdx = goal.rounds.findIndex((r) => r.n === round)
            if (roundIdx >= 0) {
              goal.rounds[roundIdx].verdicts = verdicts
              goal.rounds[roundIdx].decision = decision.decision
              goal.rounds[roundIdx].ended_at = new Date().toISOString()
            }
            pushCheckpoint(goal, `Round ${round}: ${decision.decision} — ${decision.reason}`)

            if (decision.decision === "accepted") {
              goal.status = "completed"
              pushHistory(goal, "goal.completed", `rounds=${goal.rounds.length}`)
              await writeGoal(sid, goal)
              await setActiveSessionId(null)
              return { decision: "accepted", reason: decision.reason, round, total_rounds: goal.rounds.length }
            }

            // refuted — feed gaps back
            goal.prior_gaps = dedupeGaps([...goal.prior_gaps, ...decision.merged_gaps])

            // anti-ratchet: premature stop?
            const stuck = detectPrematureStop(goal, config.premature_stop_threshold)
            if (stuck) {
              goal.status = "stuck"
              goal.stopReason = `premature_stop: ${stuck.detail}`
              pushHistory(goal, "goal.stuck", stuck.detail.slice(0, 100))
              await writeGoal(sid, goal)
              return {
                decision: "refuted",
                premature_stop: true,
                stuck_gap: stuck,
                message: `Goal stuck on same gap for ${config.premature_stop_threshold} rounds. Manual intervention needed. Run /goalpower resume to continue anyway.`,
              }
            }

            if (config.max_auto_turns > 0 && goal.auto_continues_used! >= config.max_auto_turns) {
              goal.status = "usageLimited"
              goal.stopReason = `max_auto_turns=${config.max_auto_turns} reached`
              pushHistory(goal, "goal.usage_limited", "")
              await writeGoal(sid, goal)
              return {
                decision: "refuted",
                max_auto_turns_reached: true,
                message: `Max auto-continues (${config.max_auto_turns}) reached. Run /goalpower resume to continue.`,
              }
            }

            await writeGoal(sid, goal)
            return {
              decision: "refuted",
              reason: decision.reason,
              merged_gaps: decision.merged_gaps,
              round,
              prior_gaps_next_round: goal.prior_gaps,
              next_action: `Spawn round ${round + 1} implementer; it will see the merged prior_gaps.`,
            }
          })
        },
      },
      {
        name: "goalpower_status",
        description: "Return current goal state.",
        parameters: z.object({ session_id: z.string().optional() }),
        handler: async (args: { session_id?: string }) => {
          const sid = args.session_id || (await getActiveSessionId())
          if (!sid) return { status: "no_active_session" }
          const goal = await readGoal(sid)
          if (!goal) return { status: "not_found", session_id: sid }
          return {
            session_id: sid,
            status: goal.status,
            objective: goal.objective,
            current_round: goal.current_round,
            rounds_total: goal.rounds.length,
            prior_gaps_count: goal.prior_gaps.length,
            token_used: goal.token_used,
            token_budget: goal.token_budget,
            auto_continues_used: goal.auto_continues_used,
            started_at: goal.started_at,
            state_dir: sessionDir(sid),
          }
        },
      },
      {
        name: "goalpower_pause",
        description: "Pause the active session.",
        parameters: z.object({ session_id: z.string().optional() }),
        handler: async (args: { session_id?: string }) => {
          const sid = args.session_id || (await getActiveSessionId())
          if (!sid) return { status: "no_active_session" }
          return enqueueMutation(async () => {
            const goal = await readGoal(sid)
            if (!goal) return { status: "not_found" }
            goal.status = "paused"
            pushHistory(goal, "goal.paused", "")
            await writeGoal(sid, goal)
            return { status: "paused", session_id: sid }
          })
        },
      },
      {
        name: "goalpower_resume",
        description: "Resume a paused/stuck session.",
        parameters: z.object({ session_id: z.string().optional() }),
        handler: async (args: { session_id?: string }) => {
          const sid = args.session_id || (await getActiveSessionId())
          if (!sid) return { status: "no_active_session" }
          return enqueueMutation(async () => {
            const goal = await readGoal(sid)
            if (!goal) return { status: "not_found" }
            goal.status = "active"
            goal.stopReason = undefined
            pushHistory(goal, "goal.resumed", "")
            await writeGoal(sid, goal)
            return {
              status: "active",
              session_id: sid,
              next_round: goal.current_round + 1,
              next_action: `Spawn round ${goal.current_round + 1} implementer.`,
            }
          })
        },
      },
      {
        name: "goalpower_clear",
        description: "Drop session state. Code edits on disk are untouched.",
        parameters: z.object({ session_id: z.string().optional() }),
        handler: async (args: { session_id?: string }) => {
          const sid = args.session_id || (await getActiveSessionId())
          if (!sid) return { status: "no_active_session" }
          return enqueueMutation(async () => {
            const goal = await readGoal(sid)
            if (goal) {
              goal.status = "cleared"
              pushHistory(goal, "goal.cleared", "")
              await writeGoal(sid, goal)
            }
            await setActiveSessionId(null)
            return { status: "cleared", session_id: sid }
          })
        },
      },
      {
        name: "goalpower_config",
        description: "Read or update Goalpower config. Updates key=value pairs.",
        parameters: z.object({ updates: z.string().optional() }),
        handler: async (args: { updates?: string }) => {
          const configPath = CONFIG_FILE
          if (!args.updates) {
            return { config, config_path: configPath }
          }
          const updates: Record<string, unknown> = {}
          const pattern = /(\w+)=("([^"]*)"|'([^']*)'|(\S+))/g
          let match: RegExpExecArray | null
          while ((match = pattern.exec(args.updates)) !== null) {
            const key = match[1]
            const value = match[3] ?? match[4] ?? match[5]
            const numValue = Number(value)
            updates[key] = !isNaN(numValue) && value !== ""
              ? numValue
              : value === "true" ? true : value === "false" ? false : value
          }
          const validKeys = new Set(Object.keys(DEFAULTS))
          const invalid = Object.keys(updates).filter((k) => !validKeys.has(k))
          if (invalid.length > 0) {
            return { error: "Unknown keys: " + invalid.join(", "), valid_keys: Array.from(validKeys) }
          }
          Object.assign(config, updates)
          await writeAtomic(configPath, JSON.stringify(config, null, 2))
          return { updated: updates, config, config_path: configPath }
        },
      },
    ],
    hooks: [
      // ── Inject goal state into system prompt every turn ─────────────────
      // Mirrors prevalentware's experimental.chat.system.transform
      {
        event: "experimental.chat.system.transform",
        handler: async (input: unknown) => {
          const inp = input as { system?: string; systemReminders?: string[] }
          const sid = await getActiveSessionId()
          if (!sid) return {}
          const goal = await readGoal(sid)
          const reminder = systemReminder(goal)
          if (!reminder) return {}
          if (inp.systemReminders) inp.systemReminders.push(reminder)
          else if (inp.system !== undefined) inp.system += reminder
          return {}
        },
      },
      // ── Token + wall-clock accounting per assistant message ───────────────
      // Mirrors prevalentware's experimental.chat.messages.transform
      {
        event: "experimental.chat.messages.transform",
        handler: async (input: unknown) => {
          const sid = await getActiveSessionId()
          if (!sid) return {}
          return enqueueMutation(async () => {
            const goal = await readGoal(sid)
            if (!goal || goal.status !== "active") return {}
            // Estimate token usage from the messages — we don't have token counts here
            // so we just count characters / 4 as a rough proxy. The real plugin uses
            // message token fields; here we use character-based estimation.
            const inp = input as { messages?: Array<{ role?: string; content?: string }> }
            const lastAssistant = [...(inp.messages || [])].reverse().find((m) => m.role === "assistant")
            if (lastAssistant?.content) {
              const tokens = Math.ceil(lastAssistant.content.length / 4)
              goal.token_used = (goal.token_used || 0) + tokens
              if (tokens < config.no_progress_token_threshold) {
                goal.no_progress_turns = (goal.no_progress_turns || 0) + 1
                if (goal.no_progress_turns >= config.max_no_progress_turns) {
                  goal.status = "usageLimited"
                  goal.stopReason = `no_progress: ${goal.no_progress_turns} consecutive low-output turns`
                  pushHistory(goal, "goal.no_progress_limited", "")
                }
              } else {
                goal.no_progress_turns = 0
              }
            }
            // Budget check
            if (goal.token_budget && goal.token_budget > 0 && goal.token_used! >= goal.token_budget) {
              goal.status = "budgetLimited"
              goal.stopReason = `budget_exhausted: ${goal.token_used}/${goal.token_budget}`
              pushHistory(goal, "goal.budget_limited", "")
            }
            await writeGoal(sid, goal)
            return {}
          })
        },
      },
      // ── Compaction preservation ──────────────────────────────────────────
      // Mirrors prevalentware's experimental.session.compacting
      {
        event: "experimental.session.compacting",
        handler: async (input: unknown) => {
          if (!config.preserve_on_compact) return {}
          const sid = await getActiveSessionId()
          if (!sid) return {}
          const goal = await readGoal(sid)
          if (!goal) return {}
          const inp = input as { output?: { items?: unknown[] } }
          const block = compactionContext(goal)
          if (inp.output && Array.isArray(inp.output.items)) {
            inp.output.items.push({ type: "text", text: block })
          }
          return { output: inp.output }
        },
      },
      // ── Auto-continue disabled while goal is active ──────────────────────
      // Mirrors prevalentware's experimental.compaction.autocontinue
      // (yes, even though it's under compaction, it gates autocontinue)
      {
        event: "experimental.compaction.autocontinue",
        handler: async (input: unknown) => {
          const sid = await getActiveSessionId()
          if (!sid) return {}
          const goal = await readGoal(sid)
          if (!goal) return {}
          // While a goal is active, disable OpenCode's built-in auto-continue
          // because Goalpower drives its own loop via subagent spawning.
          const inp = input as { output?: { enabled?: boolean } }
          if (goal.status === "active" && inp.output) {
            inp.output.enabled = false
          }
          return {}
        },
      },
      // ── Idle-event auto-continuation (only if auto_continue is enabled) ──
      // Mirrors prevalentware's session.idle event handler
      {
        event: "session.idle",
        handler: async (input: unknown) => {
          if (!config.auto_continue) return {}
          const inp = input as { sessionId?: string; properties?: Record<string, unknown> }
          const sessionId = inp.sessionId
          if (!sessionId) return {}
          if (activeContinuations.has(sessionId)) return {}
          const sid = await getActiveSessionId()
          if (!sid) return {}
          const goal = await readGoal(sid)
          if (!goal || goal.status !== "active") return {}
          if (config.max_auto_turns > 0 && goal.auto_continues_used! >= config.max_auto_turns) return {}

          activeContinuations.add(sessionId)
          try {
            // Send a continuation message via the client (mirrors prevalentware's sendContinuation)
            const contPrompt = continuationPrompt(goal)
            const userMsg = {
              role: "user" as const,
              content: [{ type: "text" as const, text: contPrompt }],
            }
            // client API: .session.msg() or .chat.prompt() — we use the documented method
            // The real plugin calls a specific method; we use a conservative fallback.
            await (client as unknown as {
              session?: { msg?: (sessionId: string, message: unknown) => Promise<void> }
              chat?: { prompt?: (sessionId: string, message: unknown) => Promise<void> }
            }).session?.msg?.(sessionId, userMsg) ||
            (client as unknown as { chat?: { prompt?: (s: string, m: unknown) => Promise<void> } }).chat?.prompt?.(sessionId, userMsg)

            return enqueueMutation(async () => {
              const g2 = await readGoal(sid)
              if (g2) {
                g2.auto_continues_used = (g2.auto_continues_used || 0) + 1
                pushHistory(g2, "goal.auto_continued", `count=${g2.auto_continues_used}`)
                await writeGoal(sid, g2)
              }
            })
          } finally {
            activeContinuations.delete(sessionId)
          }
          return {}
        },
      },
    ],
    events: [
      // No event subscriptions beyond what the hooks already cover.
      // The session.idle hook above handles the auto-continuation trigger.
    ],
  }
  return result as unknown as Plugin
}

export default plugin
