import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_BASH_ALLOW } from '../config/load.js'
import type { ScopeExtraction } from '../spec-scope.js'

/**
 * Shape of `~/.loom/fires/<ISSUE>/scope.json`. The Tier 1 hooks
 * (`checkPath`, `checkBash`) read this file when present and apply additive
 * allow logic on top of the global blocklist.
 */
export type ScopeMarker = {
  issueId: string
  repo: string
  paths: string[]
  excluded: string[]
  collateral: string[]
  bashAllow: string[]
  armedAt: string
}

export type ScopeArmInput = {
  issueId: string
  repo: string
  scopeExtraction: ScopeExtraction
  bashAllow?: readonly string[]
  /** Override the storage root (testing seam). Defaults to `~/.loom/fires`. */
  scopeRoot?: string
  /** Override the timestamp (testing seam). */
  now?: () => Date
}

export type ScopeArmResult = {
  path: string
  marker: ScopeMarker
}

export function scopeArm(input: ScopeArmInput): ScopeArmResult {
  if (!input.issueId) throw new Error('scopeArm: issueId required')
  if (!input.repo) throw new Error('scopeArm: repo required')

  const scopeRoot = input.scopeRoot ?? defaultScopeRoot()
  const dir = join(scopeRoot, input.issueId)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'scope.json')

  const marker: ScopeMarker = {
    issueId: input.issueId,
    repo: input.repo,
    paths: [...input.scopeExtraction.paths],
    excluded: [...input.scopeExtraction.excluded],
    collateral: [],
    bashAllow: [...(input.bashAllow ?? DEFAULT_BASH_ALLOW)],
    armedAt: (input.now?.() ?? new Date()).toISOString()
  }

  writeFileSync(path, JSON.stringify(marker, null, 2) + '\n', 'utf8')
  return { path, marker }
}

export function defaultScopeRoot(): string {
  return join(homedir(), '.loom', 'fires')
}
