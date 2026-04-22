import { describe, it, expect } from 'vitest'
import {
  resolveProfile,
  DISPATCH_POLL_INTERVAL_MS,
  CI_POLL_INTERVAL_MS,
  DISPATCH_REVIEW_TIMEOUT_MS,
  MERGE_REVIEW_TIMEOUT_MS,
  LABEL_STALE_TTL_MS,
  PROFILE_NAMES
} from '../src/runtime-config'

describe('runtime-config (timing + gate profiles)', () => {
  it('exposes timing constants', () => {
    expect(DISPATCH_POLL_INTERVAL_MS).toBe(30_000)
    expect(CI_POLL_INTERVAL_MS).toBe(60_000)
    expect(DISPATCH_REVIEW_TIMEOUT_MS).toBe(86_400_000)
    expect(MERGE_REVIEW_TIMEOUT_MS).toBe(86_400_000)
    expect(LABEL_STALE_TTL_MS).toBe(14_400_000)
  })

  it('resolves aggressive — no human gates', () => {
    const g = resolveProfile('aggressive')
    expect(g.dispatchReviewGate).toBe(false)
    expect(g.mergeGate).toBe(false)
  })

  it('resolves balanced — merge gate only', () => {
    const g = resolveProfile('balanced')
    expect(g.dispatchReviewGate).toBe(false)
    expect(g.mergeGate).toBe(true)
  })

  it('resolves paranoid — both gates', () => {
    const g = resolveProfile('paranoid')
    expect(g.dispatchReviewGate).toBe(true)
    expect(g.mergeGate).toBe(true)
  })

  it('default is balanced+paranoid-step-3 (both gates)', () => {
    const g = resolveProfile()
    expect(g.dispatchReviewGate).toBe(true)
    expect(g.mergeGate).toBe(true)
    expect(g.name).toBe('balanced+paranoid-step-3')
  })

  it('throws on unknown profile', () => {
    expect(() => resolveProfile('invalid')).toThrow(/unknown profile/i)
  })

  it('PROFILE_NAMES lists all valid options', () => {
    expect(PROFILE_NAMES).toEqual([
      'aggressive',
      'balanced',
      'paranoid',
      'balanced+paranoid-step-3'
    ])
  })
})
