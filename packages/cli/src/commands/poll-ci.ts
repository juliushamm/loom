import { CI_POLL_INTERVAL_MS, isHalted, type GhClient } from '../index.js'

// CI should settle in minutes; 1h is generous for slow runners and still
// shorter than the 24h dispatch/merge review windows.
export const CI_TIMEOUT_MS = 60 * 60 * 1000

export type PollCiDeps = {
  gh: GhClient
  workspaceDir: string
  linearLabelsOf: () => Promise<string[]>
  issueId: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  haltFileName?: string
  haltLabel?: string
  haltAllLabel?: string
}

export type PollCiResult =
  | { kind: 'green'; mergeable: boolean }
  | { kind: 'red' }
  | { kind: 'halt'; reason: string }
  | { kind: 'timeout' }

export async function pollCi(prNumber: number, deps: PollCiDeps): Promise<PollCiResult> {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const started = now()
  while (true) {
    const status = await deps.gh.getPullRequestStatus(prNumber)
    if (status.state === 'green') return { kind: 'green', mergeable: status.mergeable }
    if (status.state === 'red') return { kind: 'red' }
    const labels = await deps.linearLabelsOf()
    const halt = isHalted({
      issueId: deps.issueId,
      workspaceDir: deps.workspaceDir,
      linearLabels: labels,
      haltFileName: deps.haltFileName,
      haltLabel: deps.haltLabel,
      haltAllLabel: deps.haltAllLabel
    })
    if (halt.halted) {
      return {
        kind: 'halt',
        reason: `${halt.reason.kind}:${halt.reason.kind === 'label' ? halt.reason.label : halt.reason.path}`
      }
    }
    if (now() - started > CI_TIMEOUT_MS) return { kind: 'timeout' }
    await sleep(CI_POLL_INTERVAL_MS)
  }
}
