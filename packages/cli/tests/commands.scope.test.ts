import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scopeArm, scopeDisarm, diffVerify } from '../src/commands'
import type { ScopeMarker } from '../src/commands'

describe('scopeArm', () => {
  let scopeRoot: string
  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), 'loom-scope-arm-'))
  })
  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true })
  })

  it('writes scope.json at the expected path', () => {
    const r = scopeArm({
      issueId: 'TEST-1',
      repo: '/repo',
      scopeExtraction: { paths: ['src/a.ts'], excluded: [] },
      scopeRoot
    })
    expect(r.path).toBe(join(scopeRoot, 'TEST-1', 'scope.json'))
    expect(existsSync(r.path)).toBe(true)
    const parsed = JSON.parse(readFileSync(r.path, 'utf8')) as ScopeMarker
    expect(parsed.issueId).toBe('TEST-1')
    expect(parsed.repo).toBe('/repo')
    expect(parsed.paths).toEqual(['src/a.ts'])
    expect(parsed.excluded).toEqual([])
    expect(parsed.bashAllow.length).toBeGreaterThan(0)
    expect(typeof parsed.armedAt).toBe('string')
  })

  it('is idempotent — re-arming overwrites', () => {
    scopeArm({
      issueId: 'TEST-1',
      repo: '/repo',
      scopeExtraction: { paths: ['src/old.ts'], excluded: [] },
      scopeRoot
    })
    const second = scopeArm({
      issueId: 'TEST-1',
      repo: '/repo',
      scopeExtraction: { paths: ['src/new.ts'], excluded: [] },
      scopeRoot
    })
    const parsed = JSON.parse(readFileSync(second.path, 'utf8')) as ScopeMarker
    expect(parsed.paths).toEqual(['src/new.ts'])
  })

  it('honors a custom bashAllow list', () => {
    const r = scopeArm({
      issueId: 'TEST-1',
      repo: '/repo',
      scopeExtraction: { paths: [], excluded: [] },
      bashAllow: ['only-this-cmd'],
      scopeRoot
    })
    const parsed = JSON.parse(readFileSync(r.path, 'utf8')) as ScopeMarker
    expect(parsed.bashAllow).toEqual(['only-this-cmd'])
  })
})

describe('scopeDisarm', () => {
  let scopeRoot: string
  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), 'loom-scope-disarm-'))
  })
  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true })
  })

  it('deletes the scope file and parent dir', () => {
    scopeArm({
      issueId: 'TEST-1',
      repo: '/repo',
      scopeExtraction: { paths: ['src/a.ts'], excluded: [] },
      scopeRoot
    })
    const r = scopeDisarm({ issueId: 'TEST-1', scopeRoot })
    expect(r.removed).toBe(true)
    expect(existsSync(join(scopeRoot, 'TEST-1', 'scope.json'))).toBe(false)
    expect(existsSync(join(scopeRoot, 'TEST-1'))).toBe(false)
  })

  it('is a no-op when the marker is absent', () => {
    const r = scopeDisarm({ issueId: 'NOT-A-FIRE', scopeRoot })
    expect(r.removed).toBe(false)
  })

  it('preserves sibling fire dirs', () => {
    scopeArm({
      issueId: 'TEST-1',
      repo: '/repo',
      scopeExtraction: { paths: [], excluded: [] },
      scopeRoot
    })
    scopeArm({
      issueId: 'TEST-2',
      repo: '/repo',
      scopeExtraction: { paths: [], excluded: [] },
      scopeRoot
    })
    scopeDisarm({ issueId: 'TEST-1', scopeRoot })
    expect(existsSync(join(scopeRoot, 'TEST-1'))).toBe(false)
    expect(existsSync(join(scopeRoot, 'TEST-2', 'scope.json'))).toBe(true)
  })
})

