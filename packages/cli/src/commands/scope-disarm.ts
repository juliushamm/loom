import { existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { defaultScopeRoot } from './scope-arm.js'

export type ScopeDisarmInput = {
  issueId: string
  /** Override the storage root (testing seam). Defaults to `~/.loom/fires`. */
  scopeRoot?: string
}

export type ScopeDisarmResult = {
  removed: boolean
  path: string
}

/**
 * Delete `~/.loom/fires/<ISSUE>/scope.json` and the parent dir if empty.
 * No-op when the marker is absent.
 */
export function scopeDisarm(input: ScopeDisarmInput): ScopeDisarmResult {
  if (!input.issueId) throw new Error('scopeDisarm: issueId required')

  const scopeRoot = input.scopeRoot ?? defaultScopeRoot()
  const dir = join(scopeRoot, input.issueId)
  const path = join(dir, 'scope.json')

  if (!existsSync(path)) return { removed: false, path }

  rmSync(path, { force: true })

  // Remove parent dir if empty — keep `~/.loom/fires/` itself intact.
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) {
      rmdirSync(dir)
    }
  } catch {
    // best-effort cleanup; never fail disarm because of dir state
  }

  return { removed: true, path }
}
