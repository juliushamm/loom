# The dispatch-review gate (and its self-checking replacement)

Loom ships two safety models for the moment between meeting and execution. Pick the one that matches how much you trust your dispatch prompts.

| Profile | What guards execution? | Inline human prompts |
|---|---|---|
| `balanced+self-checking` (**default**) | §4.5 scope-arm + §5.5 diff-verify | none |
| `paranoid` | §4 dispatch-review label gate | one — apply `dispatch-ok` |
| `balanced+paranoid-step-3` | §4 dispatch-review label gate | one — apply `dispatch-ok` |
| `balanced` | none | none |
| `aggressive` | none | none |

Set the profile via `.loom.json`:

```json
{
  "linear": { "teamKey": "YOUR" },
  "pipeline": { "profile": "balanced+self-checking" }
}
```

## `balanced+self-checking` — the default

Two automated checks replace the human gate.

### §4.5 scope-arm

After the meeting outputs a dispatch prompt, loom runs:

```
loom scope-arm <ISSUE>
```

This:

1. Fetches the Linear issue's description.
2. Extracts a path list from the `## Scope` section, a `**Files:**` callout, or a fenced ```files block (most-specific wins).
3. Writes `~/.loom/fires/<ISSUE>/scope.json` with the paths plus a `bashAllow` list of routine commands (typecheck, test, build, gh pr create, etc.).

The Tier 1 hooks read this marker. While it's armed:

- **In-scope writes** are pre-approved — no per-file permission prompt.
- **Out-of-scope writes** block with `scope-exceeded:<path>`.
- **`bashAllow`-matching commands** are pre-approved — no per-command prompt.
- **The global Tier 1 blocklist still wins** — even an in-scope path can't override a globally-blocked one (e.g. `CLAUDE.md`, `.env`, force-push).

### §5.5 diff-verify

Before the PR opens, loom runs:

```
loom diff-verify <ISSUE>
```

This walks `git diff --name-only main...HEAD` against `scope.json` plus a small set of hardcoded collateral rules (README in the same workspace, barrel `index.ts` next to in-scope files, mirrored test files for in-scope sources). Any file that doesn't match → halt with `scope-exceeded`. The feature branch persists for human triage; loom never auto-reverts.

### Why this works

Most dispatch-review approvals were rubber-stamps — the human reads a well-specced prompt, sees it matches the scope, types ok. Replacing that with a parser + diff-verifier removes the mid-fire prompt while keeping the safety: the verifier catches scope drift either as it happens (hook block) or before the PR opens (diff-verify).

The cost when it goes wrong: one wasted subagent fire if the dispatch is misinterpreted in a way the parser doesn't catch. Acceptable for solo-dev / small-team cadence; the branch is preserved so you can salvage anything useful.

## `paranoid` — the legacy gate

Use this for fires where the spec is genuinely ambiguous and you want a human to read the dispatch prompt before any subagent work runs.

1. **Meeting ends.** Scribe outputs a dispatch prompt.
2. **Loom posts the prompt** as a Linear comment prefixed `🟡 automation:dispatch-pending-review`.
3. **Loom runs** `loom poll-dispatch <ISSUE>`. The CLI blocks, polling labels every 30 seconds.
4. **You read the prompt** in Linear. Three choices:
   - Apply **`automation:dispatch-ok`** → CLI exits 0; loom continues.
   - Apply **`automation:dispatch-reject`** → CLI exits 5; loom revises and re-posts.
   - Apply **`automation:halt`** → CLI exits 3; loom cleans up.
5. **Timeout** — 24 hours of neither label applied → CLI exits 3.

When both `dispatch-ok` and `dispatch-reject` are present simultaneously, **reject wins**.

## What to look for when reviewing a dispatch (paranoid only)

**Good dispatch prompts have:**

- **Goal** — one-line statement of what the PR should achieve.
- **Context** — the load-bearing conclusions from the meeting (not a transcript).
- **Scope** — exact files/directories that may be touched.
- **Verification** — commands that prove it works.
- **Out of scope** — explicit list of things the subagent must NOT do.
- **Output format** — what the subagent returns to the orchestrator.

**Red flags:** "and anything else you notice", "fix tests" without naming which ones, "optimize performance" as a goal, references to files the subagent hasn't been told about.

## Revision loop (paranoid only)

When you reject, loom will:

1. Read every comment posted since the dispatch.
2. Summarize your reason back in the revision.
3. Remove the `automation:dispatch-reject` label.
4. Re-post the revised dispatch as `🟡 automation:dispatch-pending-review (revised)`.
5. Re-run `loom poll-dispatch`.

There is no revision count limit. Loop until you approve or halt.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | `dispatch-ok` (paranoid) or scope-allowed (default) — continue |
| 3 | halt (label) or timeout |
| 5 | `dispatch-reject` — revise and re-gate |
| 6 | `scope-exceeded` from `diff-verify` — halt with offending paths |

## Telemetry

Every gate outcome is recorded to `storage.logDir` with timestamp + issue ID. Useful for "why did this halt at 3am" forensics after the fact.

## Picking a profile

- **You write tight `## Scope` sections** → `balanced+self-checking`. You'll get zero mid-fire prompts on a well-specced issue.
- **Your specs are still evolving and you want a human in the loop** → `paranoid`. One inline approval per fire is small overhead for a tight feedback loop.
- **You want the safety net for the merge step but trust dispatch** → `balanced`. No dispatch gate, merge gate stays.
- **You want both** → `balanced+paranoid-step-3` or `balanced+self-checking`. The two are mutually exclusive — pick one.
