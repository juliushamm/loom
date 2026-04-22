import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GhClient, PullRequestSummary } from '../index.js'

const pExecFile = promisify(execFile)

export function ghCliClient(): GhClient {
  return {
    async listPullRequests(query) {
      const { stdout } = await pExecFile('gh', [
        'pr',
        'list',
        '--state',
        'open',
        '--search',
        query,
        '--json',
        'number,author,isDraft,headRefName,title'
      ])
      const raw: Array<{
        number: number
        author: { login: string }
        isDraft: boolean
        headRefName: string
        title: string
      }> = JSON.parse(stdout)
      return raw.map<PullRequestSummary>((p) => ({
        number: p.number,
        author: p.author.login,
        isDraft: p.isDraft,
        headRefName: p.headRefName,
        title: p.title
      }))
    },
    async getPullRequestStatus(prNumber) {
      const { stdout } = await pExecFile('gh', [
        'pr',
        'view',
        String(prNumber),
        '--json',
        'statusCheckRollup,mergeable'
      ])
      const { statusCheckRollup, mergeable } = JSON.parse(stdout) as {
        statusCheckRollup: Array<{ conclusion?: string; status?: string }>
        mergeable: string
      }
      return {
        state: classifyChecks(statusCheckRollup),
        mergeable: mergeable === 'MERGEABLE'
      }
    }
  }
}

function classifyChecks(
  checks: Array<{ conclusion?: string; status?: string }>
): 'green' | 'red' | 'running' | 'none' {
  if (checks.length === 0) return 'none'
  const anyRunning = checks.some((c) => c.status && c.status !== 'COMPLETED')
  if (anyRunning) return 'running'
  const anyRed = checks.some(
    (c) => c.conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion)
  )
  return anyRed ? 'red' : 'green'
}