describe('diffVerify', () => {
  let scopeRoot: string
  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), 'loom-diff-verify-'))
  })
  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true })
  })

  function arm(issueId: string, paths: string[], excluded: string[] = []): void {
    scopeArm({
      issueId,
      repo: '/repo',
      scopeExtraction: { paths, excluded },
      scopeRoot
    })
  }

  it('returns ok when every diff entry is in scope', async () => {
    arm('TEST-1', ['src/foo.ts', 'src/bar.ts'])
    const r = await diffVerify(
      { issueId: 'TEST-1', repoRoot: '/repo' },
      { scopeRoot, diffNames: async () => ['src/foo.ts', 'src/bar.ts'] }
    )
    expect(r.kind).toBe('ok')
  })

  it('returns scope-exceeded with offending list when files are out of scope', async () => {
    arm('TEST-1', ['src/foo.ts'])
    const r = await diffVerify(
      { issueId: 'TEST-1', repoRoot: '/repo' },
      { scopeRoot, diffNames: async () => ['src/foo.ts', 'src/uninvited.ts'] }
    )
    if (r.kind !== 'scope-exceeded') throw new Error(`expected scope-exceeded, got ${r.kind}`)
    expect(r.offending).toEqual(['src/uninvited.ts'])
  })

  it('returns no-scope when scope.json is missing', async () => {
    const r = await diffVerify(
      { issueId: 'NOT-ARMED', repoRoot: '/repo' },
      { scopeRoot, diffNames: async () => ['anything.ts'] }
    )
    expect(r.kind).toBe('no-scope')
  })

  it('honors `## Out of scope` even for collateral matches', async () => {
    arm('TEST-1', ['packages/cli/src/foo.ts'], ['packages/cli/README.md'])
    const r = await diffVerify(
      { issueId: 'TEST-1', repoRoot: '/repo' },
      {
        scopeRoot,
        diffNames: async () => ['packages/cli/src/foo.ts', 'packages/cli/README.md']
      }
    )
    if (r.kind !== 'scope-exceeded') throw new Error(`expected scope-exceeded, got ${r.kind}`)
    expect(r.offending).toContain('packages/cli/README.md')
  })

  it('handles empty diffs as ok', async () => {
    arm('TEST-1', ['src/foo.ts'])
    const r = await diffVerify(
      { issueId: 'TEST-1', repoRoot: '/repo' },
      { scopeRoot, diffNames: async () => [] }
    )
    expect(r.kind).toBe('ok')
  })

  describe('collateral rules', () => {
    it('barrel index.ts in same dir as in-scope file is collateral', async () => {
      arm('TEST-1', ['src/feature/foo.ts'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        { scopeRoot, diffNames: async () => ['src/feature/foo.ts', 'src/feature/index.ts'] }
      )
      expect(r.kind).toBe('ok')
    })

    it('mirrored test file (src/foo.ts → tests/foo.test.ts) is collateral', async () => {
      arm('TEST-1', ['src/foo.ts'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        { scopeRoot, diffNames: async () => ['src/foo.ts', 'tests/foo.test.ts'] }
      )
      expect(r.kind).toBe('ok')
    })

    it('colocated test file (src/foo.ts → src/foo.test.ts) is collateral', async () => {
      arm('TEST-1', ['src/foo.ts'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        { scopeRoot, diffNames: async () => ['src/foo.ts', 'src/foo.test.ts'] }
      )
      expect(r.kind).toBe('ok')
    })

    it('workspace-mirrored test (packages/cli/src/foo.ts → packages/cli/tests/foo.test.ts)', async () => {
      arm('TEST-1', ['packages/cli/src/foo.ts'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        {
          scopeRoot,
          diffNames: async () => ['packages/cli/src/foo.ts', 'packages/cli/tests/foo.test.ts']
        }
      )
      expect(r.kind).toBe('ok')
    })

    it('README.md in same workspace is collateral', async () => {
      arm('TEST-1', ['packages/cli/src/foo.ts'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        { scopeRoot, diffNames: async () => ['packages/cli/src/foo.ts', 'packages/cli/README.md'] }
      )
      expect(r.kind).toBe('ok')
    })

    it('root README.md is collateral when anything is in scope', async () => {
      arm('TEST-1', ['src/foo.ts'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        { scopeRoot, diffNames: async () => ['src/foo.ts', 'README.md'] }
      )
      expect(r.kind).toBe('ok')
    })

    it('unrelated test file is not collateral', async () => {
      arm('TEST-1', ['src/foo.ts'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        { scopeRoot, diffNames: async () => ['src/foo.ts', 'tests/unrelated.test.ts'] }
      )
      expect(r.kind).toBe('scope-exceeded')
    })
  })

  describe('directory scope', () => {
    it('files inside an in-scope dir/ are accepted', async () => {
      arm('TEST-1', ['src/feature/'])
      const r = await diffVerify(
        { issueId: 'TEST-1', repoRoot: '/repo' },
        {
          scopeRoot,
          diffNames: async () => ['src/feature/a.ts', 'src/feature/sub/b.ts']
        }
      )
      expect(r.kind).toBe('ok')
    })
  })

  describe('reading from disk', () => {
    it('reads scope.json directly when armed via the scope-arm command', async () => {
      // Simulate an arm that wrote to disk; verify diffVerify reads the file.
      const dir = join(scopeRoot, 'TEST-9')
      mkdirSync(dir, { recursive: true })
      const marker: ScopeMarker = {
        issueId: 'TEST-9',
        repo: '/repo',
        paths: ['src/disk.ts'],
        excluded: [],
        collateral: [],
        bashAllow: [],
        armedAt: new Date().toISOString()
      }
      writeFileSync(join(dir, 'scope.json'), JSON.stringify(marker))
      const r = await diffVerify(
        { issueId: 'TEST-9', repoRoot: '/repo' },
        { scopeRoot, diffNames: async () => ['src/disk.ts'] }
      )
      expect(r.kind).toBe('ok')
    })
  })
})
