import {
  DEFAULT_LOCK_DIR,
  releaseLock,
  releaseInflightLock,
  auditLog,
  type LinearClient
} from '../index.js'

export type CleanupDeps = {
  linear: LinearClient
  lockDir?: string
  log: string
  inflightLabel?: string
}

export async function cleanup(issueId: string, deps: CleanupDeps): Promise<void> {
  releaseLock({ issueId, dir: deps.lockDir ?? DEFAULT_LOCK_DIR })
  try {
    await releaseInflightLock(deps.linear, issueId, deps.inflightLabel)
  } catch {
    // releasing a non-existent label is fine; don't block cleanup on Linear errors
  }
  try {
    auditLog(deps.log, {
      ts: new Date().toISOString(),
      phase: 'done',
      status: 'success'
    })
  } catch {
    // a failed audit write must not prevent lock release from completing cleanly
  }
}
