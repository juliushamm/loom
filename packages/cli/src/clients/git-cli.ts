import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitClient } from '../index.js'

const pExecFile = promisify(execFile)

export function gitCliClient(): GitClient {
  return {
    async lsRemoteBranches(pattern) {
      const { stdout } = await pExecFile('git', ['ls-remote', '--heads', 'origin', pattern])
      return stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split(/\s+/)[1]?.replace(/^refs\/heads\//, ''))
        .filter((s): s is string => Boolean(s))
    },
    async listCommitsAhead(branch, base) {
      const { stdout } = await pExecFile('git', [
        'rev-list',
        '--count',
        `origin/${base}..origin/${branch}`
      ])
      return parseInt(stdout.trim(), 10) || 0
    }
  }
}
