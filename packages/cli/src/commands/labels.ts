import type { LoomConfig } from '../config/load.js'
import type { ExtendedLinearClient } from '../clients/linear-api.js'

export type LabelAction = 'existing' | 'created' | 'skipped-dry-run'
export type LabelReport = { name: string; action: LabelAction }

export type LabelsCmdOptions = {
  config: LoomConfig
  linear: ExtendedLinearClient
  dryRun?: boolean
}

/**
 * Ensures all `config.labels.*` labels exist on the team identified by
 * `config.linear.teamKey`. Returns a report that mirrors the `--dry-run`
 * preview when `dryRun` is set.
 */
export async function labelsCmd(
  opts: LabelsCmdOptions
): Promise<{ teamKey: string; teamId: string | null; report: LabelReport[] }> {
  const { config, linear, dryRun = false } = opts
  const team = await linear.findTeamByKey(config.linear.teamKey)
  if (!team) {
    throw new Error(
      `loom labels: no Linear team with key "${config.linear.teamKey}" visible to this API key.`
    )
  }
  const existing = await linear.listTeamLabels(team.id)
  const existingSet = new Set(existing.map((l) => l.name))

  const wanted = Array.from(new Set(Object.values(config.labels)))
  const report: LabelReport[] = []
  for (const name of wanted) {
    if (existingSet.has(name)) {
      report.push({ name, action: 'existing' })
      continue
    }
    if (dryRun) {
      report.push({ name, action: 'skipped-dry-run' })
      continue
    }
    await linear.createLabel(name, team.id)
    report.push({ name, action: 'created' })
  }

  return { teamKey: config.linear.teamKey, teamId: team.id, report }
}
