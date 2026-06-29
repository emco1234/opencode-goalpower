<div align="center">

# ⚡ OpenCode Goalpower V2

### The autonomous goal mode plugin for OpenCode — multi-round skeptic verification

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode](https://img.shields.io/badge/OpenCode-%E2%89%A51.17.1-blueviolet)](https://opencode.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org)
[![Type: Plugin](https://img.shields.io/badge/Type-Plugin-orange)](#)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)](./CHANGELOG.md)

**Stop accepting "I'm done" on faith. Make every completion claim pass a panel of adversarial skeptics.**

> **The OpenCode goal plugin** — when you need an autonomous agent that actually finishes the job, not just claims to.

</div>

---

## 🔍 Looking for an OpenCode goal mode?

You found it. **OpenCode Goalpower V2** is the goal-execution plugin for [OpenCode](https://opencode.ai) that treats **honesty and verifiability as a system-level contract**, enforced by adversarial subagents.

If you searched for any of these, this is the right repo:

- `opencode goal` · `opencode goal mode` · `opencode /goal`
- `opencode goal plugin` · `opencode autonomous agent`
- `opencode long-running task` · `opencode ai agent verifiable`
- `opencode skeptic verification` · `opencode anti-fabrication`

---

## 🎯 What is OpenCode Goalpower?

OpenCode Goalpower V2 is an [OpenCode](https://opencode.ai) plugin that adds a **persistent, multi-round goal-execution loop** to your AI coding agent. When you give it an objective, it:

1. **Spawns an Implementer** that works toward the objective autonomously
2. **Spawns a panel of Skeptics** that audit every claim against the real files on disk
3. **Loops** — if any Skeptic finds a gap, fabrication, or unfixed prior gap, the Implementer gets another round with the gap list
4. **Stops only when the work is provably done** — all Skeptics agree, or you pause

Think of it as **compulsory code review for every "complete" claim**, baked into the agent loop.

> ### Why does this exist?
> Modern LLM agents can produce a *convincing* "I've finished the task" even when the actual work is incomplete, fabricated, or worse — claims edits that were never made. Goalpower closes that gap by treating **honesty and verifiability as a system-level contract**, enforced by adversarial subagents whose only job is to refute completion claims.

---

## ✨ Features

| Feature | What it does |
|---|---|
| 🔄 **Infinite round loop** | Runs until goal is provably achieved (no arbitrary round caps) |
| 🕵️ **Multi-Skeptic panel** | Spawn 1–3 parallel Skeptic subagents for high-stakes goals |
| 🛡️ **Anti-ratchet contract** | Prior gaps are re-audited every round; can't escape by doing new work |
| 📝 **Honesty anchor** | `changed_files_manifest.txt` is diffed against harness-tracked `CHANGED_FILES` |
| 🧠 **Compaction preservation** | Goal state survives `/compact` and `/compress` via context injection + disk source-of-truth |
| ⚡ **Auto-continue on idle** | Loop drives itself forward on session idle events |
| 🧱 **Premature-stop detection** | Same gap N rounds in a row → graceful pause for manual intervention |
| 📜 **Verdict persistence** | Every Skeptic verdict saved to disk for later audit (`verdict-{N}-{k}.json`) |
| 🎛️ **Slash command + 9 tools** | Full programmatic control from the OpenCode TUI |

---

## 📦 Installation

### Option A — Local plugin (recommended)

1. **Clone the repo into your OpenCode plugins directory:**

```bash
git clone https://github.com/emco1234/opencode-goalpower.git \
  ~/.config/opencode/plugins/goalpower
```

> **Windows (PowerShell):**
> ```powershell
> git clone https://github.com/emco1234/opencode-goalpower.git `
>   "$env:USERPROFILE\.config\opencode\plugins\goalpower"
> ```

2. **Register it in your OpenCode config** (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "./plugins/goalpower",
      {
        "skeptics": 1,
        "max_auto_turns": 0,
        "premature_stop_threshold": 5,
        "preserve_on_compact": true
      }
    ]
  ]
}
```

3. **Restart OpenCode.** Run `/goalpower` — you should see it in the slash-command picker.

### Option B — From source (development)

```bash
git clone https://github.com/emco1234/opencode-goalpower.git
cd goalpower
bun install
bun run typecheck
```

Then register the local path in `opencode.jsonc` as shown above.

---

## 🚀 Quick start

Once installed, just type `/goalpower` in the OpenCode TUI:

```
/goalpower Refactor src/auth.ts to use the new token format and update all callers
```

Goalpower takes over. You'll see heartbeats like:

```
[round 1, skeptic 0/1, elapsed 2m]
Round 1: REFUTED (3 gaps) — fabrication: patch only .grok/*; .py edits claimed
[round 2, skeptic 0/1, elapsed 5m]
Round 2: REFUTED (1 gap) — placeholder text in research_notes.txt
[round 3, skeptic 0/1, elapsed 11m]
Round 3: ACCEPTED — all acceptance criteria verified
```

### Sub-commands

| Command | Action |
|---|---|
| `/goalpower <objective>` | Start a new goal |
| `/goalpower status` | Print current state |
| `/goalpower pause` | Pause after current round |
| `/goalpower resume` | Resume from pause |
| `/goalpower clear` | Drop session state (code edits untouched) |
| `/goalpower edit <new objective>` | Replace objective, keep prior_gaps |
| `/goalpower config <key=value>` | Update config live |

---

## 🏗️ How it works

### The loop

```
┌─────────────────────────────────────────────────────────────┐
│  Round N                                                     │
│                                                              │
│  ┌──────────────────┐    spawns    ┌──────────────────┐    │
│  │   Orchestrator   │ ───────────► │   IMPLEMENTER    │    │
│  │   (you + plugin) │              │   subagent       │    │
│  └──────────────────┘              └─────────┬────────┘    │
│                                              │             │
│              writes plan.md, research_notes.txt,           │
│              unit_exercise.log, verif_self.txt,            │
│              changed_files_manifest.txt, patch.diff        │
│                                              │             │
│                                              ▼             │
│                                    ┌──────────────────┐    │
│              spawns K parallel     │   SKEPTIC #0     │    │
│              ──────────────────►   │   SKEPTIC #1     │    │
│                                    │   SKEPTIC #2     │    │
│                                    └─────────┬────────┘    │
│                                              │             │
│              each writes verdict-{N}-{k}.json              │
│              + skeptic-{N}-{k}.md                           │
│                                              │             │
│                                              ▼             │
│                                    ┌──────────────────┐    │
│                                    │   AGGREGATION    │    │
│                                    └─────────┬────────┘    │
│                                              │             │
│                          ┌───────────────────┼───────────┐ │
│                          ▼                   ▼           ▼ │
│                       ACCEPTED          REFUTED       STUCK │
│                          │                   │           │ │
│                       DONE            feed gaps back    ─► pause │
│                                      for round N+1           │
└─────────────────────────────────────────────────────────────┘
```

### The honesty anchor

Every Skeptic verifies one critical invariant before anything else:

> **Does `implementer/changed_files_manifest.txt` match the harness-tracked `CHANGED_FILES`?**

If not — `refuted: true, confidence: high`. The Implementer cannot escape this. Fabricated file claims are the #1 source of false "complete" verdicts in single-agent systems, and Goalpower makes them impossible to slip through.

### Compaction preservation

When OpenCode runs `/compact` mid-goal, the plugin's `experimental.session.compacting` hook injects a `<goalpower_compaction_preserve>` block into the post-compaction context:

```xml
<goalpower_compaction_preserve session_id="..." round="3" status="active">
  <objective>...verbatim objective...</objective>
  <current_round>3</current_round>
  <prior_gaps count="2">...</prior_gaps>
  <recent_verdicts>...</recent_verdicts>
  <state_dir>~/.config/opencode/state/goalpower/...</state_dir>
  <next_action>Continue from round 4. Address every prior_gap first.</next_action>
</goalpower_compaction_preserve>
```

State files on disk (`goal.json`, `verdict-*.json`, `skeptic-*.md`, `patch.diff`) remain the source of truth. Even if the in-context block is lost, the agent can re-read the state and resume.

---

## ⚙️ Configuration

All options are passed as the second element of the plugin-array entry in `opencode.jsonc`:

| Option | Default | Description |
|---|---|---|
| `auto_continue` | `true` | Drive the loop forward on session idle |
| `max_auto_turns` | `0` | Hard cap on auto-continuations. `0` = infinite |
| `min_continue_interval_seconds` | `3` | Minimum time between continuation prompts |
| `max_prompt_failures` | `3` | Max failures before pausing |
| `default_token_budget` | `0` | Optional per-goal token budget. `0` = none |
| `max_goal_duration_seconds` | `0` | Optional wall-clock cap. `0` = none |
| `no_progress_token_threshold` | `50` | Output token level for "no progress" detection |
| `max_no_progress_turns` | `5` | Anti-ratchet: 5 no-progress turns → pause |
| `premature_stop_threshold` | `5` | Anti-ratchet: same gap 5 rounds → pause |
| `skeptics` | `1` | Parallel Skeptics per round (bump to 2–3 for high-stakes) |
| `register_command` | `true` | Register `/goalpower` slash command |
| `command_name` | `"goalpower"` | Slash command name |
| `preserve_on_compact` | `true` | Inject goal state into compaction summary |

### Live config updates

Update config from the TUI without editing JSON:

```
/goalpower config skeptics=3 premature_stop_threshold=7
```

The new values persist to `~/.config/opencode/state/goalpower/config.json`.

---

## 🧰 Tools exposed

The plugin exposes 9 tools the agent can call directly:

| Tool | Purpose |
|---|---|
| `goalpower_start` | Start a new goal session |
| `goalpower_round_implementer` | Spawn the next Implementer round |
| `goalpower_round_skeptic` | Spawn one Skeptic (call K times for parallel) |
| `goalpower_aggregate` | Aggregate Skeptic verdicts → decision |
| `goalpower_status` | Print current session state |
| `goalpower_pause` | Pause the active session |
| `goalpower_resume` | Resume from paused/stuck |
| `goalpower_clear` | Drop session state |
| `goalpower_config` | Read/update config live |

---

## 📁 State layout

```
~/.config/opencode/state/goalpower/
├── config.json                     # live config overrides
├── active-session.json             # pointer to current session
└── <session-id>/
    ├── goal.json                   # {objective, status, rounds, prior_gaps, history, checkpoints}
    ├── implementer/
    │   ├── plan.md                 # detailed plan with acceptance criteria
    │   ├── research_notes.txt      # verbatim source quotes (no placeholders)
    │   ├── unit_exercise.log       # pristine raw stdout of test runs
    │   ├── verif_self.txt          # honest self-audit with path:line citations
    │   ├── changed_files_manifest.txt  # must match harness CHANGED_FILES
    │   └── final_response.md       # one-paragraph claim
    ├── patch.diff                  # cumulative diff across all rounds
    ├── verdict-{N}-{k}.json        # one per Skeptic per round
    ├── skeptic-{N}-{k}.md          # human-readable gap reports
    └── round-{N}-summary.md        # orchestrator's per-round decision
```

All writes are atomic (`tmp → rename`), file mode `0o600`, parent dirs `0o700`. Mutation-queue serialized.

---

## 💡 When to use Goalpower

✅ **Great fits:**
- "Refactor this module and update all callers" (multi-file, easy to claim done prematurely)
- "Make the test suite green" (clear acceptance criteria)
- "Write the migration and verify it on a copy of prod data"
- "Implement the feature from this spec — don't skip anything"

❌ **Not great fits:**
- Quick one-shot edits (overhead not worth it)
- Pure Q&A ("what does this function do?")
- Tasks with no objective acceptance criteria

---

## 🧪 Examples

See [`examples/`](./examples) for:

- [`goalpower-sessions.md`](./examples/goalpower-sessions.md) — real `/goalpower` session transcripts (quick refactor, multi-round, high-stakes, sub-commands, stuck handling, compaction)
- [`basic-objective.md`](./examples/basic-objective.md) — simple refactor goal
- [`high-stakes.md`](./examples/high-stakes.md) — multi-skeptic production rollout
- [`debugging-session.md`](./examples/debugging-session.md) — when Skeptics caught what Implementer missed

---

## 🛠️ Development

```bash
git clone https://github.com/emco1234/opencode-goalpower.git
cd goalpower
bun install
bun run typecheck   # strict TS
bun run lint        # eslint
bun test            # run test suite
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full dev guide.

---

## 🗺️ Roadmap

- [ ] TUI sidebar showing live round progress
- [ ] Cost/token estimation per round
- [ ] Skeptic personas (security-focused, perf-focused, correctness-focused)
- [ ] MCP server variant for non-OpenCode agents
- [ ] Verdict diff visualization between rounds

See [open issues](https://github.com/emco1234/opencode-goalpower/issues) for the full list. PRs welcome.

---

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md) before opening a PR.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](./LICENSE) for the full text.

---

## 🙏 Acknowledgments

- The [OpenCode](https://opencode.ai) team for the plugin API and TUI platform
- Everyone who's been frustrated by an agent claiming "I'm done" when it wasn't

---

## ⭐ Stargazers over time

[![Star History Chart](https://api.star-history.com/svg?repos=emco1234/opencode-goalpower&type=Date)](https://star-history.com/#emco1234/opencode-goalpower&Date)

<div align="center">

**If Goalpower saved you from a fabricated "done" — consider [starring ⚡](https://github.com/emco1234/opencode-goalpower/stargazers) the repo.**

</div>
