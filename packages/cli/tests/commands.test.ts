import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  preflight,
  pollDispatch,
  pollCi,
  mergeGate,
  cleanup,
  initCmd,
  labelsCmd,
  doctorCmd
} from '../src/commands'
import {
  HALT_FILE_NAME,
  type LinearClient,
  type GhClient,
  type GitClient
} from '../src/index'
import type { ExtendedLinearClient } from '../src/clients/linear-api'

function mockLinear(
  initial: {
    labels?: string[]
    comments?: Array<{ id: string; body: string; createdAt: string }>
  } = {}
): LinearClient & {
  _labels: Set<string>
  _comments: Array<{ id: string; body: string; createdAt: string }>
} {
  const labels = new Set(initial.labels ?? [])
  const comments = [...(initial.comments ?? [])]
  return {
    _labels: labels,
    _comments: comments,
    async listLabels() {
      return [...labels]
    },
    async addLabel(_id, l) {
      labels.add(l)
    },
    async removeLabel(_id, l) {
      labels.delete(l)
    },
    async postComment(_id, body) {
      comments.push({ id: String(comments.length), body, createdAt: new Date().toISOString() })
    },
    async listComments() {
      return [...comments]
    }
  }
}

function mockGh(over: Partial<GhClient> = {}): GhClient {
  return {
    async listPullRequests() {
      return []
    },
    async getPullRequestStatus() {
      return { state: 'none', mergeable: false }
    },
    ...over
  }
}

function mockGit(over: Partial<GitClient> = {}): GitClient {
  return {
    async lsRemoteBranches() {
      return []
    },
    async listCommitsAhead() {
      return 0
    },
    async diffNamesAgainstMain() {
      return []
    },
    ...over
  }
}

describe('preflight (refactored)', () => {
  let workspaceDir: string
  let lockDir: string
  let logDir: string
  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'loom-pre-'))
    lockDir = mkdtempSync(join(tmpdir(), 'loom-pre-lock-'))
    logDir = mkdtempSync(join(tmpdir(), 'loom-pre-log-'))
  })
  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
    rmSync(lockDir, { recursive: true, force: true })
    rmSync(logDir, { recursive: true, force: true })
  })

  it('returns ok with probe state on fresh issue', async () => {
    const r = await preflight('TEST-1', {
      gh: mockGh(),
      git: mockGit(),
      workspaceDir,
      ghUser: 'juliushamm',
      log: join(logDir, 'r.log'),
      lockDir,
      teamKey: 'TEST'
    })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') throw new Error('expected ok')
    expect(r.state.state).toBe('fresh')
  })

  it('halts when workspace halt file present', async () => {
    writeFileSync(join(workspaceDir, HALT_FILE_NAME), '')
    const r = await preflight('TEST-1', {
      gh: mockGh(),
      git: mockGit(),
      workspaceDir,
      ghUser: 'juliushamm',
      log: join(logDir, 'r.log'),
      lockDir,
      teamKey: 'TEST'
    })
    expect(r.kind).toBe('halt')
  })

  it('releases lock on success (re-acquirable)', async () => {
    const deps = {
      gh: mockGh(),
      git: mockGit(),
      workspaceDir,
      ghUser: 'juliushamm',
      log: join(logDir, 'r.log'),
      lockDir,
      teamKey: 'TEST'
    }
    await preflight('TEST-1', deps)
    const r2 = await preflight('TEST-1', deps) // would fail if the first didn't release
    expect(r2.kind).toBe('ok')
  })
})

