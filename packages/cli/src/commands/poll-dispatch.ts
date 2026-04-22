import {
  DISPATCH_POLL_INTERVAL_MS,
  DISPATCH_REVIEW_TIMEOUT_MS,
  LABEL_STALE_TTL_MS,
  isHalted,
  refreshInflightHeartbeat,
  auditLog,
  type LinearClient
} from '../index.js'

export type PollDispatchDeps = {
  linear: LinearClient
  workspaceDir: string
  log: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  labels?: {
    dispatchOk?: string
    dispatchReject?: string
    halt?: string
    haltAll?: string
  }
  haltFileName?: string
}

export type PollDispatchResult =
  | { kind: 'dispatch-ok' }
  | { kind: 'dispatch-reject' }
  | { kind: 'halt'; reason: string }
  | { kind: 'timeout' }

export async function pollDispatch(
  issueId: string,
  deps: PollDispatchDeps
): Promise<PollDispatchResult> {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const dispatchOk = deps.labels?.dispatchOk ?? 'automation:dispatch-ok'
  const dispatchReject = deps.labels?.dispatchReject ?? 'automation:dispatch-reject'
  const haltLabel = deps.labels?.halt ?? 'automation:halt'
  const haltAllLabel = deps.labels?.haltAll ?? 'automation:halt-all'
  const started = now()
  let lastHeartbeat = started
  while (true) {
    const labels = await deps.linear.listLabels(issueId)
    if (labels.includes(dispatchReject)) return { kind: 'dispatch-reject' }
    if (labels.includes(dispatchOk)) return { kind: 'dispatch-ok' }
    const halt = isHalted({
      issueId,
      workspaceDir: deps.workspaceDir,
      linearLabels: labels,
      haltFileName: deps.haltFileName,
      haltLabel,
      haltAllLabel
    })
    if (halt.halted) {
      auditLog(deps.log, {
        ts: new Date().toISOString(),
        phase: 'halted',
        status: 'error',
        data: halt
      })
      return {
        kind: 'halt',
        reason: `${halt.reason.kind}:${halt.reason.kind === 'label' ? halt.reason.label : halt.reason.path}`
      }
    }
    if (now() - started > DISPATCH_REVIEW_TIMEOUT_MS) return { kind: 'timeout' }
    if (now() - lastHeartbeat >= LABEL_STALE_TTL_MS) {
      await refreshInflightHeartbeat(deps.linear, issueId)
      lastHeartbeat = now()
    }
    await sleep(DISPATCH_POLL_INTERVAL_MS)
  }
}
