import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  DEFAULT_BLOCKED_PATHS,
  blockedPathPatternToRegex,
  loadConfig
} from '../config/load.js'
import { isAllowed as isFileAllowedByScope } from '../commands/diff-verify.js'
import type { ScopeMarker } from '../commands/scope-arm.js'

function defaultBlockedRegexes(): RegExp[] {
  return DEFAULT_BLOCKED_PATHS.map(blockedPathPatternToRegex)
}

/**
 * Resolve the effective blocked-path regex list.
 *
 * Order of precedence:
 * 1. `opts.patterns` if provided (string[] from config.tier1.blockedPaths)
 * 2. `.loom.json` config if present anywhere up the tree
 * 3. Built-in DEFAULT_BLOCKED_PATHS
 *
 * The `loadConfig` path is silent — if the config can't be read (e.g. running
 * the hook standalone before init), we fall back to the default list so the
 * hook still enforces the OSS defaults rather than crashing mid-tool-call.
 */
function resolvePatterns(opts: { patterns?: readonly string[]; projectDir?: string }): RegExp[] {
  if (opts.patterns && opts.patterns.length > 0) {
    return opts.patterns.map(blockedPathPatternToRegex)
  }
  try {
    const cfg = loadConfig(opts.projectDir ?? process.cwd())
    return cfg.tier1.blockedPaths.map(blockedPathPatternToRegex)
  } catch {
    return defaultBlockedRegexes()
  }
}

/** Default storage root for `~/.loom/fires/<ISSUE>/scope.json`. */
function defaultScopeDir(): string {
  return join(homedir(), '.loom', 'fires')
}

/**
 * Read the active scope marker. Multiple fires may be in flight; we pick the
 * most recently `armedAt` marker. Returns null when no marker is present
 * (pre-feature behavior — global blocklist still applies).
 *
 * `scopeDir` is a testing seam — production callers leave it default.
 */
export function readActiveScope(scopeDir: string = defaultScopeDir()): ScopeMarker | null {
  if (!existsSync(scopeDir)) return null
  let entries: string[]
  try {
    entries = readdirSync(scopeDir)
  } catch {
    return null
  }

  let latest: ScopeMarker | null = null
  let latestTs = -1
  for (const name of entries) {
    const candidate = join(scopeDir, name, 'scope.json')
    if (!existsSync(candidate)) continue
    try {
      const st = statSync(candidate)
      if (!st.isFile()) continue
      const raw = readFileSync(candidate, 'utf8')
      const parsed = JSON.parse(raw) as ScopeMarker
      const ts = Date.parse(parsed.armedAt ?? '') || 0
      if (ts >= latestTs) {
        latestTs = ts
        latest = parsed
      }
    } catch {
      // skip unreadable / malformed markers
    }
  }
  return latest
}

export function checkPath({
  filePath,
  projectDir = process.cwd(),
  patterns,
  scopeDir
}: {
  filePath: string
  projectDir?: string
  patterns?: readonly string[]
  scopeDir?: string
}): { ok: boolean; reason?: string } {
  const p = normalize(filePath, projectDir)

  // Scope check first: out-of-scope writes are rejected even when the global
  // blocklist would otherwise permit them. This is the additive-allow inversion
  // — the *narrow* allowlist makes the rejection set wider, not narrower.
  const scope = readActiveScope(scopeDir)
  if (scope) {
    if (!isFileAllowedByScope(p, scope)) {
      return { ok: false, reason: `scope-exceeded:${p}` }
    }
  }

  // Global blocklist remains the ceiling — scope-allow never lifts this.
  const regexes = resolvePatterns({ patterns, projectDir })
  for (const rx of regexes) {
    if (rx.test(p)) return { ok: false, reason: `Tier 1 blocked path: ${p} matches ${rx}` }
  }
  return { ok: true }
}

function normalize(filePath: string, projectDir: string): string {
  if (isAbsolute(filePath)) {
    const rel = relative(projectDir, resolve(filePath))
    return rel.startsWith('..') ? filePath : rel
  }
  return filePath.replace(/^\.\//, '')
}

const BLOCKED_BASH_RULES: Array<{ rx: RegExp; why: string }> = [
  { rx: /\bgit\s+push\s+origin\s+main\b/, why: 'push to main forbidden' },
  { rx: /\bgit\s+push\s+[^&|;]*--force/, why: '--force/--force-with-lease forbidden on push' },
  { rx: /\bgit\s+reset\s+--hard\b/, why: 'git reset --hard forbidden on published branches' },
  { rx: /\bgit\s+commit\s+[^&|;]*--amend\b/, why: 'git commit --amend after first push forbidden' },
  {
    rx: /\bgit\s+branch\s+-D\s+(main|master|develop)\b/,
    why: 'deleting protected branches forbidden'
  },
  { rx: /--no-verify\b/, why: '--no-verify forbidden (hooks are mandatory)' },
  {
    rx: /\brm\s+-rf\s+\.\/(?!dist|build|node_modules|out|\.cache|\.tmp|\.terraform|graphify-out)|\brm\s+-rf\s+(?!\.\/|dist|build|node_modules|out|\.cache|\.tmp|\.terraform|graphify-out)/,
    why: 'rm -rf restricted to generated/temp paths'
  },
  { rx: /\|\s*(sh|bash)\b/, why: 'piping remote content to a shell forbidden' },
  { rx: />\s*~\/\.ssh\//, why: 'writing to ~/.ssh forbidden' },
  { rx: />\s*~\/\.aws\//, why: 'writing to ~/.aws forbidden' },
  { rx: />\s*~\/\.claude\//, why: 'writing to ~/.claude forbidden' },
  { rx: /~\/\.aws\/credentials/, why: 'touching ~/.aws/credentials forbidden' }
]

export function checkBash({
  command,
  scopeDir
}: {
  command: string
  scopeDir?: string
}): { ok: boolean; reason?: string } {
  // Global "never-allow" rules win even when scope.bashAllow would match —
  // the scope-allow window can never reopen a hard-no.
  for (const rule of BLOCKED_BASH_RULES) {
    if (rule.rx.test(command))
      return { ok: false, reason: `Tier 1 bash block: ${rule.why} (matched ${rule.rx})` }
  }

  // Past the global ceiling, check for a scope-bashAllow short-circuit. This
  // is purely informational — the command is already allowed by the global
  // pass; we still evaluate it so future logic (e.g. logging) has the signal.
  const scope = readActiveScope(scopeDir)
  if (scope && scope.bashAllow.some((pat) => matchesGlob(pat, command))) {
    return { ok: true }
  }

  return { ok: true }
}

/**
 * Tiny glob → regex compiler for `bashAllow` patterns. Supports `*`
 * (matches any non-empty run) and `**` (matches any run including
 * separators). All other characters are matched literally. Whitespace is
 * not special — patterns include literal spaces.
 *
 * Examples:
 *   `npm test`           matches `npm test`
 *   `git commit -m *`    matches `git commit -m "feat: ..."`
 *   `git push -u origin *` matches `git push -u origin juliushamm/foo`
 */
export function matchesGlob(pattern: string, command: string): boolean {
  const rx = globToRegex(pattern)
  return rx.test(command)
}

function globToRegex(pattern: string): RegExp {
  let out = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      const next = pattern[i + 1]
      if (next === '*') {
        out += '.*'
        i += 2
      } else {
        out += '.+?'
        i += 1
      }
    } else if ('.+?^${}()|[]\\'.includes(ch)) {
      out += '\\' + ch
      i += 1
    } else {
      out += ch
      i += 1
    }
  }
  out += '$'
  return new RegExp(out)
}
