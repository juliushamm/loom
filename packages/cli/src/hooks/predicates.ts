import { relative, isAbsolute, resolve } from 'node:path'
import {
  DEFAULT_BLOCKED_PATHS,
  blockedPathPatternToRegex,
  loadConfig
} from '../config/load.js'

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

export function checkPath({
  filePath,
  projectDir = process.cwd(),
  patterns
}: {
  filePath: string
  projectDir?: string
  patterns?: readonly string[]
}): { ok: boolean; reason?: string } {
  const p = normalize(filePath, projectDir)
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

export function checkBash({ command }: { command: string }): { ok: boolean; reason?: string } {
  for (const rule of BLOCKED_BASH_RULES) {
    if (rule.rx.test(command))
      return { ok: false, reason: `Tier 1 bash block: ${rule.why} (matched ${rule.rx})` }
  }
  return { ok: true }
}
