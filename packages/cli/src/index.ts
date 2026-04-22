export const PACKAGE = '@juliushamm/loom' as const
export { acquireLock, releaseLock, reclaimIfStale, DEFAULT_LOCK_DIR } from './lock.js'
export * from './runtime-config.js'
export * from './halt.js'
export * from './hooks/predicates.js'
export * from './linear.js'
export * from './probe.js'
export * from './audit.js'
export * from './config/load.js'
