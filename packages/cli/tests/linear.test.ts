import { describe, it, expect } from 'vitest'
import {
  applyInflightLock,
  refreshInflightHeartbeat,
  releaseInflightLock,
  isLockStale,
  type LinearClient
} from '../src/linear'

function mockClient(): LinearClient & {
  calls: string[]
  _labels: Set<string>
  _comments: Array<{ id: string; body: string; createdAt: string }>
} {
  const labels = new Set<string>()
  const comments: Array<{ id: string; body: string; createdAt: string }> = []
  const calls: string[] = []
  return {
    _labels: labels,
    _comments: comments,
    calls,
    async listLabels() {
      calls.push('listLabels')
      return [...labels]
    },
    async addLabel(_id, l) {
      calls.push(`addLabel:${l}`)
      labels.add(l)
    },
    async removeLabel(_id, l) {
      calls.push(`removeLabel:${l}`)
      labels.delete(l)
    },
    async postComment(_id, body) {
      calls.push('postComment')
      comments.push({ id: String(comments.length), body, createdAt: new Date().toISOString() })
    },
    async listComments() {
      calls.push('listComments')
      return [...comments]
    }
  }
}

describe('linear', () => {
  it('applyInflightLock adds label + posts heartbeat comment', async () => {
    const c = mockClient()
    await applyInflightLock(c, 'TEST-1')
    expect(c._labels.has('automation:in-flight')).toBe(true)
    expect(c._comments[0].body).toMatch(/🟡 automation:in-flight — heartbeat/)
  })

  it('refreshInflightHeartbeat posts a heartbeat comment', async () => {
    const c = mockClient()
    await refreshInflightHeartbeat(c, 'TEST-1')
    expect(c._comments[0].body).toMatch(/🟡 automation:heartbeat/)
  })

  it('releaseInflightLock removes label', async () => {
    const c = mockClient()
    await applyInflightLock(c, 'TEST-1')
    await releaseInflightLock(c, 'TEST-1')
    expect(c._labels.has('automation:in-flight')).toBe(false)
  })

  it('isLockStale true when no heartbeats', async () => {
    const c = mockClient()
    const stale = await isLockStale(c, 'TEST-1', 3_600_000)
    expect(stale).toBe(true)
  })

  it('isLockStale false when heartbeat within TTL', async () => {
    const c = mockClient()
    await applyInflightLock(c, 'TEST-1')
    const stale = await isLockStale(c, 'TEST-1', 3_600_000)
    expect(stale).toBe(false)
  })

  it('isLockStale true when most-recent heartbeat is older than TTL (explicit now)', async () => {
    const c = mockClient()
    const then = new Date('2026-04-21T00:00:00.000Z')
    const now = new Date('2026-04-21T05:30:00.000Z') // 5.5h later
    c._comments.push({
      id: 'x',
      body: '🟡 automation:in-flight — heartbeat',
      createdAt: then.toISOString()
    })
    const stale = await isLockStale(c, 'TEST-1', 4 * 3_600_000, now)
    expect(stale).toBe(true)
  })

  it('isLockStale false when latest heartbeat is within TTL of explicit now', async () => {
    const c = mockClient()
    const then = new Date('2026-04-21T00:00:00.000Z')
    const now = new Date('2026-04-21T03:30:00.000Z') // 3.5h later
    c._comments.push({
      id: 'x',
      body: '🟡 automation:in-flight — heartbeat',
      createdAt: then.toISOString()
    })
    const stale = await isLockStale(c, 'TEST-1', 4 * 3_600_000, now)
    expect(stale).toBe(false)
  })
})
