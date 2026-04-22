---
name: work
description: Run the Linear → PR pipeline on one issue. /work ISSUE-N. Pre-flight + team meeting + dispatch-review gate + execution via Agent subagent + CI poll; the human merges the PR manually.
---

You are the orchestrator for the Linear → PR pipeline. User invokes `/work ISSUE-N` where `ISSUE-N` matches `{{teamKey}}-\d+`.

**Invocation discipline:** invoke the `loom` CLI via `npx @juliushamm/loom <subcommand>` (or `loom <subcommand>` if globally installed). The CLI reads `.loom.json` from the repo root — no hard-coded paths.

## 1. Pre-flight

Run: `!loom preflight {{issueId}}`

Parse the JSON. Route on `state`:

- `fresh` → continue
- `resume-branch` → `git checkout <branchName>` then continue
- `continue-pr` → `git checkout <PR head branch>` then continue
- `merge-ready` → skip to §6 (human merges)
- `abort-*` → tell user + exit

## 2. Triage (if no team:* labels)

Use Linear MCP `get_issue` to read the issue. Apply your team's layered triage rule (Owner field → keywords → LLM judgment) to assign the correct `team:*` labels. Apply labels via `save_issue`. Post a `🟡 automation:triage` comment summarizing your reasoning.

The meeting participant labels are: `team:lead`, plus whatever personas `.claude/skills/{{teamSkillName}}/agents/*.md` defines.

## 3. Meeting

Read labeled persona files from `.claude/skills/{{teamSkillName}}/agents/*.md`. Read any agents marked as always-present in that skill's SKILL.md (typically Lead + Scribe). Run the focused team meeting in-character. Close with an executor choice. The Scribe persona emits the dispatch prompt at meeting end.

## 4. Dispatch-review gate (paranoid step 3)

Post Scribe's prompt as a Linear comment prefixed `🟡 automation:dispatch-pending-review`. Run:

```
!loom poll-dispatch {{issueId}}
```

Blocks until one of:

- **`automation:dispatch-ok`** applied → stdout `dispatch-ok`, exit 0 → continue to §5.
- **`automation:dispatch-reject`** applied → stdout `dispatch-reject`, exit 5 → **do NOT execute**. Read the human's comment thread for the reason, revise the dispatch, **remove the reject label** (MCP `save_issue`), post the revised dispatch as a new comment prefixed `🟡 automation:dispatch-pending-review (revised)`, and re-run `loom poll-dispatch`. Loop until ok, halt, or timeout.
- **`automation:halt`** or **`automation:halt-all`** applied → exit 3 → jump to §7 cleanup.
- **Timeout** → exit 3 → jump to §7 cleanup.

Reject evaluation happens before ok — if both labels present simultaneously, reject wins.

## 5. Execution (Agent tool subagent)

Invoke the `Agent` tool with `subagent_type: "general-purpose"` and `prompt: <Scribe's dispatch prompt + repo path + profile + Tier 1 hook reminder>`. The subagent should open a PR before returning.

Collect the PR number from the subagent's result.

## 6. CI poll + hand-off to human

Run:

```
!loom poll-ci <PR> --issue {{issueId}}
```

On green, **stop**. Post a `🟢 automation:awaiting-merge — PR #<N> green, your turn` comment. Do NOT merge automatically — the human reviews the diff and runs:

```
gh pr merge <N> --squash --delete-branch
```

themselves.

Optional: the human can fire `loom merge-gate <PR> --issue {{issueId}}` after they're planning to merge; it polls until the PR is merged (by any means) or a halt signal arrives, then returns.

## 7. Cleanup (always — fire even if halted)

Run:

```
!loom cleanup {{issueId}}
```

## Notes

- `{{issueId}}` placeholders in this skill are filled at `loom init` time based on your `.loom.json` `linear.teamKey`.
- The `{{teamSkillName}}` placeholder is filled at `loom init` time based on your `.loom.json` `skills.teamSkillName`.
- If the CLI is not on PATH, replace `loom` with `npx @juliushamm/loom` throughout.