describe('pollDispatch', () => {
  let workspaceDir: string
  let logDir: string
  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'loom-pd-'))
    logDir = mkdtempSync(join(tmpdir(), 'loom-pd-log-'))
  })
  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
    rmSync(logDir, { recursive: true, force: true })
  })

  it('returns dispatch-ok when label appears', async () => {
    const linear = mockLinear({ labels: ['automation:dispatch-ok'] })
    const r = await pollDispatch('TEST-1', {
      linear,
      workspaceDir,
      log: join(logDir, 'r.log'),
      sleep: async () => {}
    })
    expect(r.kind).toBe('dispatch-ok')
  })

  it('returns halt when label appears', async () => {
    const linear = mockLinear({ labels: ['automation:halt'] })
    const r = await pollDispatch('TEST-1', {
      linear,
      workspaceDir,
      log: join(logDir, 'r.log'),
      sleep: async () => {}
    })
    expect(r.kind).toBe('halt')
  })

  it('returns dispatch-reject when label appears', async () => {
    const linear = mockLinear({ labels: ['automation:dispatch-reject'] })
    const r = await pollDispatch('TEST-1', {
      linear,
      workspaceDir,
      log: join(logDir, 'r.log'),
      sleep: async () => {}
    })
    expect(r.kind).toBe('dispatch-reject')
  })

  it('prefers dispatch-reject over dispatch-ok when both labels are present', async () => {
    const linear = mockLinear({
      labels: ['automation:dispatch-ok', 'automation:dispatch-reject']
    })
    const r = await pollDispatch('TEST-1', {
      linear,
      workspaceDir,
      log: join(logDir, 'r.log'),
      sleep: async () => {}
    })
    expect(r.kind).toBe('dispatch-reject')
  })

  it('returns timeout when clock advances past DISPATCH_REVIEW_TIMEOUT_MS', async () => {
    const linear = mockLinear()
    let t = 0
    const r = await pollDispatch('TEST-1', {
      linear,
      workspaceDir,
      log: join(logDir, 'r.log'),
      now: () => {
        const cur = t
        t += 25 * 3600 * 1000
        return cur
      },
      sleep: async () => {}
    })
    expect(r.kind).toBe('timeout')
  })

  it('respects custom dispatch labels via options', async () => {
    const linear = mockLinear({ labels: ['custom:go'] })
    const r = await pollDispatch('TEST-1', {
      linear,
      workspaceDir,
      log: join(logDir, 'r.log'),
      sleep: async () => {},
      labels: { dispatchOk: 'custom:go', dispatchReject: 'custom:no' }
    })
    expect(r.kind).toBe('dispatch-ok')
  })
})

describe('pollCi', () => {
  let workspaceDir: string
  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'loom-pci-'))
  })
  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns green when CI is green', async () => {
    const gh = mockGh({
      async getPullRequestStatus() {
        return { state: 'green', mergeable: true }
      }
    })
    const r = await pollCi(42, {
      gh,
      workspaceDir,
      issueId: 'TEST-1',
      linearLabelsOf: async () => [],
      sleep: async () => {}
    })
    if (r.kind !== 'green') throw new Error(`expected green, got ${r.kind}`)
    expect(r.mergeable).toBe(true)
  })

  it('returns red when CI is red', async () => {
    const gh = mockGh({
      async getPullRequestStatus() {
        return { state: 'red', mergeable: false }
      }
    })
    const r = await pollCi(42, {
      gh,
      workspaceDir,
      issueId: 'TEST-1',
      linearLabelsOf: async () => [],
      sleep: async () => {}
    })
    expect(r.kind).toBe('red')
  })

  it('returns halt when halt label appears mid-poll', async () => {
    let calls = 0
    const gh = mockGh({
      async getPullRequestStatus() {
        calls++
        return { state: 'running', mergeable: false }
      }
    })
    const labels = async (): Promise<string[]> => (calls >= 1 ? ['automation:halt'] : [])
    const r = await pollCi(42, {
      gh,
      workspaceDir,
      issueId: 'TEST-1',
      linearLabelsOf: labels,
      sleep: async () => {}
    })
    expect(r.kind).toBe('halt')
  })

  it('returns timeout when CI stays running and clock advances', async () => {
    const gh = mockGh({
      async getPullRequestStatus() {
        return { state: 'running', mergeable: false }
      }
    })
    let t = 0
    const r = await pollCi(42, {
      gh,
      workspaceDir,
      issueId: 'TEST-1',
      linearLabelsOf: async () => [],
      now: () => {
        const cur = t
        t += 2 * 3600 * 1000
        return cur
      },
      sleep: async () => {}
    })
    expect(r.kind).toBe('timeout')
  })
})

