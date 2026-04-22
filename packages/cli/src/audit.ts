import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { LinearClient } from './linear.js'

export type Phase =
  | 'triage'
  | 'meeting-complete'
  | 'dispatch-pending-review'
  | 'executing'
  | 'pr-open'
  | 'ci-green'
  | 'awaiting-merge'
  | 'done'
  | 'halted'
  | 'stale-lock-recovered'
  | 'heartbeat'

export type Status = 'pending' | 'success' | 'error'

const EMOJI: Record<Status, string> = { pending: '🟡', success: '🟢', error: '🔴' }

export async function auditLinear(
  client: LinearClient,
  issueId: string,
  phase: Phase,
  status: Status,
  detail = ''
): Promise<void> {
  const body = `${EMOJI[status]} automation:${phase}${detail ? ' — ' + detail : ''}`
  await client.postComment(issueId, body)
}

export function auditLog(
  logPath: string,
  entry: { ts: string; phase: Phase; status: Status; data?: Record<string, unknown> }
): void {
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, JSON.stringify(entry) + '\n')
}

/**
 * Default log path for a given issue. `logDir` overrides the default
 * (`$HOME/.loom/logs`); callers that have loaded a LoomConfig should pass
 * `config.storage.logDir` here.
 */
export function defaultLogPath(
  issueId: string,
  startedAt: Date = new Date(),
  logDir?: string
): string {
  const ts = startedAt.toISOString().replace(/[:.]/g, '-')
  const baseDir = logDir ?? join(process.env.HOME ?? homedir() ?? '/tmp', '.loom', 'logs')
  return `${baseDir}/${issueId}-${ts}.log`
}
