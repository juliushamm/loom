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

Note: the probe reasons over git/GitHub state only. For Linear-Document deliverables it always returns `fresh` — duplicate-document avoidance is the reviewer's responsibility until the probe learns to see Linear Documents.

## 2. Triage (if no team:* labels)

Use Linear MCP `get_issue` to read the issue. Apply your team's layered triage rule (Owner field → keywords → LLM judgment) to assign the correct `team:*` labels. Apply labels via `save_issue`. Post a `🟡 automation:triage` comment summarizing your reasoning.

The meeting participant labels are: `team:lead`, plus whatever personas `.claude/skills/{{teamSkillName}}/agents/*.md` defines.

## 3. Meeting

Read labeled persona files from `.claude/skills/{{teamSkillName}}/agents/*.md`. Read any agents marked as always-present in that skill's SKILL.md (typically Lead + Scribe). Run the focused team meeting in-character.

**Lead's closing MUST name the deliverable type explicitly**, as a single line:

- `Deliverable: CODE` — a PR in the consumer repo (source files, CI config, tests).
- `Deliverable: LINEAR DOCUMENT` — a spec, plan, or design doc. Lead names the Linear project the document attaches to and whether this creates a new document or updates an existing one.

Scribe reads Lead's declaration and emits the matching dispatch template (see Scribe's persona for the two templates). Wrong template = wrong outcome — the classification is load-bearing, not decorative.

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

Invoke the `Agent` tool with `subagent_type: "general-purpose"` and `prompt: <Scribe's dispatch prompt + profile + Tier 1 hook reminder>`. Collect the result.

- **CODE path:** include the consumer repo path and target branch in the dispatch. Subagent opens a PR before returning; capture the PR number.
- **DOCUMENT path:** do **not** include a repo path. Subagent creates (or updates) a Linear Document via the Linear MCP `mcp__linear-server__create_document` / `update_document` tool and returns the Document URL. No branch, no PR, no file on disk. Subagent MUST NOT write markdown into the consumer repo's filesystem — silently sneaking design docs into source trees can violate the consumer's own policies (gitignore, OSS exposure, redaction rules).

## 6. Hand-off to human

**CODE path:** Run:

```
!loom poll-ci <PR> --issue {{issueId}}
```

On green, **stop**. Post a `🟢 automation:awaiting-merge — PR #<N> green, your turn` comment. Do NOT merge automatically — the human reviews the diff and runs:

```
gh pr merge <N> --squash --delete-branch
```

themselves.

Optional: the human can fire `loom merge-gate <PR> --issue {{issueId}}` after they're planning to merge; it polls until the PR is merged (by any means) or a halt signal arrives, then returns.

**DOCUMENT path:** skip CI poll (no CI exists for a Linear Document). Post a `🟢 automation:awaiting-review — document ready, your turn` comment that cites the Document URL and any reviewer asks from the meeting. Do **not** wait for signoff — doc reviews are async over hours/days, blocking the Claude session on a label is wasteful. The human reviews, signs off in-document, and moves issue state themselves.

## 7. Cleanup (always — fire even if halted)

Run:

```
!loom cleanup {{issueId}}
```

## Notes

- `{{issueId}}` placeholders in this skill are filled at `loom init` time based on your `.loom.json` `linear.teamKey`.
- The `{{teamSkillName}}` placeholder is filled at `loom init` time based on your `.loom.json` `skills.teamSkillName`.
- If the CLI is not on PATH, replace `loom` with `npx @juliushamm/loom` throughout.