describe('mergeGate', () => {
  let workspaceDir: string
  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'loom-mg-'))
  })
  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('returns merged-by-human when PR is already merged', async () => {
    const linear = mockLinear()
    const r = await mergeGate(42, 'TEST-1', {
      linear,
      workspaceDir,
      isAlreadyMerged: async () => true,
      sleep: async () => {}
    })
    expect(r.kind).toBe('merged-by-human')
  })

  it('returns halt when halt label appears before the PR is merged', async () => {
    const linear = mockLinear({ labels: ['automation:halt'] })
    const r = await mergeGate(42, 'TEST-1', {
      linear,
      workspaceDir,
      isAlreadyMerged: async () => false,
      sleep: async () => {}
    })
    expect(r.kind).toBe('halt')
  })

  it('returns timeout when clock advances past MERGE_REVIEW_TIMEOUT_MS', async () => {
    const linear = mockLinear()
    let t = 0
    const r = await mergeGate(42, 'TEST-1', {
      linear,
      workspaceDir,
      isAlreadyMerged: async () => false,
      now: () => {
        const cur = t
        t += 25 * 3600 * 1000
        return cur
      },
      sleep: async () => {}
    })
    expect(r.kind).toBe('timeout')
  })
})

describe('cleanup', () => {
  let lockDir: string
  let logDir: string
  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), 'loom-cl-'))
    logDir = mkdtempSync(join(tmpdir(), 'loom-cl-log-'))
  })
  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true })
    rmSync(logDir, { recursive: true, force: true })
  })

  it('releases lock + in-flight label + writes done log', async () => {
    const { acquireLock } = await import('../src/index')
    acquireLock({ issueId: 'TEST-1', dir: lockDir })
    const linear = mockLinear({ labels: ['automation:in-flight'] })
    await cleanup('TEST-1', { linear, lockDir, log: join(logDir, 'r.log') })
    expect(linear._labels.has('automation:in-flight')).toBe(false)
    const r = acquireLock({ issueId: 'TEST-1', dir: lockDir })
    expect(r.ok).toBe(true)
  })

  it('idempotent when no lock or label exists', async () => {
    const linear = mockLinear()
    await expect(
      cleanup('TEST-1', { linear, lockDir, log: join(logDir, 'r.log') })
    ).resolves.toBeUndefined()
  })
})

// ---------- new commands ---------- //

describe('init', () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'loom-init-'))
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('writes .loom.json with the provided team key', async () => {
    const result = await initCmd({
      cwd,
      answers: { teamKey: 'ENG', authorBranchPrefix: 'feat/', signoffEmail: 'x@y.z' }
    })
    expect(result.configPath).toBe(join(cwd, '.loom.json'))
    const parsed = JSON.parse(readFileSync(result.configPath, 'utf8'))
    expect(parsed.linear.teamKey).toBe('ENG')
    expect(parsed.git.authorBranchPrefix).toBe('feat/')
    expect(parsed.git.signoffEmail).toBe('x@y.z')
    expect(parsed.pipeline.profile).toBe('balanced+paranoid-step-3')
  })

  it('refuses to overwrite existing config without --force', async () => {
    writeFileSync(join(cwd, '.loom.json'), '{}')
    await expect(
      initCmd({ cwd, answers: { teamKey: 'ENG' } })
    ).rejects.toThrow(/already exists/)
  })

  it('overwrites with --force', async () => {
    writeFileSync(join(cwd, '.loom.json'), '{"old":true}')
    await initCmd({ cwd, force: true, answers: { teamKey: 'ENG' } })
    const parsed = JSON.parse(readFileSync(join(cwd, '.loom.json'), 'utf8'))
    expect(parsed.linear.teamKey).toBe('ENG')
  })

  it('rejects invalid team keys (leading digit)', async () => {
    await expect(
      initCmd({ cwd, answers: { teamKey: '2ENG' } })
    ).rejects.toThrow(/team key/)
  })

  it('rejects empty team keys', async () => {
    await expect(initCmd({ cwd, answers: { teamKey: '' } })).rejects.toThrow(/required/)
  })

  it('upcases the team key', async () => {
    await initCmd({ cwd, answers: { teamKey: 'eng' } })
    const parsed = JSON.parse(readFileSync(join(cwd, '.loom.json'), 'utf8'))
    expect(parsed.linear.teamKey).toBe('ENG')
  })
})

