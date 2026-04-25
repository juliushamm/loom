/**
 * Spec-scope extraction.
 *
 * Reads a Linear issue description and pulls out the file/path tokens that
 * the work is allowed to touch. The result feeds `scope-arm`, which writes
 * `~/.loom/fires/<ISSUE>/scope.json` for the Tier 1 hooks to consult.
 *
 * Source precedence (most specific wins):
 *   1. ```files\n...\n``` fenced block (anywhere in the description)
 *   2. **Files:** callout (anywhere in the description)
 *   3. `## Scope` section
 *   4. Whole description (fallback)
 *
 * `## Out of scope` is always parsed independently and contributes to the
 * `excluded` array, regardless of which source above provided `paths`.
 */

export type ScopeExtraction = {
  paths: string[]
  excluded: string[]
}

/**
 * Match path-like tokens. Three legal shapes:
 *   - backticked: `path/to/foo.ts`        (consumed by `extractBacktickedPaths`)
 *   - plain with slash + extension: src/foo.ts
 *   - plain ending with /: packages/cli/
 *
 * The extension form requires at least one `/` to avoid matching bare words
 * like "Scope.md" inside prose; it requires a final `.ext` of 1–8 word chars
 * to keep "and/or" and similar non-path tokens out.
 */
const PLAIN_PATH_RX = /(?:[A-Za-z0-9_.@\-+]+\/)+(?:[A-Za-z0-9_.@\-+]+(?:\.[A-Za-z0-9]{1,8})|[A-Za-z0-9_.@\-+]*\/?)/g
const BACKTICK_RX = /`([^`\n]+)`/g
const BULLET_RX = /^\s*[-*]\s+(.+?)\s*$/

export function extractScope(issueDescription: string): ScopeExtraction {
  const text = issueDescription ?? ''

  const excluded = parseSection(text, 'Out of scope')

  // 1. Fenced ```files block wins.
  const fenced = extractFencedFilesBlock(text)
  if (fenced.length > 0) {
    return { paths: dedupe(fenced), excluded }
  }

  // 2. **Files:** callout wins next.
  const filesCallout = extractFilesCallout(text)
  if (filesCallout.length > 0) {
    return { paths: dedupe(filesCallout), excluded }
  }

  // 3. ## Scope section.
  const scopeSection = parseSection(text, 'Scope')
  if (scopeSection.length > 0) {
    return { paths: dedupe(scopeSection), excluded }
  }

  // 4. Fallback: scan the whole description.
  return { paths: dedupe(extractPathsFromText(text)), excluded }
}

/**
 * Extract the contents of a ```files ... ``` fenced block. Lines are taken as
 * paths verbatim (after trim). Empty lines and pure-prose lines without `/`
 * or an extension are dropped, so a careless author can still include
 * commentary inside the block without polluting the allowlist.
 */
function extractFencedFilesBlock(text: string): string[] {
  const rx = /```files\s*\n([\s\S]*?)\n?```/g
  const out: string[] = []
  for (const m of text.matchAll(rx)) {
    for (const raw of m[1].split('\n')) {
      const line = stripBullet(raw).trim()
      if (!line) continue
      if (looksLikePath(line)) out.push(normalizePath(line))
    }
  }
  return out
}

/**
 * Extract paths after a `**Files:**` (or `Files:`) callout — bulleted list
 * (- foo, * bar) or comma-separated, until the first blank line or the next
 * heading.
 */
function extractFilesCallout(text: string): string[] {
  // Find each `**Files:**` (or `Files:`) anchor, then walk forward until the
  // first blank line or next `## ` heading. Using line-walking keeps this
  // robust against multiline-regex `$` ambiguity and lets us terminate
  // cleanly at section boundaries.
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/^\s*(?:\*\*Files:\*\*|Files:)\s*$/.test(line)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const body = lines[j]
      if (/^\s*$/.test(body)) break
      if (/^##\s+/.test(body)) break
      const stripped = stripBullet(body).trim()
      if (!stripped) continue
      out.push(...extractPathsFromText(stripped))
    }
  }
  return out
}

/**
 * Pull the body of a `## <name>` section out, then extract paths from it.
 * Section ends at the next `## ` heading or end of file. Heading match is
 * case-insensitive and tolerates surrounding whitespace.
 */
function parseSection(text: string, name: string): string[] {
  const body = sectionBody(text, name)
  return body === null ? [] : extractPathsFromText(body)
}

/**
 * Slice a `## <name>` section's body out of the document. Returns null when
 * the heading is absent. Section ends at the next `^## ` heading or EOF.
 * Heading match is case-insensitive on `name`.
 */
function sectionBody(text: string, name: string): string | null {
  const lines = text.split('\n')
  const target = name.trim().toLowerCase()
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i])
    if (m && m[1].trim().toLowerCase() === target) {
      start = i + 1
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/**
 * Extract every path-shaped token from a chunk of text — backticked first
 * (highest signal), then plain. Order is preserved; dedupe is the caller's
 * responsibility.
 */
function extractPathsFromText(text: string): string[] {
  const out: string[] = []

  // Backticked tokens — strongest signal, accept anything that smells like a path.
  for (const m of text.matchAll(BACKTICK_RX)) {
    const tok = m[1].trim()
    if (looksLikePath(tok)) out.push(normalizePath(tok))
  }

  // Plain tokens — must contain a slash + an extension (or end with /).
  // Strip backticked spans first so we don't double-count.
  const stripped = text.replace(BACKTICK_RX, ' ')
  for (const m of stripped.matchAll(PLAIN_PATH_RX)) {
    const tok = m[0].trim()
    if (!tok) continue
    if (!looksLikePath(tok)) continue
    if (isProseToken(tok)) continue
    out.push(normalizePath(tok))
  }

  return out
}

function looksLikePath(tok: string): boolean {
  if (!tok) return false
  // Accept directory references (end with /).
  if (tok.endsWith('/')) return tok.length > 1 && /[A-Za-z0-9_.@\-+]/.test(tok)
  // Otherwise need a slash AND a recognizable extension.
  if (!tok.includes('/')) return false
  return /\.[A-Za-z0-9]{1,8}$/.test(tok) || /\.[A-Za-z0-9]{1,8}[)\]]?$/.test(tok)
}

/**
 * Filter out tokens that shape-match a path but are obviously prose. The
 * canonical case is "and/or", "yes/no", "I/O" — short slashed phrases with
 * no extension. Those are already filtered by `looksLikePath` (no extension),
 * but this guards against weirder cases like "TODO/done.md" mid-sentence.
 *
 * Heuristic: if the token ends in punctuation like ".", ",", ":", or ")"
 * after a non-extension character, strip it and re-test. We do this in
 * `normalizePath`, so by the time we reach here the token is already clean.
 */
function isProseToken(tok: string): boolean {
  // No-op for now — kept as a hook in case future tuning is needed.
  void tok
  return false
}

function normalizePath(tok: string): string {
  // Strip trailing punctuation that isn't part of a real path.
  let t = tok.trim()
  // Surrounding parens/brackets/quotes.
  t = t.replace(/^[("'`\[]+|[)"'`\]]+$/g, '')
  // Trailing sentence punctuation.
  t = t.replace(/[,.;:!?]+$/g, '')
  return t
}

function stripBullet(line: string): string {
  const m = BULLET_RX.exec(line)
  return m ? m[1] : line
}

function dedupe(arr: readonly string[]): string[] {
  return Array.from(new Set(arr))
}
