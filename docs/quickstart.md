# Quickstart

Takes ~3 minutes. You end with a Linear issue → PR pipeline running on your next ticket.

## Prerequisites

- Claude Code installed (`claude --version`).
- A Linear workspace and API key (Settings → API → Personal API keys).
- GitHub CLI authenticated (`gh auth status`).
- Node 20+ and a git repository.

## 1 · Install in your project

```bash
cd your-project/
npx @juliushamm/loom init
```

You'll be asked three things:

- **Linear team key** (required) — the prefix Linear uses for your team's issues. If your issues look like `ACME-42`, the team key is `ACME`.
- **Branch prefix** — the string prepended to agent-authored branches. Typically your GitHub handle.
- **Signoff email** — the email on agent-authored commits. Use your GitHub noreply address.

`init` writes:

- `.loom.json` at the repo root
- `.claude/skills/work/SKILL.md` (copied from the installed loom package)

## 2 · Set your Linear API key + ensure labels

```bash
export LINEAR_API_KEY=lin_api_...
npx @juliushamm/loom labels --ensure
```

This creates (idempotently) the seven `automation:*` labels loom needs in your Linear team:

- `automation:dispatch-ok` — you approved Scribe's dispatch prompt
- `automation:dispatch-reject` — you rejected Scribe's dispatch prompt
- `automation:dispatch-pending-review` — auto-applied while you review
- `automation:halt` — kill-switch for this issue
- `automation:halt-all` — kill-switch for every `/work` run
- `automation:in-flight` — pipeline is running (heartbeat-refreshed)
- `automation:merge-ok` — you approved auto-merge

Run `loom doctor` to confirm everything is wired up:

```bash
npx @juliushamm/loom doctor
```

Expect six ✓ checks. If any ✗, fix the specific issue before proceeding.

## 3 · Build your dev team

Loom orchestrates a **team meeting** between in-character personas before execution. You need a team.

In Claude Code, invoke the `build-team` skill:

```
In Claude Code: /build-team
```

It interviews you about your project, its north star, and each of seven personas (Lead, Architect, Frontend, Backend, Security, QA, Scribe). Answers get written to `.claude/skills/<your-team-name>/` — the path becomes your `skills.teamSkillName` in `.loom.json`.

If you don't have `build-team` installed, see the [main README](../README.md) or copy the `skills/dev-team-template/` directory from the loom repo as a starting point.

## 4 · Run `/work` on your first issue

```
In Claude Code: /work ACME-42
```

What happens:

1. **Pre-flight.** Loom checks branch state, halt labels, lock files. Routes to resume / continue / fresh.
2. **Meeting.** Your team personas convene in-character. Lead opens, relevant agents speak, Lead closes with a decision.
3. **Scribe posts the dispatch prompt** to Linear as a comment, tagged `automation:dispatch-pending-review`.
4. **You review the prompt** in Linear. Apply `automation:dispatch-ok` to proceed, `automation:dispatch-reject` to send it back for revision.
5. **Execution.** Loom dispatches a subagent with the approved prompt. The subagent opens a PR before returning.
6. **CI poll.** Loom watches for CI to go green (or red).
7. **Hand-off.** On green, loom posts `automation:awaiting-merge` and stops. You review the diff and merge the PR manually.
8. **Cleanup.** Loom releases the in-flight lock and removes the heartbeat label.

## Troubleshooting

**"Linear API key missing"** — export `LINEAR_API_KEY` or set a different env via `.loom.json` → `linear.apiKeyEnv`.

**"Team key does not match"** — your `.loom.json` `linear.teamKey` must match exactly (case-insensitive) the prefix Linear shows on your issues.

**"gh not authenticated"** — run `gh auth login`.

**`loom doctor` reports missing labels** — run `loom labels --ensure`.

**Pipeline aborted with exit 5** — you applied `automation:dispatch-reject`. Loom will revise the dispatch based on your comment and re-post. You apply `automation:dispatch-ok` when happy.

See [dispatch-gate.md](dispatch-gate.md) for the full gate semantics, [config-reference.md](config-reference.md) for every `.loom.json` field.
