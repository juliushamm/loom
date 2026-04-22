import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isHalted, HALT_FILE_NAME } from '../src/halt'

describe('halt', () => {
  let workspaceDir: string

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'loom-halt-'))
  })

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('default HALT_FILE_NAME is .loom-halt', () => {
    expect(HALT_FILE_NAME).toBe('.loom-halt')
  })

  it('not halted when no signals present', () => {
    const r = isHalted({ issueId: 'TEST-1', workspaceDir, linearLabels: [] })
    expect(r.halted).toBe(false)
  })

  it('halted when workspace halt file exists', () => {
    writeFileSync(join(workspaceDir, HALT_FILE_NAME), '')
    const r = isHalted({ issueId: 'TEST-1', workspaceDir, linearLabels: [] })
    expect(r.halted).toBe(true)
    if (!r.halted) throw new Error('expected halted')
    expect(r.reason.kind).toBe('file')
  })

  it('halted when issue has automation:halt label', () => {
    const r = isHalted({
      issueId: 'TEST-1',
      workspaceDir,
      linearLabels: ['automation:halt', 'team:canvas']
    })
    expect(r.halted).toBe(true)
    if (!r.halted) throw new Error('expected halted')
    expect(r.reason.kind).toBe('label')
    if (r.reason.kind !== 'label') throw new Error('expected label reason')
    expect(r.reason.label).toBe('automation:halt')
  })

  it('halted when aggregate labels include automation:halt-all', () => {
    const r = isHalted({
      issueId: 'TEST-1',
      workspaceDir,
      linearLabels: ['automation:halt-all']
    })
    expect(r.halted).toBe(true)
    if (!r.halted) throw new Error('expected halted')
    expect(r.reason.kind).toBe('label')
    if (r.reason.kind !== 'label') throw new Error('expected label reason')
    expect(r.reason.label).toBe('automation:halt-all')
  })

  it('halt-all wins over halt in reason when both labels present', () => {
    const r = isHalted({
      issueId: 'TEST-1',
      workspaceDir,
      linearLabels: ['automation:halt', 'automation:halt-all']
    })
    expect(r.halted).toBe(true)
    if (!r.halted) throw new Error('expected halted')
    if (r.reason.kind !== 'label') throw new Error('expected label reason')
    expect(r.reason.label).toBe('automation:halt-all')
  })

  it('file halt takes precedence over label halt', () => {
    writeFileSync(join(workspaceDir, HALT_FILE_NAME), '')
    const r = isHalted({
      issueId: 'TEST-1',
      workspaceDir,
      linearLabels: ['automation:halt']
    })
    expect(r.halted).toBe(true)
    if (!r.halted) throw new Error('expected halted')
    expect(r.reason.kind).toBe('file')
  })

  it('accepts custom halt file name + labels via override', () => {
    writeFileSync(join(workspaceDir, '.custom-halt'), '')
    const r = isHalted({
      issueId: 'TEST-1',
      workspaceDir,
      linearLabels: [],
      haltFileName: '.custom-halt'
    })
    expect(r.halted).toBe(true)
  })
})
