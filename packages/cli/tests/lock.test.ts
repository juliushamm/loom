import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, releaseLock, reclaimIfStale } from '../src/lock'

describe('lock', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loom-lock-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('acquires a lock when none exists', () => {
    const result = acquireLock({ issueId: 'TEST-1', dir })
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, 'TEST-1.lock'))).toBe(true)
    const body = JSON.parse(readFileSync(join(dir, 'TEST-1.lock'), 'utf8'))
    expect(body.pid).toBe(process.pid)
    expect(typeof body.startedAt).toBe('string')
    expect(body.hostname).toBeTruthy()
  })

  it('rejects when a live PID holds the lock', () => {
    acquireLock({ issueId: 'TEST-1', dir })
    const result = acquireLock({ issueId: 'TEST-1', dir })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/held by PID/)
  })

  it('reclaims a lock held by a dead PID', () => {
    const fakeDead = 999_999_999
    const path = join(dir, 'TEST-1.lock')
    writeFileSync(
      path,
      JSON.stringify({ pid: fakeDead, startedAt: new Date().toISOString(), hostname: 'x' })
    )

    const result = reclaimIfStale({ issueId: 'TEST-1', dir })
    expect(result.reclaimed).toBe(true)
    const fresh = acquireLock({ issueId: 'TEST-1', dir })
    expect(fresh.ok).toBe(true)
  })

  it('releaseLock removes the file', () => {
    acquireLock({ issueId: 'TEST-1', dir })
    releaseLock({ issueId: 'TEST-1', dir })
    expect(existsSync(join(dir, 'TEST-1.lock'))).toBe(false)
  })

  it('releaseLock is idempotent when no lock exists', () => {
    expect(() => releaseLock({ issueId: 'TEST-1', dir })).not.toThrow()
  })
})
