import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, resolveConfigPath, expandTilde, blockedPathPatternToRegex } from '../src/config/load'

describe('loadConfig', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-cfg-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('throws when .loom.json is missing with run-init hint', () => {
    expect(() => loadConfig(dir)).toThrow(/loom init/)
  })

  it('loads minimal valid config', () => {
    writeFileSync(join(dir, '.loom.json'), JSON.stringify({ linear: { teamKey: 'ENG' } }))
    const cfg = loadConfig(dir)
    expect(cfg.linear.teamKey).toBe('ENG')
    expect(cfg.linear.apiKeyEnv).toBe('LINEAR_API_KEY')
    expect(cfg.git.mainBranch).toBe('main')
    expect(cfg.pipeline.profile).toBe('balanced+paranoid-step-3')
    expect(cfg.labels.dispatchOk).toBe('automation:dispatch-ok')
    expect(cfg.labels.dispatchPendingReview).toBe('automation:dispatch-pending-review')
    expect(cfg.tier1.blockedPaths.length).toBeGreaterThan(0)
    expect(cfg.storage.haltFile).toBe('.loom-halt')
  })

  it('loads full valid config with all fields overridden', () => {
    writeFileSync(
      join(dir, '.loom.json'),
      JSON.stringify({
        linear: { teamKey: 'PLAT', apiKeyEnv: 'PLAT_LINEAR_KEY' },
        git: { authorBranchPrefix: 'bot/', signoffEmail: 'bot@example.com', mainBranch: 'trunk' },
        repo: { root: '.', workspaceDir: '.' },
        pipeline: { profile: 'aggressive', prTitleTemplate: '[${issueKey}] ${summary}' },
        skills: { teamSkillName: 'crew', workSkillName: 'ship' },
        tier1: { blockedPaths: ['my-secret.txt'] },
        labels: {
          dispatchOk: 'bot:go',
          dispatchReject: 'bot:no',
          halt: 'bot:stop',
          haltAll: 'bot:stop-all',
          inFlight: 'bot:running',
          mergeOk: 'bot:merge',
          dispatchPendingReview: 'bot:review'
        },
        storage: { logDir: '/var/log/loom', lockDir: '/var/run/loom', haltFile: '.custom-halt' }
      })
    )
    const cfg = loadConfig(dir)
    expect(cfg.linear.apiKeyEnv).toBe('PLAT_LINEAR_KEY')
    expect(cfg.pipeline.profile).toBe('aggressive')
    expect(cfg.pipeline.prTitleTemplate).toBe('[${issueKey}] ${summary}')
    expect(cfg.skills.teamSkillName).toBe('crew')
    expect(cfg.tier1.blockedPaths).toEqual(['my-secret.txt'])
    expect(cfg.labels.dispatchOk).toBe('bot:go')
    expect(cfg.storage.haltFile).toBe('.custom-halt')
  })

  it('rejects missing teamKey', () => {
    writeFileSync(join(dir, '.loom.json'), JSON.stringify({ linear: {} }))
    expect(() => loadConfig(dir)).toThrow(/teamKey/)
  })

  it('rejects lowercase teamKey', () => {
    writeFileSync(join(dir, '.loom.json'), JSON.stringify({ linear: { teamKey: 'eng' } }))
    expect(() => loadConfig(dir)).toThrow(/teamKey/)
  })

  it('rejects unknown pipeline profile', () => {
    writeFileSync(
      join(dir, '.loom.json'),
      JSON.stringify({ linear: { teamKey: 'ENG' }, pipeline: { profile: 'reckless' } })
    )
    expect(() => loadConfig(dir)).toThrow(/profile/)
  })

  it('expands ~ in storage paths', () => {
    writeFileSync(
      join(dir, '.loom.json'),
      JSON.stringify({
        linear: { teamKey: 'ENG' },
        storage: { logDir: '~/loom-logs', lockDir: '~/loom-locks', haltFile: '.halt' }
      })
    )
    const cfg = loadConfig(dir)
    expect(cfg.storage.logDir).toBe(join(homedir(), 'loom-logs'))
    expect(cfg.storage.lockDir).toBe(join(homedir(), 'loom-locks'))
  })

  it('rejects non-object input', () => {
    writeFileSync(join(dir, '.loom.json'), JSON.stringify(['oops']))
    expect(() => loadConfig(dir)).toThrow(/object/)
  })

  it('rejects invalid JSON with a useful message', () => {
    writeFileSync(join(dir, '.loom.json'), '{not json')
    expect(() => loadConfig(dir)).toThrow(/invalid JSON/)
  })
})

describe('resolveConfigPath (walk-up)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-walk-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds .loom.json several directories up', () => {
    writeFileSync(join(dir, '.loom.json'), JSON.stringify({ linear: { teamKey: 'ENG' } }))
    const deep = join(dir, 'a', 'b', 'c')
    mkdirSync(deep, { recursive: true })
    expect(resolveConfigPath(deep)).toBe(join(dir, '.loom.json'))
  })

  it('throws if nothing is found up to the filesystem root', () => {
    expect(() => resolveConfigPath(dir)).toThrow(/no \.loom\.json found/)
  })
})

describe('expandTilde', () => {
  it('replaces ~ with home', () => {
    expect(expandTilde('~')).toBe(homedir())
    expect(expandTilde('~/loom')).toBe(join(homedir(), 'loom'))
  })

  it('passes non-tilde paths through', () => {
    expect(expandTilde('/abs/path')).toBe('/abs/path')
    expect(expandTilde('relative/path')).toBe('relative/path')
  })

  it('is tolerant of empty input', () => {
    expect(expandTilde('')).toBe('')
  })
})

describe('blockedPathPatternToRegex', () => {
  it('treats trailing slash as a directory prefix', () => {
    const rx = blockedPathPatternToRegex('build/')
    expect(rx.test('build/x')).toBe(true)
    expect(rx.test('xbuild/x')).toBe(false)
  })

  it('handles .env with optional suffix', () => {
    const rx = blockedPathPatternToRegex('.env')
    expect(rx.test('.env')).toBe(true)
    expect(rx.test('.env.local')).toBe(true)
    expect(rx.test('env')).toBe(false)
  })

  it('handles bare extensions', () => {
    const rx = blockedPathPatternToRegex('.pem')
    expect(rx.test('cert.pem')).toBe(true)
    expect(rx.test('x/y.pem')).toBe(true)
    expect(rx.test('x.pemA')).toBe(false)
  })

  it('handles bare filename', () => {
    const rx = blockedPathPatternToRegex('CLAUDE.md')
    expect(rx.test('CLAUDE.md')).toBe(true)
    expect(rx.test('apps/CLAUDE.md')).toBe(true)
    expect(rx.test('CLAUDE.mdx')).toBe(false)
  })

  it('handles credentials variant', () => {
    const rx = blockedPathPatternToRegex('credentials')
    expect(rx.test('credentials')).toBe(true)
    expect(rx.test('credentials.json')).toBe(true)
    expect(rx.test('a/credentials')).toBe(true)
  })
})
