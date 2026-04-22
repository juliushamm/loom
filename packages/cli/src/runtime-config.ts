// Pipeline timing and gate-profile constants. These are runtime knobs for the
// polling loops — distinct from the per-project file config in src/config/load.ts.

export const DISPATCH_POLL_INTERVAL_MS = 30_000
export const CI_POLL_INTERVAL_MS = 60_000
export const DISPATCH_REVIEW_TIMEOUT_MS = 86_400_000 // 24h
export const MERGE_REVIEW_TIMEOUT_MS = 86_400_000 // 24h
export const LABEL_STALE_TTL_MS = 14_400_000 // 4h — heartbeat-refreshed

export type ProfileName = 'aggressive' | 'balanced' | 'paranoid' | 'balanced+paranoid-step-3'

export const PROFILE_NAMES: readonly ProfileName[] = [
  'aggressive',
  'balanced',
  'paranoid',
  'balanced+paranoid-step-3'
] as const

export type GateConfig = {
  name: ProfileName
  dispatchReviewGate: boolean
  mergeGate: boolean
}

const PROFILES: Record<ProfileName, Omit<GateConfig, 'name'>> = {
  aggressive: { dispatchReviewGate: false, mergeGate: false },
  balanced: { dispatchReviewGate: false, mergeGate: true },
  paranoid: { dispatchReviewGate: true, mergeGate: true },
  'balanced+paranoid-step-3': { dispatchReviewGate: true, mergeGate: true }
}

export function resolveProfile(name?: string): GateConfig {
  const resolved = name ?? 'balanced+paranoid-step-3'
  if (!isProfileName(resolved)) {
    throw new Error(`Unknown profile "${resolved}". Valid: ${PROFILE_NAMES.join(', ')}`)
  }
  return { name: resolved, ...PROFILES[resolved] }
}

function isProfileName(value: string): value is ProfileName {
  return (PROFILE_NAMES as readonly string[]).includes(value)
}
