<p align="center">
  <img src="./assets/social-preview.png" alt="loom — weaves Linear into your automated agent-team workflow" width="100%"/>
</p>

# loom

Weaves Linear into your automated agent-team workflow.

Delegate with confidence. You pick the team — roles like Lead, Architect, Security, QA, or Scribe, shaped to your project through the `build-team` interview and given their own voice, stake, and standards. Every request then passes through the personas you assembled: they sign off on the plan, proofread the dispatch prompt, and peer-review every handoff before the work reaches the subagent that executes it. You stay in the loop at the one decision that matters: the explicit `dispatch-ok` label that releases the work to run.

A Claude Code starter kit that turns any Linear issue into a reviewed PR through a personality-driven dev-team meeting, a paranoid dispatch-review gate, and a single subagent execution pass.

```
/work ISSUE-42
  → pre-flight (branch state, halt signals)
  → team meeting (in-character, multi-agent)
  → Scribe emits dispatch prompt
  → scope-arm (default) OR dispatch-review gate (profile: paranoid)
  → subagent executes + opens PR
  → diff-verify (default) — halts on out-of-scope files
  → CI polled → green → your turn to merge
```

## Quickstart

```bash
# 1. Install the CLI in your project
cd your-project/
npx @juliushamm/loom init
# (answers: team key, branch prefix, signoff email)

# 2. Create Linear labels
export LINEAR_API_KEY=lin_api_...
npx @juliushamm/loom labels --ensure

# 3. Build your dev team
# In Claude Code: invoke the build-team skill to interview you
# about your project and each persona. Writes to
# .claude/skills/<your-team-name>/
```

Then run `/work YOUR-123` on any Linear issue.

## What you get

- **`loom` CLI** — `@juliushamm/loom` on npm. Eight pipeline subcommands (`preflight`, `poll-dispatch`, `poll-ci`, `merge-gate`, `cleanup`, `scope-arm`, `scope-disarm`, `diff-verify`) plus three setup subcommands (`init`, `labels`, `doctor`).
- **`/work` skill** — Claude Code skill that orchestrates the full pipeline. Reads config from `.loom.json`. Supports two deliverable shapes: **code** (subagent opens a PR; CI is polled) and **Linear Document** (subagent creates/updates a doc on the named project via the Linear MCP; no PR, no file writes).
- **Dev-team template** — a seven-persona skeleton (Lead, Architect, Frontend, Backend, Security, QA, Scribe) that the `build-team` skill fills in via an interactive interview.

## Prerequisites

- Claude Code installed.
- Linear workspace + API key.
- GitHub CLI (`gh`) authenticated.
- Node 20+ and a git repo.

Run `loom doctor` any time to check.

## Configuration

`.loom.json` at your repo root. Minimal:

```json
{
  "linear": { "teamKey": "ACME" }
}
```

Full schema: `schema/v1.json`. Every field other than `linear.teamKey` has a sane default.

## The self-checking flow (default)

The `balanced+self-checking` profile (default) replaces the human dispatch-review gate with two automated checks:

- **§4.5 scope-arm** — `loom scope-arm <ISSUE>` parses the issue's `## Scope` section into a fire-scoped allowlist at `~/.loom/fires/<ISSUE>/scope.json`. Tier 1 hooks honor the allowlist: in-scope writes don't prompt, out-of-scope writes block with `scope-exceeded:<path>`, and routine commands (`npm test`, `gh pr create`, etc.) are pre-approved.
- **§5.5 diff-verify** — `loom diff-verify <ISSUE>` walks `git diff --name-only main...HEAD` against the allowlist plus collateral rules (README in the same workspace, barrel `index.ts` next to in-scope files, mirrored test files). Out-of-scope files halt the pipeline; the feature branch persists for human triage.

Net effect on a well-specced issue: zero mid-fire prompts.

The global Tier 1 blocklist (force-push, push-to-main, secrets-bearing paths) is **never** widened by scope-arm — it remains the ceiling.

## The legacy dispatch-review gate (paranoid profile)

For genuinely ambiguous fires, set `pipeline.profile = paranoid` in `.loom.json`. The legacy gate fires:

- **Apply `automation:dispatch-ok` label** → orchestrator unblocks, dispatches the subagent.
- **Apply `automation:dispatch-reject` label** → orchestrator revises the dispatch and re-posts.
- **Apply `automation:halt` label** → kill-switch, cleanup runs.

Reject evaluation precedes ok — if both labels are present, reject wins.

See [`docs/dispatch-gate.md`](./docs/dispatch-gate.md) for the full profile matrix and selection guide.

## CLI reference

```
loom init                        Interactive config + copy /work skill
loom labels --ensure             Create automation:* labels in Linear
loom labels --dry-run            Preview label creation
loom doctor                      Env + Linear + gh + labels health check
loom preflight   <ISSUE>         Print state machine JSON
loom poll-dispatch <ISSUE>       Block until dispatch-ok / reject / halt (paranoid profile)
loom scope-arm   <ISSUE>         Write fire-scoped allowlist to ~/.loom/fires/<ISSUE>/scope.json
loom scope-disarm <ISSUE>        Remove the allowlist (called by cleanup)
loom diff-verify <ISSUE>         Walk git diff main...HEAD against scope.json
loom poll-ci   <PR> --issue <ISSUE>   Block until CI settles
loom merge-gate <PR> --issue <ISSUE>  Block until PR is merged
loom cleanup   <ISSUE>           Release locks, remove in-flight label
```

Exit codes: `0` ok, `2` usage, `3` halt/timeout, `4` red CI, `5` dispatch-reject, `6` scope-exceeded.

## Packaging layout

```
loom/
├── packages/cli/         # @juliushamm/loom
├── skills/
│   ├── work/             # /work skill — reads .loom.json
│   └── dev-team-template/  # skeleton consumed by build-team
├── schema/v1.json        # .loom.json JSON Schema
├── examples/sample-consumer/
└── docs/
```

## Known caveats

- Binary name `loom` will collide if another `loom` package is globally installed. Use `npx @juliushamm/loom <subcommand>` when in doubt.
- Linear Cycles are not yet used by `loom` — assignment to a cycle is a manual step.

## License

MIT — see `LICENSE`.