// ---------- labels ---------- //

function mockExtendedLinear(
  over: Partial<ExtendedLinearClient> = {}
): ExtendedLinearClient & { _created: string[] } {
  const created: string[] = []
  const base: ExtendedLinearClient = {
    async listLabels() {
      return []
    },
    async addLabel() {},
    async removeLabel() {},
    async postComment() {},
    async listComments() {
      return []
    },
    async listTeams() {
      return []
    },
    async findTeamByKey() {
      return null
    },
    async listTeamLabels() {
      return []
    },
    async findLabel() {
      return null
    },
    async createLabel(name) {
      created.push(name)
      return { id: `id-${name}`, name }
    },
    async getIssueDescription() {
      return ''
    },
    ...over
  }
  return Object.assign(base, { _created: created })
}

function mkConfig(overrides: Partial<import('../src/config/load').LoomConfig> = {}): import('../src/config/load').LoomConfig {
  return {
    linear: { teamKey: 'TEST', apiKeyEnv: 'LINEAR_API_KEY' },
    git: { authorBranchPrefix: 'feat/', signoffEmail: '', mainBranch: 'main' },
    repo: { root: '/tmp', workspaceDir: '/tmp' },
    pipeline: { profile: 'balanced+paranoid-step-3', prTitleTemplate: '${summary}' },
    skills: { teamSkillName: 'dev-team', workSkillName: 'work' },
    tier1: { blockedPaths: [] },
    labels: {
      dispatchOk: 'automation:dispatch-ok',
      dispatchReject: 'automation:dispatch-reject',
      halt: 'automation:halt',
      haltAll: 'automation:halt-all',
      inFlight: 'automation:in-flight',
      mergeOk: 'automation:merge-ok',
      dispatchPendingReview: 'automation:dispatch-pending-review'
    },
    storage: { logDir: '/tmp/.loom/logs', lockDir: '/tmp/.loom/locks', haltFile: '.loom-halt' },
    ...overrides
  }
}

describe('labels --ensure', () => {
  it('creates missing labels on the team', async () => {
    const linear = mockExtendedLinear({
      async findTeamByKey(key) {
        return key === 'TEST' ? { id: 'team-1', key: 'TEST', name: 'Test' } : null
      },
      async listTeamLabels() {
        return [{ id: 'l1', name: 'automation:halt' }]
      }
    })
    const result = await labelsCmd({ config: mkConfig(), linear })
    const actions = Object.fromEntries(result.report.map((r) => [r.name, r.action]))
    expect(actions['automation:halt']).toBe('existing')
    expect(actions['automation:dispatch-ok']).toBe('created')
    expect(actions['automation:in-flight']).toBe('created')
    expect(linear._created.length).toBeGreaterThan(0)
  })

  it('dry-run does not create labels', async () => {
    const linear = mockExtendedLinear({
      async findTeamByKey() {
        return { id: 'team-1', key: 'TEST', name: 'Test' }
      },
      async listTeamLabels() {
        return []
      }
    })
    const result = await labelsCmd({ config: mkConfig(), linear, dryRun: true })
    expect(linear._created).toHaveLength(0)
    for (const row of result.report) {
      expect(row.action).toBe('skipped-dry-run')
    }
  })

  it('throws when team not found', async () => {
    const linear = mockExtendedLinear({ async findTeamByKey() { return null } })
    await expect(labelsCmd({ config: mkConfig(), linear })).rejects.toThrow(/no Linear team/)
  })
})

