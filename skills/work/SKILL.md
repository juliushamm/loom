---
name: work
description: Run the Linear → PR pipeline on one issue. /work ISSUE-N. Pre-flight + team meeting + scope-arm + execution via Agent subagent + diff-verify + CI poll; the human merges the PR manually.
---

You are the orchestrator for the Linear → PR pipeline. User invokes `/work ISSUE-N` where `ISSUE-N` matches `{{teamKey}}-\d+`.

**Invocation discipline:** invoke the `loom` CLI via `npx @juliushamm/loom <subcommand>` (or `loom <subcommand>` if globally installed). The CLI reads `.loom.json` from the repo root — no hard-coded paths.

**Profile split:** the default profile (`balanced+self-checking`) replaces the human dispatch-review gate with two automated safeguards — §4.5 scope-arm and §5.5 diff-verify. The legacy human gate stays available behind `pipeline.profile = paranoid` for one-off ambiguous fires. Read `pipeline.profile` from `.loom.json` and route §4 vs §4.5 accordingly.

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

## 4. Dispatch-review gate (paranoid only)

> **Skip this section unless `pipeline.profile = paranoid`.** The default profile (`balanced+self-checking`) replaces this human gate with §4.5 scope-arm + §5.5 diff-verify. Keep dispatch-review in your toolkit for genuinely ambiguous fires where you want a human to read the dispatch prompt before any subagent work fires.

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

## 4.5 Scope-arm (default profile)

After the meeting outputs the dispatch prompt — and skipping §4 unless `profile=paranoid` — the orchestrator runs:

```
!loom scope-arm {{issueId}}
```

This reads the issue's `## Scope` section (or `**Files:**` callout, or fenced ```files block) and writes a fire-scoped allowlist to `~/.loom/fires/{{issueId}}/scope.json`. The Tier 1 hooks honor that allowlist during subagent execution: in-scope writes and `bashAllow`-matching commands are pre-approved (no per-tool permission prompts), while out-of-scope writes block with `scope-exceeded:<path>`.

If the parser produces an empty paths list, halt `🔴 automation:halted — spec-parse-empty` and ask the human to add a `## Scope` section. The default profile relies on a parseable spec; without one, the diff-verify gate has nothing to verify against.

## 5. Execution (Agent tool subagent)

Invoke the `Agent` tool with `subagent_type: "general-purpose"` and `prompt: <Scribe's dispatch prompt + profile + Tier 1 hook reminder>`. Collect the result.

- **CODE path:** include the consumer repo path and target branch in the dispatch. Subagent opens a PR before returning; capture the PR number.
- **DOCUMENT path:** do **not** include a repo path. Subagent creates (or updates) a Linear Document via the Linear MCP `mcp__linear-server__create_document` / `update_document` tool and returns the Document URL. No branch, no PR, no file on disk. Subagent MUST NOT write markdown into the consumer repo's filesystem — silently sneaking design docs into source trees can violate the consumer's own policies (gitignore, OSS exposure, redaction rules).

## 5.5 Diff-verify (default profile, CODE path only)

Before opening the PR, the orchestrator runs:

```
!loom diff-verify {{issueId}}
```

The command walks `git diff --name-only main...HEAD` against `scope.json` plus the hardcoded collateral rules (README in the same workspace, barrel `index.ts` in the same dir, mirrored test files). Outcomes:

- **`{ "kind": "ok" }`, exit 0** → continue to §6.
- **`{ "kind": "scope-exceeded", "offending": [...] }`, exit 6** → halt `🔴 automation:halted — scope-exceeded:<paths>`. The feature branch persists for human triage; no auto-revert. Tell the human: either add the offending paths to the issue's `## Scope` section and re-fire, or revert them on the feature branch.
- **`{ "kind": "no-scope" }`** → scope.json missing (e.g. paranoid profile skipped §4.5). Skip the gate and continue.

DOCUMENT-path fires skip §5.5 — no diff exists to verify.

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
!loom scope-disarm {{issueId}}
```

`scope-disarm` removes `~/.loom/fires/{{issueId}}/scope.json` so the next fire starts with a fresh marker. It is a no-op if no scope was armed (e.g. paranoid profile skipped §4.5).

## Notes

- `{{issueId}}` placeholders in this skill are filled at `loom init` time based on your `.loom.json` `linear.teamKey`.
- The `{{teamSkillName}}` placeholder is filled at `loom init` time based on your `.loom.json` `skills.teamSkillName`.
- If the CLI is not on PATH, replace `loom` with `npx @juliushamm/loom` throughout.
