import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export type LoomProfile =
  | 'aggressive'
  | 'balanced'
  | 'paranoid'
  | 'balanced+paranoid-step-3'
  | 'balanced+self-checking'

export type LoomConfig = {
  linear: { teamKey: string; apiKeyEnv: string }
  git: {
    authorBranchPrefix: string
    signoffEmail: string
    mainBranch: string
  }
  repo: { root: string; workspaceDir: string }
  pipeline: {
    profile: LoomProfile
    prTitleTemplate: string
  }
  skills: { teamSkillName: string; workSkillName: string }
  tier1: { blockedPaths: string[] }
  labels: {
    dispatchOk: string
    dispatchReject: string
    halt: string
    haltAll: string
    inFlight: string
    mergeOk: string
    dispatchPendingReview: string
  }
  storage: { logDir: string; lockDir: string; haltFile: string }
}

export const CONFIG_FILE = '.loom.json'

export const DEFAULT_BLOCKED_PATHS: readonly string[] = [
  '.github/workflows/',
  '.claude/skills/',
  'CLAUDE.md',
  'package-lock.json',
  '.env',
  '.pem',
  '.key',
  'credentials',
  'build/',
  'dist/',
  'node_modules/'
]

const VALID_PROFILES: readonly LoomProfile[] = [
  'aggressive',
  'balanced',
  'paranoid',
  'balanced+paranoid-step-3',
  'balanced+self-checking'
]

/**
 * Default bash patterns pre-approved by `scope-arm` for the duration of a fire.
 * These are convenience pre-approvals for routine pipeline work — they let an
 * armed subagent run typecheck, test, lint, and PR-creation commands without
 * tripping per-command permission prompts. The global Tier 1 bash blocklist
 * (force-push, push to main, --no-verify, etc.) still wins above these.
 */
export const DEFAULT_BASH_ALLOW: readonly string[] = [
  'npm ci',
  'npm run typecheck',
  'npm test',
  'npm run lint',
  'npm run build',
  'git add *',
  'git commit -m *',
  'git status *',
  'git diff *',
  'git checkout *',
  'git push -u origin *',
  'gh pr create *',
  'gh pr view *'
]

export function expandTilde(p: string): string {
  if (!p) return p
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/**
 * Walk upward from cwd until `.loom.json` is found. Throws if not found,
 * with a hint to run `loom init`.
 */
export function resolveConfigPath(cwd: string = process.cwd()): string {
  let dir = resolve(cwd)
  const root = resolve('/')
  while (true) {
    const candidate = join(dir, CONFIG_FILE)
    if (existsSync(candidate)) return candidate
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `loom: no ${CONFIG_FILE} found walking up from ${cwd}. Run \`loom init\` in the repo root to create one.`
  )
}

export function loadConfig(cwd: string = process.cwd()): LoomConfig {
  const path = resolveConfigPath(cwd)
  const raw = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`loom: invalid JSON in ${path}: ${msg}`)
  }
  return normalizeConfig(parsed, dirname(path))
}

type RawConfig = Partial<{
  linear: Partial<LoomConfig['linear']>
  git: Partial<LoomConfig['git']>
  repo: Partial<LoomConfig['repo']>
  pipeline: Partial<LoomConfig['pipeline']>
  skills: Partial<LoomConfig['skills']>
  tier1: Partial<LoomConfig['tier1']>
  labels: Partial<LoomConfig['labels']>
  storage: Partial<LoomConfig['storage']>
}>

