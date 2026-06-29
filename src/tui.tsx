// Goalpower — TUI entry (minimal status line)
// Renders a small status indicator in the OpenCode TUI showing the current
// goalpower round + status. Full sidebar visualization is on the roadmap.

import { createSignal, onCleanup, onMount } from "solid-js"

type GoalState = {
  session_id: string
  objective: string
  status: "active" | "paused" | "completed" | "unmet" | "stuck" | "cleared" | "usageLimited" | "budgetLimited"
  current_round: number
  rounds_total?: number
  prior_gaps_count?: number
  started_at: string
}

const STATUS_ICON: Record<GoalState["status"], string> = {
  active: "●",
  paused: "⏸",
  completed: "✓",
  unmet: "✗",
  stuck: "⚠",
  cleared: "○",
  usageLimited: "⏹",
  budgetLimited: "⏹",
}

const STATUS_COLOR: Record<GoalState["status"], string> = {
  active: "var(--color-accent)",
  paused: "var(--color-warn)",
  completed: "var(--color-success)",
  unmet: "var(--color-error)",
  stuck: "var(--color-error)",
  cleared: "var(--color-muted)",
  usageLimited: "var(--color-warn)",
  budgetLimited: "var(--color-warn)",
}

export function GoalpowerStatusBar() {
  const [goal, setGoal] = createSignal<GoalState | null>(null)

  async function refresh() {
    try {
      // Best-effort poll of the goalpower_status tool via the local OpenCode API.
      // The exact endpoint shape depends on the OpenCode version; this is a
      // conservative fetch that gracefully no-ops if the API isn't available.
      const res = await fetch("goalpower://status")
      if (!res.ok) return
      const data = (await res.json()) as GoalState | { status: "no_active_session" }
      setGoal("status" in data && data.status === "no_active_session" ? null : (data as GoalState))
    } catch {
      // Silent — TUI status line is best-effort only.
    }
  }

  onMount(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    onCleanup(() => clearInterval(id))
  })

  const label = () => {
    const g = goal()
    if (!g) return "Goalpower: idle"
    return `Goalpower ${STATUS_ICON[g.status]} R${g.current_round} (${g.status})`
  }

  return (
    <div
      style={{
        padding: "0 8px",
        color: goal() ? STATUS_COLOR[goal()!.status] : "var(--color-muted)",
        "font-size": "12px",
        display: "flex",
        "align-items": "center",
        gap: "8px",
      }}
    >
      <span>{label()}</span>
      {goal() && (
        <span style={{ opacity: "0.6", "max-width": "300px", overflow: "hidden", "text-overflow": "ellipsis" }}>
          {goal()!.objective.slice(0, 60)}
          {goal()!.objective.length > 60 ? "…" : ""}
        </span>
      )}
    </div>
  )
}

export default GoalpowerStatusBar
