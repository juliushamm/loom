import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_FILE } from '../config/load.js'

export type InitOptions = {
  cwd: string
  force?: boolean
  /**
   * When present, values from `answers` are used verbatim; no interactive
   * prompt. Tests (and scripted callers) pass this. CLI callers omit it and
   * get `promptFn` prompts below.
   */
  answers?: {
    teamKey?: string
    authorBranchPrefix?: string
    signoffEmail?: string
  }
  promptFn?: (question: string, defaultValue?: string) => Promise<string>
  /**
   * Override the path where `loom init` looks for the work-skill source. If
   * omitted we resolve it relative to the installed package (dist location).
   */
  skillSourceDir?: string
}

export type InitResult = {
  configPath: string
  skillCopiedTo?: string
  skipped?: string[]
}

export async function initCmd(opts: InitOptions): Promise<InitResult> {
  const configPath = join(opts.cwd, CONFIG_FILE)
  if (existsSync(configPath) && !opts.force) {
    throw new Error(
      `loom: ${configPath} already exists. Re-run with --force to overwrite.`
    )
  }

  // Scripted mode: `answers` passed (even partially) = no prompts. Missing
  // fields fall back to defaults. CLI callers omit `answers` to get prompts.
  const scripted = opts.answers !== undefined

  // Prompt flow supports two input modes:
  // - TTY (interactive): readline/promises questions one-by-one.
  // - piped stdin (scripted-ish): drain all of stdin first into a queue of
  //   lines; each ask() shifts one off. This is robust against Node ending
  //   the event loop when the pipe closes mid-question.
  type Readline = import('node:readline/promises').Interface
  const state: { rl: Readline | null; queue: string[] | null } = { rl: null, queue: null }
  const isPipe = !process.stdin.isTTY

  async function drainStdin(): Promise<string[]> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return text.split(/\r?\n/)
  }

  const ask = async (question: string, defaultValue: string): Promise<string> => {
    if (opts.promptFn) return opts.promptFn(question, defaultValue)
    if (isPipe) {
      if (!state.queue) state.queue = await drainStdin()
      const suffix = defaultValue ? ` [${defaultValue}]` : ''
      process.stdout.write(`${question}${suffix}: `)
      const raw = state.queue.shift() ?? ''
      process.stdout.write(`${raw}\n`)
      return raw.trim() || defaultValue
    }
    if (!state.rl) {
      const readline = await import('node:readline/promises')
      state.rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    }
    const suffix = defaultValue ? ` [${defaultValue}]` : ''
    const answer = await state.rl.question(`${question}${suffix}: `)
    return answer.trim() || defaultValue
  }

  try {
    const teamKeyRaw = scripted
      ? opts.answers?.teamKey ?? ''
      : await ask('Linear team key (required, e.g. ENG)', '')
    const teamKey = teamKeyRaw.trim().toUpperCase()
    if (!teamKey) throw new Error('loom init: Linear team key is required.')
    if (!/^[A-Z][A-Z0-9_]*$/.test(teamKey)) {
      throw new Error(
        `loom init: team key "${teamKey}" must be uppercase letters/digits/underscores starting with a letter.`
      )
    }

    const authorBranchPrefix = (
      scripted
        ? opts.answers?.authorBranchPrefix ?? 'feat/'
        : await ask('Branch prefix for agent-authored branches', 'feat/')
    ).trim()
    const signoffEmail = (
      scripted
        ? opts.answers?.signoffEmail ?? ''
        : await ask('Git commit sign-off email (optional)', '')
    ).trim()

    return await writeAndCopy(opts, configPath, teamKey, authorBranchPrefix, signoffEmail)
  } finally {
    state.rl?.close()
  }
}

async function writeAndCopy(
  opts: InitOptions,
  configPath: string,
  teamKey: string,
  authorBranchPrefix: string,
  signoffEmail: string
): Promise<InitResult> {

  const config = {
    $schema: '../schema/v1.json',
    linear: { teamKey, apiKeyEnv: 'LINEAR_API_KEY' },
    git: {
      authorBranchPrefix,
      signoffEmail,
      mainBranch: 'main'
    },
    repo: { root: '.', workspaceDir: '.' },
    pipeline: {
      profile: 'balanced+paranoid-step-3',
      prTitleTemplate: '${summary} (${issueKey})'
    },
    skills: { teamSkillName: 'dev-team', workSkillName: 'work' }
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

  const skipped: string[] = []
  let skillCopiedTo: string | undefined
  const skillSrc = opts.skillSourceDir ?? resolveDefaultSkillSource()
  const skillDest = join(opts.cwd, '.claude', 'skills', 'work')
  const skillSkillMd = join(skillSrc, 'SKILL.md')
  if (existsSync(skillSkillMd)) {
    mkdirSync(skillDest, { recursive: true })
    const destSkillMd = join(skillDest, 'SKILL.md')
    if (existsSync(destSkillMd) && !opts.force) {
      skipped.push(destSkillMd)
    } else {
      copyFileSync(skillSkillMd, destSkillMd)
      skillCopiedTo = destSkillMd
    }
  } else {
    skipped.push(`${skillSkillMd} (missing in installed package)`)
  }

  return { configPath, skillCopiedTo, skipped }
}

/**
 * Resolve the skills/work directory in the installed package. This file lives
 * at `dist/src/commands/init.js` at runtime (published) or
 * `src/commands/init.ts` during tests — the `skills/work/` dir is two workspace
 * levels up either way (packages/cli/… ↔ ../../skills/work).
 */
function resolveDefaultSkillSource(): string {
  const here = fileURLToPath(import.meta.url)
  // Walk up until we find a `skills/work` sibling. Stop at filesystem root.
  let dir = dirname(here)
  const root = resolve('/')
  while (dir !== root) {
    const candidate = join(dir, 'skills', 'work')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: relative to repo layout
  return resolve(dirname(here), '..', '..', '..', '..', '..', 'skills', 'work')
}

