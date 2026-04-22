import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LoomConfig } from '../config/load.js'
import type { ExtendedLinearClient } from '../clients/linear-api.js'
import { loadConfig, resolveConfigPath } from '../config/load.js'

const pExecFile = promisify(execFile)

export type DoctorCheckName =
  | 'config'
  | 'linear-api-key'
  | 'linear-round-trip'
  | 'gh-cli'
  | 'git-repo-root'
  | 'labels'

export type DoctorCheckResult = {
  name: DoctorCheckName
  ok: boolean
  detail: string
}

export type DoctorCmdOptions = {
  cwd?: string
  /**
   * Override the Linear client factory (e.g. tests pass a mock). Default
   * builds an ExtendedLinearClient from `LINEAR_API_KEY`.
   */
  linearFactory?: (apiKey: string) => ExtendedLinearClient
  /** Override gh-status check. Returns ok=true if authenticated. */
  ghStatus?: () => Promise<{ ok: boolean; detail: string }>
  /** Override git repo root lookup. */
  gitRepoRoot?: () => Promise<string | null>
}

export async function doctorCmd(opts: DoctorCmdOptions = {}): Promise<{
  results: DoctorCheckResult[]
  ok: boolean
}> {
  const results: DoctorCheckResult[] = []
  const cwd = opts.cwd ?? process.cwd()

  // Check 1: config
  let cfg: LoomConfig | null = null
  try {
    const configPath = resolveConfigPath(cwd)
    cfg = loadConfig(cwd)
    results.push({ name: 'config', ok: true, detail: configPath })
  } catch (err) {
    results.push({
      name: 'config',
      ok: false,
      detail: err instanceof Error ? err.message : String(err)
    })
  }

  // Check 2: LINEAR_API_KEY present
  const apiKeyEnv = cfg?.linear.apiKeyEnv ?? 'LINEAR_API_KEY'
  const apiKey = process.env[apiKeyEnv]
  if (apiKey) {
    results.push({ name: 'linear-api-key', ok: true, detail: `${apiKeyEnv} is set` })
  } else {
    results.push({
      name: 'linear-api-key',
      ok: false,
      detail: `${apiKeyEnv} not set in environment`
    })
  }

  // Check 3: Linear round-trip
  let team: { id: string; key: string } | null = null
  if (cfg && apiKey) {
    try {
      const client = opts.linearFactory
        ? opts.linearFactory(apiKey)
        : (await import('../clients/linear-api.js')).linearApiClient(apiKey)
      const teams = await client.listTeams()
      team = teams.find((t) => t.key === cfg!.linear.teamKey) ?? null
      if (!team) {
        results.push({
          name: 'linear-round-trip',
          ok: false,
          detail: `Linear API reachable but team "${cfg.linear.teamKey}" not visible (got ${teams.length} teams)`
        })
      } else {
        results.push({
          name: 'linear-round-trip',
          ok: true,
          detail: `team ${team.key} reachable`
        })
      }
    } catch (err) {
      results.push({
        name: 'linear-round-trip',
        ok: false,
        detail: err instanceof Error ? err.message : String(err)
      })
    }
  } else {
    results.push({
      name: 'linear-round-trip',
      ok: false,
      detail: 'skipped (config or API key missing)'
    })
  }

  // Check 4: gh CLI installed + authenticated
  if (opts.ghStatus) {
    const { ok, detail } = await opts.ghStatus()
    results.push({ name: 'gh-cli', ok, detail })
  } else {
    try {
      await pExecFile('gh', ['auth', 'status', '--hostname', 'github.com'])
      results.push({ name: 'gh-cli', ok: true, detail: 'authenticated' })
    } catch (err) {
      results.push({
        name: 'gh-cli',
        ok: false,
        detail: err instanceof Error ? err.message.split('\n')[0] : String(err)
      })
    }
  }

  // Check 5: git installed + repo root matches config
  if (opts.gitRepoRoot) {
    const root = await opts.gitRepoRoot()
    if (!root) {
      results.push({ name: 'git-repo-root', ok: false, detail: 'not in a git repo' })
    } else if (cfg && root !== cfg.repo.root) {
      results.push({
        name: 'git-repo-root',
        ok: false,
        detail: `git root ${root} does not match config.repo.root ${cfg.repo.root}`
      })
    } else {
      results.push({ name: 'git-repo-root', ok: true, detail: root })
    }
  } else {
    try {
      const { stdout } = await pExecFile('git', ['rev-parse', '--show-toplevel'], { cwd })
      const root = stdout.trim()
      if (cfg && root !== cfg.repo.root) {
        results.push({
          name: 'git-repo-root',
          ok: false,
          detail: `git root ${root} does not match config.repo.root ${cfg.repo.root}`
        })
      } else {
        results.push({ name: 'git-repo-root', ok: true, detail: root })
      }
    } catch (err) {
      results.push({
        name: 'git-repo-root',
        ok: false,
        detail: err instanceof Error ? err.message.split('\n')[0] : String(err)
      })
    }
  }

  // Check 6: labels (dry-run style)
  if (cfg && apiKey && team) {
    try {
      const client = opts.linearFactory
        ? opts.linearFactory(apiKey)
        : (await import('../clients/linear-api.js')).linearApiClient(apiKey)
      const existing = await client.listTeamLabels(team.id)
      const existingSet = new Set(existing.map((l) => l.name))
      const wanted = Array.from(new Set(Object.values(cfg.labels)))
      const missing = wanted.filter((n) => !existingSet.has(n))
      if (missing.length === 0) {
        results.push({ name: 'labels', ok: true, detail: `${wanted.length} labels present` })
      } else {
        results.push({
          name: 'labels',
          ok: false,
          detail: `missing ${missing.length}: ${missing.join(', ')} — run \`loom labels --ensure\``
        })
      }
    } catch (err) {
      results.push({
        name: 'labels',
        ok: false,
        detail: err instanceof Error ? err.message : String(err)
      })
    }
  } else {
    results.push({
      name: 'labels',
      ok: false,
      detail: 'skipped (prior check failed)'
    })
  }

  return { results, ok: results.every((r) => r.ok) }
}