// ---------- doctor ---------- //

describe('doctor', () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'loom-doc-'))
    writeFileSync(
      join(cwd, '.loom.json'),
      JSON.stringify({ linear: { teamKey: 'TEST' }, repo: { root: cwd } })
    )
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('reports ok when all checks pass (mocked)', async () => {
    const prev = process.env.LINEAR_API_KEY
    process.env.LINEAR_API_KEY = 'fake'
    try {
      const result = await doctorCmd({
        cwd,
        linearFactory: () =>
          mockExtendedLinear({
            async listTeams() {
              return [{ id: 'team-1', key: 'TEST', name: 'Test' }]
            },
            async listTeamLabels() {
              return [
                { id: 'l1', name: 'automation:dispatch-ok' },
                { id: 'l2', name: 'automation:dispatch-reject' },
                { id: 'l3', name: 'automation:halt' },
                { id: 'l4', name: 'automation:halt-all' },
                { id: 'l5', name: 'automation:in-flight' },
                { id: 'l6', name: 'automation:merge-ok' },
                { id: 'l7', name: 'automation:dispatch-pending-review' }
              ]
            }
          }),
        ghStatus: async () => ({ ok: true, detail: 'authenticated' }),
        gitRepoRoot: async () => cwd
      })
      expect(result.ok).toBe(true)
    } finally {
      process.env.LINEAR_API_KEY = prev
    }
  })

  it('reports fail when LINEAR_API_KEY is missing', async () => {
    const prev = process.env.LINEAR_API_KEY
    delete process.env.LINEAR_API_KEY
    try {
      const result = await doctorCmd({
        cwd,
        ghStatus: async () => ({ ok: true, detail: 'ok' }),
        gitRepoRoot: async () => cwd
      })
      expect(result.ok).toBe(false)
      const apiCheck = result.results.find((r) => r.name === 'linear-api-key')
      expect(apiCheck?.ok).toBe(false)
    } finally {
      if (prev) process.env.LINEAR_API_KEY = prev
    }
  })

  it('reports fail when config is missing', async () => {
    const emptyCwd = mkdtempSync(join(tmpdir(), 'loom-doc-empty-'))
    try {
      const result = await doctorCmd({
        cwd: emptyCwd,
        ghStatus: async () => ({ ok: true, detail: 'ok' }),
        gitRepoRoot: async () => emptyCwd
      })
      expect(result.ok).toBe(false)
      const cfg = result.results.find((r) => r.name === 'config')
      expect(cfg?.ok).toBe(false)
    } finally {
      rmSync(emptyCwd, { recursive: true, force: true })
    }
  })

  it('reports fail when labels are missing', async () => {
    const prev = process.env.LINEAR_API_KEY
    process.env.LINEAR_API_KEY = 'fake'
    try {
      const result = await doctorCmd({
        cwd,
        linearFactory: () =>
          mockExtendedLinear({
            async listTeams() {
              return [{ id: 'team-1', key: 'TEST', name: 'Test' }]
            },
            async listTeamLabels() {
              return []
            }
          }),
        ghStatus: async () => ({ ok: true, detail: 'ok' }),
        gitRepoRoot: async () => cwd
      })
      const labels = result.results.find((r) => r.name === 'labels')
      expect(labels?.ok).toBe(false)
      expect(labels?.detail).toMatch(/missing/)
      expect(result.ok).toBe(false)
    } finally {
      process.env.LINEAR_API_KEY = prev
    }
  })
})

// touch existsSync export to keep import referenced (tests run on bundlers
// that don't tree-shake test deps, but be explicit)
void existsSync
