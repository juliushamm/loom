import { describe, it, expect } from 'vitest'
import { extractScope } from '../src/spec-scope'

describe('extractScope — `## Scope` section', () => {
  it('extracts backticked path tokens from `## Scope`', () => {
    const desc = `## Context

Some prose here.

## Scope

- \`packages/cli/src/spec-scope.ts\` — parser
- \`packages/cli/src/commands/scope-arm.ts\` — writer

## Out of scope

- nothing yet
`
    const r = extractScope(desc)
    expect(r.paths).toContain('packages/cli/src/spec-scope.ts')
    expect(r.paths).toContain('packages/cli/src/commands/scope-arm.ts')
    expect(r.excluded).toEqual([])
  })

  it('extracts plain (non-backticked) paths with extension', () => {
    const desc = `## Scope

The work touches src/foo.ts and tests/foo.test.ts.
`
    const r = extractScope(desc)
    expect(r.paths).toEqual(expect.arrayContaining(['src/foo.ts', 'tests/foo.test.ts']))
  })

  it('keeps trailing-slash directory references', () => {
    const desc = `## Scope

- \`packages/cli/src/hooks/\`
`
    const r = extractScope(desc)
    expect(r.paths).toContain('packages/cli/src/hooks/')
  })
})

describe('extractScope — fallback to whole description', () => {
  it('scans the whole description when `## Scope` is absent', () => {
    const desc = `Some bug in src/foo.ts that needs fixing.

The fix lives in tests/foo.test.ts as well.
`
    const r = extractScope(desc)
    expect(r.paths).toEqual(expect.arrayContaining(['src/foo.ts', 'tests/foo.test.ts']))
  })
})

describe('extractScope — explicit overrides', () => {
  it('`**Files:**` callout wins over `## Scope`', () => {
    const desc = `## Scope

- \`src/old.ts\`

**Files:**
- \`src/new.ts\`
- \`tests/new.test.ts\`
`
    const r = extractScope(desc)
    expect(r.paths).toContain('src/new.ts')
    expect(r.paths).toContain('tests/new.test.ts')
    expect(r.paths).not.toContain('src/old.ts')
  })

  it('fenced ```files block wins over both Files callout and Scope', () => {
    const desc = `## Scope

- \`src/old.ts\`

**Files:**
- \`src/middle.ts\`

\`\`\`files
src/winner-a.ts
src/winner-b.ts
\`\`\`
`
    const r = extractScope(desc)
    expect(r.paths).toContain('src/winner-a.ts')
    expect(r.paths).toContain('src/winner-b.ts')
    expect(r.paths).not.toContain('src/old.ts')
    expect(r.paths).not.toContain('src/middle.ts')
  })
})

describe('extractScope — `## Out of scope` exclusions', () => {
  it('populates `excluded` from `## Out of scope`', () => {
    const desc = `## Scope

- \`src/foo.ts\`

## Out of scope

- \`src/legacy.ts\`
- packages/old/index.ts
`
    const r = extractScope(desc)
    expect(r.paths).toContain('src/foo.ts')
    expect(r.excluded).toEqual(expect.arrayContaining(['src/legacy.ts', 'packages/old/index.ts']))
  })
})

describe('extractScope — normalization', () => {
  it('deduplicates repeated paths', () => {
    const desc = `## Scope

- \`src/foo.ts\` (the parser)
- \`src/foo.ts\` (the writer)
- src/foo.ts
`
    const r = extractScope(desc)
    expect(r.paths.filter((p) => p === 'src/foo.ts')).toHaveLength(1)
  })

  it('ignores prose tokens with `/` but no extension (and/or, yes/no)', () => {
    const desc = `## Scope

This and/or that, yes/no.

But \`src/real.ts\` is fine.
`
    const r = extractScope(desc)
    expect(r.paths).toContain('src/real.ts')
    expect(r.paths).not.toContain('and/or')
    expect(r.paths).not.toContain('yes/no')
  })

  it('strips trailing punctuation from extracted tokens', () => {
    const desc = `## Scope

The change touches \`src/foo.ts\`, plus src/bar.ts.
`
    const r = extractScope(desc)
    expect(r.paths).toContain('src/foo.ts')
    expect(r.paths).toContain('src/bar.ts')
  })
})

describe('extractScope — empty / edge inputs', () => {
  it('returns empty arrays for empty input', () => {
    const r = extractScope('')
    expect(r.paths).toEqual([])
    expect(r.excluded).toEqual([])
  })

  it('returns empty arrays for prose with no paths', () => {
    const r = extractScope('## Scope\n\nNothing here yet.')
    expect(r.paths).toEqual([])
    expect(r.excluded).toEqual([])
  })
})
