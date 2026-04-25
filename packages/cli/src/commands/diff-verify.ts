import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { defaultScopeRoot } from './scope-arm.js'
import type { ScopeMarker } from './scope-arm.js'

export type DiffVerifyResult =
  | { kind: 'ok'; checked: string[] }
  | { kind: 'scope-exceeded'; offending: string[]; checked: string[] }
  | { kind: 'no-scope' }

export type DiffVerifyDeps = {
  /**
   * List of paths returned by `git diff --name-only main...HEAD`. When omitted,
   * `gitClient.diffNamesAgainstMain()` is invoked.
   */
  diffNames?: () => Promise<string[]>
  gitClient?: {
    diffNamesAgainstMain(mainBranch?: string): Promise<string[]>
  }
  /** Override the storage root (testing seam). Defaults to `~/.loom/fires`. */
  scopeRoot?: string
  /** Override main branch name. */
  mainBranch?: string
}

export type DiffVerifyInput = {
  issueId: string
  repoRoot: string
}

/**
 * Walk `git diff --name-only main...HEAD` against scope.json's `paths` plus
 * the hardcoded collateral rules. Out-of-scope files surface as
 * `scope-exceeded`; missing scope.json surfaces as `no-scope` so the caller
 * can decide whether to halt or fall back.
 */
export async function diffVerify(
  input: DiffVerifyInput,
  deps: DiffVerifyDeps = {}
): Promise<DiffVerifyResult> {
  const marker = readScopeMarker(input.issueId, deps.scopeRoot)
  if (!marker) return { kind: 'no-scope' }

  const names = deps.diffNames
    ? await deps.diffNames()
    : deps.gitClient
      ? await deps.gitClient.diffNamesAgainstMain(deps.mainBranch)
      : []

  const offending: string[] = []
  for (const raw of names) {
    const file = normalize(raw)
    if (!file) continue
    if (!isAllowed(file, marker)) offending.push(file)
  }

  if (offending.length > 0) {
    return { kind: 'scope-exceeded', offending, checked: names }
  }
  return { kind: 'ok', checked: names }
}

function readScopeMarker(issueId: string, scopeRoot?: string): ScopeMarker | null {
  const root = scopeRoot ?? defaultScopeRoot()
  const path = join(root, issueId, 'scope.json')
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw) as ScopeMarker
  } catch {
    return null
  }
}

/**
 * A diff entry passes verification if it matches any of:
 *   - the scope's `paths` exactly,
 *   - a directory entry in `paths` (path starts with `dir/`),
 *   - the explicit `collateral` array on the marker (reserved for future use),
 *   - a hardcoded collateral rule (README, barrel index, mirrored test).
 *
 * Excluded paths from `## Out of scope` always lose, even when they would
 * otherwise pass a collateral rule.
 */
export function isAllowed(file: string, marker: ScopeMarker): boolean {
  const f = normalize(file)
  if (!f) return false

  if (marker.excluded.some((e) => matchesPathOrDir(f, normalize(e)))) return false

  for (const p of marker.paths) {
    if (matchesPathOrDir(f, normalize(p))) return true
  }
  for (const c of marker.collateral) {
    if (matchesPathOrDir(f, normalize(c))) return true
  }

  if (matchesReadmeRule(f, marker.paths)) return true
  if (matchesBarrelRule(f, marker.paths)) return true
  if (matchesTestMirrorRule(f, marker.paths)) return true

  return false
}

function matchesPathOrDir(file: string, candidate: string): boolean {
  if (!candidate) return false
  if (candidate.endsWith('/')) {
    return file === candidate.slice(0, -1) || file.startsWith(candidate)
  }
  return file === candidate
}

/**
 * `README.md` at the same directory depth as any in-scope file, or at any
 * parent directory up to the repo root.
 */
function matchesReadmeRule(file: string, scopePaths: string[]): boolean {
  if (!file.endsWith('README.md')) return false
  const dir = posix.dirname(file)
  for (const p of scopePaths) {
    const norm = normalize(p)
    if (!norm) continue
    let cursor = norm.endsWith('/') ? norm.replace(/\/$/, '') : posix.dirname(norm)
    while (cursor && cursor !== '.') {
      if (cursor === dir) return true
      const parent = posix.dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
    // Root README always counts as collateral when something is in scope.
    if (dir === '.' || dir === '') return true
  }
  return false
}

/**
 * Barrel `index.ts` / `index.js` in the same directory as any in-scope file.
 */
function matchesBarrelRule(file: string, scopePaths: string[]): boolean {
  const base = posix.basename(file)
  if (base !== 'index.ts' && base !== 'index.js') return false
  const dir = posix.dirname(file)
  for (const p of scopePaths) {
    const norm = normalize(p)
    if (!norm) continue
    if (norm.endsWith('/')) {
      // Directory scope; barrel inside or under it is collateral.
      const stripped = norm.replace(/\/$/, '')
      if (dir === stripped || dir.startsWith(stripped + '/')) return true
      continue
    }
    if (posix.dirname(norm) === dir) return true
  }
  return false
}

/**
 * Test files mirroring source. For an in-scope `src/foo.ts`, allow:
 *   - `src/foo.test.ts` (colocated)
 *   - `tests/foo.test.ts` (sibling-mirror)
 *   - `<workspace>/tests/foo.test.ts` for nested workspaces (e.g.
 *     `packages/cli/src/foo.ts` → `packages/cli/tests/foo.test.ts`)
 */
function matchesTestMirrorRule(file: string, scopePaths: string[]): boolean {
  const base = posix.basename(file)
  // Test file? We accept `<name>.test.ts(x)`, `.spec.ts(x)`, and `.test.js`.
  const testMatch = /^(.+?)\.(test|spec)\.[tj]sx?$/.exec(base)
  if (!testMatch) return false
  const stem = testMatch[1]
  const fileDir = posix.dirname(file)

  for (const p of scopePaths) {
    const norm = normalize(p)
    if (!norm || norm.endsWith('/')) continue
    const pBase = posix.basename(norm)
    const pStem = pBase.replace(/\.(?:tsx?|jsx?)$/, '')
    if (pStem !== stem) continue
    const pDir = posix.dirname(norm)

    // Colocated: same directory.
    if (fileDir === pDir) return true

    // Sibling mirror: `src/...` → `tests/...`. Walk pDir and replace the
    // first `src` segment with `tests`.
    const mirrored = swapFirstSegment(pDir, 'src', 'tests')
    if (mirrored && mirrored === fileDir) return true
  }
  return false
}

function swapFirstSegment(dir: string, from: string, to: string): string | null {
  const parts = dir.split('/')
  const idx = parts.indexOf(from)
  if (idx === -1) return null
  parts[idx] = to
  return parts.join('/')
}

function normalize(p: string): string {
  if (!p) return ''
  let s = p.trim()
  if (s.startsWith('./')) s = s.slice(2)
  // Convert backslashes (Windows-style) to POSIX for stable matching.
  s = s.replace(/\\/g, '/')
  return s
}
