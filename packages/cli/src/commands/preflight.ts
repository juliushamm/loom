import {
  acquireLock,
  releaseLock,
  DEFAULT_LOCK_DIR,
  probe,
  isHalted,
  auditLog,
  type GhClient,
  type GitClient,
  type ProbeState
} from '../index.js'

export type PreflightDeps = {
  gh: GhClient
  git: GitClient
  workspaceDir: string
  ghUser: string
  log: string
  lockDir?: string
  teamKey?: string
  mainBranch?: string
  haltFileName?: string
}

export type PreflightResult =
  | { kind: 'halt'; reason: string }
  | { kind: 'lock-contention'; reason: string }
  | { kind: 'ok'; state: ProbeState }

export async function preflight(issueId: string, deps: PreflightDeps): Promise<PreflightResult> {
  const lockDir = deps.lockDir ?? DEFAULT_LOCK_DIR
  const halt = isHalted({
    issueId,
    workspaceDir: deps.workspaceDir,
    linearLabels: [],
    haltFileName: deps.haltFileName
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
  const lock = acquireLock({ issueId, dir: lockDir })
  if (!lock.ok) {
    return { kind: 'lock-contention', reason: lock.reason }
  }
  try {
    const state = await probe({
      issueId,
      ghUser: deps.ghUser,
      gh: deps.gh,
      git: deps.git,
      teamKey: deps.teamKey,
      mainBranch: deps.mainBranch
    })
    auditLog(deps.log, {
      ts: new Date().toISOString(),
      phase: 'triage',
      status: 'pending',
      data: state
    })
    return { kind: 'ok', state }
  } finally {
    // Preflight always releases immediately — full-pipeline mode does not call preflight.
    releaseLock({ issueId, dir: lockDir })
  }
}
