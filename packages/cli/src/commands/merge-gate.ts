import { MERGE_REVIEW_TIMEOUT_MS, CI_POLL_INTERVAL_MS, isHalted, type LinearClient } from '../index.js'

export type MergeGateDeps = {
  linear: LinearClient
  workspaceDir: string
  isAlreadyMerged: () => Promise<boolean>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  haltFileName?: string
  haltLabel?: string
  haltAllLabel?: string
}

export type MergeGateResult =
  | { kind: 'merged-by-human' }
  | { kind: 'halt'; reason: string }
  | { kind: 'timeout' }

/**
 * Waits for the PR to be merged by a human. v1 does NOT automate the merge —
 * the automation posts a "🟢 automation:awaiting-merge" comment when CI goes
 * green and this command polls until either:
 * - `isAlreadyMerged()` returns true (human squash-merged in the GitHub UI or CLI)
 * - a halt signal appears (file or label)
 * - MERGE_REVIEW_TIMEOUT_MS elapses
 */
export async function mergeGate(
  _prNumber: number,
  issueId: string,
  deps: MergeGateDeps
): Promise<MergeGateResult> {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const started = now()
  while (true) {
    if (await deps.isAlreadyMerged()) {
      return { kind: 'merged-by-human' }
    }
    const labels = await deps.linear.listLabels(issueId)
    const halt = isHalted({
      issueId,
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
    if (now() - started > MERGE_REVIEW_TIMEOUT_MS) return { kind: 'timeout' }
    await sleep(CI_POLL_INTERVAL_MS)
  }
}
