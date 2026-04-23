# The dispatch-review gate

The single most important safety mechanism in loom: before any subagent executes, **a human reviews the exact prompt it will receive**.

This is sometimes called "paranoid step 3" — step 3 in the pipeline (execution) is gated by explicit human sign-off.

## Why

Dispatch prompts are what actually drive the subagent. If the prompt is wrong, the PR is wrong. If the scope is too wide, the subagent goes off-piste. If verification criteria are fuzzy, the subagent ships something that looks done but isn't.

Reviewing the prompt is cheaper than reviewing the resulting 800-line PR, and lets you catch scope drift before any code is written.

## How it works

1. **Meeting ends.** The Scribe persona in your team skill outputs a dispatch prompt.
2. **Loom posts the prompt** as a Linear comment prefixed `🟡 automation:dispatch-pending-review`.
3. **Loom runs** `loom poll-dispatch <ISSUE>`. The CLI blocks, polling the issue's labels every 30 seconds.
4. **You read the prompt** in Linear. Three choices:
   - Apply **`automation:dispatch-ok`** → the CLI exits 0 with stdout `dispatch-ok`. Loom continues to execution.
   - Apply **`automation:dispatch-reject`** → the CLI exits 5 with stdout `dispatch-reject`. Loom pauses, reads your comment thread for your reason, revises the dispatch, removes the reject label, and re-posts.
   - Apply **`automation:halt`** or **`automation:halt-all`** → the CLI exits 3 with stdout `HALT <reason>`. Loom jumps to cleanup and stops.
5. **Timeout** → after 24 hours of neither label applied, the CLI exits 3. Safe default — the pipeline gives up on stale reviews.

## Reject-before-ok

If both `dispatch-ok` and `dispatch-reject` are present on the issue simultaneously (two people racing the labels, or an accidental double-click), **reject wins**. Rationale: a false positive on reject costs one revision cycle; a false positive on ok costs a wrong PR.

## What to look for when reviewing

**Good dispatch prompts have:**

- **Goal** — one-line statement of what the PR should achieve.
- **Context** — relevant findings from the meeting (not a transcript; just the load-bearing conclusions).
- **Scope** — exact files/directories that may be touched. Explicit list beats "the relevant code."
- **Verification** — commands that prove it works. `npm test`, `npm run typecheck`, `npm run lint`, plus any feature-specific manual step.
- **Out of scope** — an explicit list of things the subagent must NOT do. Often the most valuable section — catches scope creep before it starts.
- **Output format** — what the subagent returns to the orchestrator. For code deliverables: diff + PR URL. For Linear-Document deliverables: the Document URL on the named project (no filesystem writes).

**Red flags:**

- "…and anything else you notice" — invites drift.
- "Fix tests" without naming which tests or why they fail.
- No verification clause for destructive operations.
- References to files the subagent hasn't been told about.
- "Optimize performance" as a goal — unmeasurable, unbounded.

If you see any of these, apply `automation:dispatch-reject` and comment with the specific ask. Loom will revise.

## Profiles

The `.loom.json` `pipeline.profile` field controls whether this gate fires:

| Profile | Dispatch gate | Merge gate |
|---|---|---|
| `aggressive` | off | off |
| `balanced` | off | on |
| `paranoid` | on | on |
| `balanced+paranoid-step-3` (default) | on | off |

The default name is long for a reason: it's balanced everywhere except this step, which deliberately runs paranoid. We recommend keeping it.

If you find yourself wanting `aggressive`, that's a signal your dispatch prompts aren't yet trustworthy enough to auto-dispatch. Fix the prompts first (improve Scribe's template, tighten your team's meeting discipline), then consider turning the gate off.

## Revision loop

When you reject, loom will:

1. Read every comment on the issue posted since the dispatch.
2. Summarize your reason back in the revision.
3. Remove the `automation:dispatch-reject` label via the Linear API.
4. Post the revised dispatch as a new comment prefixed `🟡 automation:dispatch-pending-review (revised)`.
5. Re-run `loom poll-dispatch`.

There is no revision count limit. Loop until you approve or halt.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | `dispatch-ok` — continue |
| 3 | halt (label) or timeout |
| 5 | `dispatch-reject` — revise and re-gate |

Other subcommands use the same conventions. `poll-ci` adds `4` for red CI.

## Telemetry

Every gate outcome is recorded to `storage.logDir` with a timestamp, the issue ID, and the label that closed the gate. Useful for debugging a "why did this pipeline halt at 3am" question after the fact.
