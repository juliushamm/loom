#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  resolveProfile,
  defaultLogPath,
  loadConfig,
  resolveConfigPath,
  type LoomConfig
} from '../src/index.js'
import {
  preflight,
  pollDispatch,
  pollCi,
  mergeGate,
  cleanup,
  initCmd,
  labelsCmd,
  doctorCmd
} from '../src/commands/index.js'
import { ghCliClient, gitCliClient, linearApiClient } from '../src/clients/index.js'

const pExecFile = promisify(execFile)

type ExitCode = 0 | 1 | 2 | 3 | 4 | 5

const USAGE = `usage:
  loom init [--force]
  loom labels [--ensure] [--dry-run]
  loom doctor
  loom preflight <ISSUE> [--profile=<name>]
  loom poll-dispatch <ISSUE>
  loom poll-ci <PR> --issue <ISSUE>
  loom merge-gate <PR> --issue <ISSUE>
  loom cleanup <ISSUE>

Exit codes: 0 ok · 2 usage · 3 halt/timeout · 4 red-ci · 5 dispatch-reject`

async function main(): Promise<ExitCode> {
  const [sub, ...rest] = process.argv.slice(2)
  if (!sub || sub === '-h' || sub === '--help') {
    console.log(USAGE)
    return sub ? 0 : 2
  }

  switch (sub) {
    case 'init':
      return runInit(rest)
    case 'labels':
      return runLabels(rest)
    case 'doctor':
      return runDoctor()
    case 'preflight':
      return runPreflight(rest)
    case 'poll-dispatch':
      return runPollDispatch(rest)
    case 'poll-ci':
      return runPollCi(rest)
    case 'merge-gate':
      return runMergeGate(rest)
    case 'cleanup':
      return runCleanup(rest)
    default:
      console.error(`loom: unknown subcommand "${sub}"\n\n${USAGE}`)
      return 2
  }
}

async function runInit(args: string[]): Promise<ExitCode> {
  const force = args.includes('--force')
  const result = await initCmd({ cwd: process.cwd(), force })
  console.log(`Wrote ${result.configPath}`)
  if (result.skillCopiedTo) console.log(`Installed work skill at ${result.skillCopiedTo}`)
  for (const s of result.skipped ?? []) console.log(`Skipped: ${s}`)
  return 0
}

async function runLabels(args: string[]): Promise<ExitCode> {
  if (!args.includes('--ensure') && !args.includes('--dry-run')) {
    console.error('loom labels: pass --ensure or --dry-run\n')
    console.error(USAGE)
    return 2
  }
  const cfg = loadConfig()
  const apiKey = process.env[cfg.linear.apiKeyEnv]
  if (!apiKey) {
    console.error(`loom labels: ${cfg.linear.apiKeyEnv} is not set`)
    return 2
  }
  const linear = linearApiClient(apiKey)
  const result = await labelsCmd({ config: cfg, linear, dryRun: args.includes('--dry-run') })
  const padName = Math.max(6, ...result.report.map((r) => r.name.length))
  for (const row of result.report) {
    console.log(`  ${row.name.padEnd(padName)}  ${row.action}`)
  }
  console.log(`team ${result.teamKey} (${result.teamId ?? 'unknown'})`)
  return 0
}

async function runDoctor(): Promise<ExitCode> {
  const result = await doctorCmd()
  for (const r of result.results) {
    const mark = r.ok ? '✓' : '✗'
    console.log(`${mark} ${r.name.padEnd(18)} ${r.detail}`)
  }
  return result.ok ? 0 : 1
}

type PipelineContext = {
  cfg: LoomConfig
  profile: ReturnType<typeof resolveProfile>
  workspaceDir: string
  ghUser: string
  logFor: (issueId: string) => string
}

function loadPipelineContext(args: string[]): PipelineContext {
  const cfg = loadConfig()
  const profile = resolveProfile(args.find((a) => a.startsWith('--profile='))?.split('=')[1])
  const workspaceDir = cfg.repo.workspaceDir
  const ghUser = process.env.GH_USER ?? guessGhUserFromEnv() ?? ''
  return {
    cfg,
    profile,
    workspaceDir,
    ghUser,
    logFor: (issueId) => defaultLogPath(issueId, new Date(), cfg.storage.logDir)
  }
}

function guessGhUserFromEnv(): string | null {
  return process.env.GITHUB_USER ?? process.env.USER ?? null
}

function issueArg(args: string[], ctx?: { teamKey?: string } | null): string | null {
  const key = ctx?.teamKey ?? tryLoadTeamKey() ?? 'RIFT'
  const rx = new RegExp(`^${escapeRx(key)}-\\d+$`, 'i')
  return args.find((a) => rx.test(a)) ?? null
}

