import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const HALT_FILE_NAME = '.loom-halt'

export type HaltReason =
  | { kind: 'file'; path: string }
  | { kind: 'label'; label: string }

export type HaltInput = {
  /**
   * The issue being evaluated. Not used directly: callers are responsible for
   * passing `linearLabels` scoped to this issue plus any aggregated global
   * halt-all labels. Retained so future per-issue scoping logic can land
   * without a signature change.
   */
  issueId: string
  workspaceDir: string
  linearLabels: readonly string[]
  /**
   * Override the halt-file basename and the halt label pair.
   * Defaults match the legacy riftview automation semantics.
   */
  haltFileName?: string
  haltLabel?: string
  haltAllLabel?: string
}

export type HaltResult = { halted: false } | { halted: true; reason: HaltReason }

export function isHalted({
  workspaceDir,
  linearLabels,
  haltFileName = HALT_FILE_NAME,
  haltLabel = 'automation:halt',
  haltAllLabel = 'automation:halt-all'
}: HaltInput): HaltResult {
  const filePath = join(workspaceDir, haltFileName)
  if (existsSync(filePath)) {
    return { halted: true, reason: { kind: 'file', path: filePath } }
  }
  for (const label of [haltAllLabel, haltLabel] as const) {
    if (linearLabels.includes(label)) {
      return { halted: true, reason: { kind: 'label', label } }
    }
  }
  return { halted: false }
}
