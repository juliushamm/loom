# `.loom.json` reference

Loom walks up from the current directory looking for `.loom.json`. The first match is your project config. Only `linear.teamKey` is required; everything else has a default.

## Minimal

```json
{
  "linear": { "teamKey": "ACME" }
}
```

## Full

```json
{
  "$schema": "https://raw.githubusercontent.com/juliushamm/loom/main/schema/v1.json",
  "linear": {
    "teamKey": "ACME",
    "apiKeyEnv": "LINEAR_API_KEY"
  },
  "git": {
    "authorBranchPrefix": "alice",
    "signoffEmail": "12345+alice@users.noreply.github.com",
    "mainBranch": "main"
  },
  "repo": {
    "root": ".",
    "workspaceDir": "."
  },
  "pipeline": {
    "profile": "balanced+paranoid-step-3",
    "prTitleTemplate": "${summary} (${issueKey})"
  },
  "skills": {
    "teamSkillName": "acme-team",
    "workSkillName": "work"
  },
  "tier1": {
    "blockedPaths": [
      ".github/workflows/",
      ".claude/skills/",
      "CLAUDE.md",
      "package-lock.json",
      ".env",
      ".pem",
      ".key",
      "credentials",
      "build/",
      "dist/",
      "node_modules/"
    ]
  },
  "labels": {
    "dispatchOk": "automation:dispatch-ok",
    "dispatchReject": "automation:dispatch-reject",
    "dispatchPendingReview": "automation:dispatch-pending-review",
    "halt": "automation:halt",
    "haltAll": "automation:halt-all",
    "inFlight": "automation:in-flight",
    "mergeOk": "automation:merge-ok"
  },
  "storage": {
    "logDir": "~/.loom/logs",
    "lockDir": "~/.loom/locks",
    "haltFile": ".loom-halt"
  }
}
```

## Fields

### `linear` (required)

| Field | Default | Description |
|---|---|---|
| `teamKey` | — | Linear team prefix (e.g. `ACME` for issues like `ACME-42`). Case-insensitive at runtime. |
| `apiKeyEnv` | `LINEAR_API_KEY` | Name of the env var loom reads the Linear API key from. Change to isolate multiple Linear workspaces per shell. |

### `git`

| Field | Default | Description |
|---|---|---|
| `authorBranchPrefix` | `feat` | Prepended to agent-authored branches. Loom never pushes to `main` or touches this prefix. |
| `signoffEmail` | *(git config user.email)* | The email on agent commits. Prefer your GitHub noreply address. |
| `mainBranch` | `main` | The branch loom refuses to push to directly. |

### `repo`

| Field | Default | Description |
|---|---|---|
| `root` | `.` | Repo root relative to where loom is invoked. Tilde expansion supported. |
| `workspaceDir` | `.` | Where loom stores its per-issue workspace lock. Usually matches `root`. |

### `pipeline`

| Field | Default | Description |
|---|---|---|
| `profile` | `balanced+paranoid-step-3` | Gate profile. See [dispatch-gate.md](dispatch-gate.md) for what each profile enables. |
| `prTitleTemplate` | `${summary} (${issueKey})` | Template for the PR title. Variables: `${summary}` (Linear issue title), `${issueKey}` (e.g. `ACME-42`). |

### `skills`

| Field | Default | Description |
|---|---|---|
| `teamSkillName` | `dev-team` | The directory name under `.claude/skills/` containing your team personas. |
| `workSkillName` | `work` | The directory name for the `/work` skill. Change only if you have a naming conflict. |

### `tier1.blockedPaths`

Array of patterns (glob-ish strings). Any `Edit`/`Write` tool call against a matching path is blocked by the PreToolUse hook that ships with loom. Patterns with trailing `/` match directories; otherwise suffix-match. `.github/workflows/` blocks every file in that directory; `.pem` blocks every file ending in `.pem`.

The default list covers CI configs, skills, secrets, lockfiles, and build output. Extend it to cover your project's sensitive files (e.g. `src/security/`, `terraform/prod/`).

### `labels`

All label strings are overridable. If your workspace already uses different label names, set them here and `loom labels --ensure` will create/expect those names instead. Defaults follow the `automation:*` convention.

### `storage`

| Field | Default | Description |
|---|---|---|
| `logDir` | `~/.loom/logs` | Per-issue audit logs. |
| `lockDir` | `~/.loom/locks` | Per-issue lock files (for lease / heartbeat coordination). |
| `haltFile` | `.loom-halt` | Filename checked in `workspaceDir`. Touch the file to kill a running pipeline. |

Tilde expansion (`~/...`) is applied at load time.

## Precedence

1. `.loom.json` at the nearest ancestor directory (walkup from CWD).
2. Built-in defaults.

There is no `$HOME/.loom.json` merge — loom is deliberately per-project. If you want shared config across projects, symlink `.loom.json`.

## Validation

- `linear.teamKey` must be `^[A-Z][A-Z0-9]+$` (uppercase, 2+ chars). `loom init` upcases your input automatically.
- `pipeline.profile` must be one of: `aggressive`, `balanced`, `paranoid`, `balanced+paranoid-step-3`.
- Other fields are type-checked but not value-checked (loom is lenient here; invalid values surface at call time).

Run `loom doctor` to validate against a live Linear workspace.