function normalizeConfig(input: unknown, configDir: string): LoomConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('loom: config must be a JSON object at the top level.')
  }
  const raw = input as RawConfig

  const teamKey = raw.linear?.teamKey
  if (!teamKey || typeof teamKey !== 'string') {
    throw new Error('loom: config.linear.teamKey is required (e.g. "RIFT", "ENG").')
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(teamKey)) {
    throw new Error(
      `loom: config.linear.teamKey "${teamKey}" must be uppercase letters/digits/underscores starting with a letter (Linear team-key format).`
    )
  }

  const home = homedir()
  const resolveRepoPath = (p: string): string => {
    if (!p || p === '.') return resolve(configDir)
    const ex = expandTilde(p)
    return isAbsolute(ex) ? ex : resolve(configDir, ex)
  }

  const profile = (raw.pipeline?.profile ?? 'balanced+paranoid-step-3') as LoomProfile
  if (!VALID_PROFILES.includes(profile)) {
    throw new Error(
      `loom: config.pipeline.profile "${profile}" is not one of ${VALID_PROFILES.join(', ')}`
    )
  }

  const tier1Blocked =
    raw.tier1?.blockedPaths && Array.isArray(raw.tier1.blockedPaths)
      ? raw.tier1.blockedPaths.map((p) => String(p))
      : [...DEFAULT_BLOCKED_PATHS]

  const config: LoomConfig = {
    linear: {
      teamKey,
      apiKeyEnv: raw.linear?.apiKeyEnv ?? 'LINEAR_API_KEY'
    },
    git: {
      authorBranchPrefix: raw.git?.authorBranchPrefix ?? 'feat/',
      signoffEmail: raw.git?.signoffEmail ?? '',
      mainBranch: raw.git?.mainBranch ?? 'main'
    },
    repo: {
      root: resolveRepoPath(raw.repo?.root ?? '.'),
      workspaceDir: resolveRepoPath(raw.repo?.workspaceDir ?? '.')
    },
    pipeline: {
      profile,
      prTitleTemplate: raw.pipeline?.prTitleTemplate ?? '${summary} (${issueKey})'
    },
    skills: {
      teamSkillName: raw.skills?.teamSkillName ?? 'dev-team',
      workSkillName: raw.skills?.workSkillName ?? 'work'
    },
    tier1: { blockedPaths: tier1Blocked },
    labels: {
      dispatchOk: raw.labels?.dispatchOk ?? 'automation:dispatch-ok',
      dispatchReject: raw.labels?.dispatchReject ?? 'automation:dispatch-reject',
      halt: raw.labels?.halt ?? 'automation:halt',
      haltAll: raw.labels?.haltAll ?? 'automation:halt-all',
      inFlight: raw.labels?.inFlight ?? 'automation:in-flight',
      mergeOk: raw.labels?.mergeOk ?? 'automation:merge-ok',
      dispatchPendingReview:
        raw.labels?.dispatchPendingReview ?? 'automation:dispatch-pending-review'
    },
    storage: {
      logDir: expandTilde(raw.storage?.logDir ?? join(home, '.loom', 'logs')),
      lockDir: expandTilde(raw.storage?.lockDir ?? join(home, '.loom', 'locks')),
      haltFile: raw.storage?.haltFile ?? '.loom-halt'
    }
  }

  return config
}

/**
 * Convert a blocked-path pattern to a RegExp.
 *
 * Design note: patterns are a tiny glob-ish dialect rather than raw regex. This
 * matches the default list the spec specifies (e.g. `.github/workflows/`,
 * `.env`, `.pem`) and preserves existing semantics from riftview-docs/automation:
 * - trailing `/` means "directory prefix"; we anchor it to start-of-path
 * - a leading `.`/`.env` token with an optional sub-extension is matched
 * - a bare extension like `.pem` or `.key` matches files ending in it
 * - `credentials` (no slash/dot) matches a path basename `credentials(.ext)?`
 * - `CLAUDE.md` (no slash) matches any path ending in that basename
 */
export function blockedPathPatternToRegex(pattern: string): RegExp {
  if (pattern.endsWith('/')) {
    return new RegExp(`^${escapeRegex(pattern)}`)
  }
  if (pattern === '.env') {
    return /^\.env(\..+)?$/
  }
  if (pattern.startsWith('.') && !pattern.includes('/') && !pattern.slice(1).includes('.')) {
    // e.g. ".pem", ".key"
    return new RegExp(`${escapeRegex(pattern)}$`)
  }
  if (pattern === 'credentials') {
    return /(^|\/)credentials(\..+)?$/
  }
  if (!pattern.includes('/')) {
    // basename match — e.g. CLAUDE.md, package-lock.json
    return new RegExp(`(^|\\/)${escapeRegex(pattern)}$`)
  }
  // path prefix or explicit regex-ish string
  return new RegExp(`^${escapeRegex(pattern)}`)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
