import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditLinear, auditLog, defaultLogPath } from '../src/audit'
import type { LinearClient } from '../src/linear'

function mockClient(): LinearClient & { lastBody?: string } {
  const state: { lastBody?: string } = {}
  return {
    lastBody: undefined,
    async listLabels() {
      return []
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async addLabel() {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async removeLabel() {},
    async postComment(_id, body) {
      state.lastBody = body
      this.lastBody = body
    },
    async listComments() {
      return []
    }
  } as LinearClient & { lastBody?: string }
}

describe('auditLinear', () => {
  it('emits 🟡 pending comment with phase + no detail', async () => {
    const c = mockClient()
    await auditLinear(c, 'TEST-1', 'triage', 'pending')
    expect(c.lastBody).toBe('🟡 automation:triage')
  })

  it('emits 🟢 success comment with detail suffix', async () => {
    const c = mockClient()
    await auditLinear(c, 'TEST-1', 'ci-green', 'success', 'PR #42 checks passed')
    expect(c.lastBody).toBe('🟢 automation:ci-green — PR #42 checks passed')
  })

  it('emits 🔴 error comment', async () => {
    const c = mockClient()
    await auditLinear(c, 'TEST-1', 'halted', 'error', 'workspace halt file present')
    expect(c.lastBody).toBe('🔴 automation:halted — workspace halt file present')
  })
})

describe('auditLog', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-audit-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates parent dir and appends JSON-line', () => {
    const logPath = join(dir, 'nested', 'sub', 'TEST-1.log')
    auditLog(logPath, {
      ts: '2026-04-21T00:00:00.000Z',
      phase: 'triage',
      status: 'pending',
      data: { foo: 'bar' }
    })
    expect(existsSync(logPath)).toBe(true)
    const content = readFileSync(logPath, 'utf8')
    const parsed = JSON.parse(content.trim())
    expect(parsed).toEqual({
      ts: '2026-04-21T00:00:00.000Z',
      phase: 'triage',
      status: 'pending',
      data: { foo: 'bar' }
    })
  })

  it('appends consecutive entries as separate lines', () => {
    const logPath = join(dir, 'TEST-1.log')
    auditLog(logPath, { ts: '2026-04-21T00:00:00.000Z', phase: 'triage', status: 'pending' })
    auditLog(logPath, {
      ts: '2026-04-21T00:00:01.000Z',
      phase: 'meeting-complete',
      status: 'success'
    })
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).phase).toBe('triage')
    expect(JSON.parse(lines[1]).phase).toBe('meeting-complete')
  })

  it('omits data key when absent', () => {
    const logPath = join(dir, 'TEST-1.log')
    auditLog(logPath, { ts: '2026-04-21T00:00:00.000Z', phase: 'done', status: 'success' })
    const parsed = JSON.parse(readFileSync(logPath, 'utf8').trim())
    expect(parsed).not.toHaveProperty('data')
  })
})

describe('defaultLogPath', () => {
  it('uses HOME when set and replaces : and . in the ISO timestamp', () => {
    const prev = process.env.HOME
    process.env.HOME = '/Users/test'
    try {
      const p = defaultLogPath('TEST-1', new Date('2026-04-21T12:30:45.678Z'))
      expect(p).toBe('/Users/test/.loom/logs/TEST-1-2026-04-21T12-30-45-678Z.log')
    } finally {
      process.env.HOME = prev
    }
  })

  it('accepts an explicit logDir override', () => {
    const p = defaultLogPath('TEST-1', new Date('2026-04-21T00:00:00.000Z'), '/custom/logs')
    expect(p).toBe('/custom/logs/TEST-1-2026-04-21T00-00-00-000Z.log')
  })

  it('falls back when HOME is unset', () => {
    const prev = process.env.HOME
    delete process.env.HOME
    try {
      const p = defaultLogPath('TEST-1', new Date('2026-04-21T00:00:00.000Z'))
      // os.homedir() returns something on the test runner; either way a log dir is produced
      expect(p).toMatch(/\/\.loom\/logs\/TEST-1-2026-04-21T00-00-00-000Z\.log$/)
    } finally {
      process.env.HOME = prev
    }
  })
})