function tryLoadTeamKey(): string | null {
  try {
    resolveConfigPath()
    return loadConfig().linear.teamKey
  } catch {
    return null
  }
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function runPreflight(args: string[]): Promise<ExitCode> {
  const cfg = loadConfig()
  const issueId = issueArg(args, cfg.linear)
  if (!issueId) {
    console.error(`loom preflight: expected an issue like ${cfg.linear.teamKey}-123`)
    return 2
  }
  const ctx = loadPipelineContext(args)
  const r = await preflight(issueId, {
    gh: ghCliClient(),
    git: gitCliClient(),
    workspaceDir: ctx.workspaceDir,
    ghUser: ctx.ghUser,
    log: ctx.logFor(issueId),
    lockDir: cfg.storage.lockDir,
    teamKey: cfg.linear.teamKey,
    mainBranch: cfg.git.mainBranch,
    haltFileName: cfg.storage.haltFile
  })
  if (r.kind === 'halt' || r.kind === 'lock-contention') {
    console.log(`HALT ${r.reason}`)
    return 3
  }
  console.log(JSON.stringify({ issueId, profile: ctx.profile.name, state: r.state }))
  return 0
}

async function runPollDispatch(args: string[]): Promise<ExitCode> {
  const cfg = loadConfig()
  const issueId = issueArg(args, cfg.linear)
  if (!issueId) {
    console.error(`loom poll-dispatch: expected an issue like ${cfg.linear.teamKey}-123`)
    return 2
  }
  const ctx = loadPipelineContext(args)
  const r = await pollDispatch(issueId, {
    linear: linearApiClient(process.env[cfg.linear.apiKeyEnv]),
    workspaceDir: ctx.workspaceDir,
    log: ctx.logFor(issueId),
    labels: {
      dispatchOk: cfg.labels.dispatchOk,
      dispatchReject: cfg.labels.dispatchReject,
      halt: cfg.labels.halt,
      haltAll: cfg.labels.haltAll
    },
    haltFileName: cfg.storage.haltFile
  })
  if (r.kind === 'dispatch-ok') {
    console.log('dispatch-ok')
    return 0
  }
  if (r.kind === 'dispatch-reject') {
    console.log('dispatch-reject')
    return 5
  }
  if (r.kind === 'halt') {
    console.log(`HALT ${r.reason}`)
    return 3
  }
  console.log('TIMEOUT')
  return 3
}

async function runPollCi(args: string[]): Promise<ExitCode> {
  const cfg = loadConfig()
  const prNumber = parseInt(args[0] ?? '', 10)
  const issueIdx = args.indexOf('--issue')
  const issueId = issueIdx !== -1 ? args[issueIdx + 1] : undefined
  if (!prNumber || !issueId) {
    console.error('loom poll-ci <PR> --issue <ISSUE> required')
    return 2
  }
  const ctx = loadPipelineContext(args)
  const linear = linearApiClient(process.env[cfg.linear.apiKeyEnv])
  const r = await pollCi(prNumber, {
    gh: ghCliClient(),
    workspaceDir: ctx.workspaceDir,
    issueId,
    linearLabelsOf: () => linear.listLabels(issueId),
    haltFileName: cfg.storage.haltFile,
    haltLabel: cfg.labels.halt,
    haltAllLabel: cfg.labels.haltAll
  })
  if (r.kind === 'green') {
    console.log(JSON.stringify({ kind: 'green', mergeable: r.mergeable }))
    return 0
  }
  if (r.kind === 'red') {
    console.log('red')
    return 4
  }
  if (r.kind === 'halt') {
    console.log(`HALT ${r.reason}`)
    return 3
  }
  console.log('TIMEOUT')
  return 3
}

async function runMergeGate(args: string[]): Promise<ExitCode> {
  const cfg = loadConfig()
  const prNumber = parseInt(args[0] ?? '', 10)
  const issueIdx = args.indexOf('--issue')
  const issueId = issueIdx !== -1 ? args[issueIdx + 1] : undefined
  if (!prNumber || !issueId) {
    console.error('loom merge-gate <PR> --issue <ISSUE> required')
    return 2
  }
  const ctx = loadPipelineContext(args)
  const linear = linearApiClient(process.env[cfg.linear.apiKeyEnv])
  const r = await mergeGate(prNumber, issueId, {
    linear,
    workspaceDir: ctx.workspaceDir,
    isAlreadyMerged: async () => {
      const { stdout } = await pExecFile('gh', [
        'pr',
        'view',
        String(prNumber),
        '--json',
        'state'
      ])
      return (JSON.parse(stdout) as { state: string }).state === 'MERGED'
    },
    haltFileName: cfg.storage.haltFile,
    haltLabel: cfg.labels.halt,
    haltAllLabel: cfg.labels.haltAll
  })
  if (r.kind === 'merged-by-human') {
    console.log(r.kind)
    return 0
  }
  if (r.kind === 'halt') {
    console.log(`HALT ${r.reason}`)
    return 3
  }
  console.log('TIMEOUT')
  return 3
}

async function runCleanup(args: string[]): Promise<ExitCode> {
  const cfg = loadConfig()
  const issueId = issueArg(args, cfg.linear)
  if (!issueId) {
    console.error(`loom cleanup: expected an issue like ${cfg.linear.teamKey}-123`)
    return 2
  }
  const ctx = loadPipelineContext(args)
  await cleanup(issueId, {
    linear: linearApiClient(process.env[cfg.linear.apiKeyEnv]),
    log: ctx.logFor(issueId),
    lockDir: cfg.storage.lockDir,
    inflightLabel: cfg.labels.inFlight
  })
  console.log('cleanup-done')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
