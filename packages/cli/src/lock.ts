import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { join } from 'node:path'

type AcquireInput = { issueId: string; dir: string }
type AcquireResult = { ok: true } | { ok: false; reason: string }

export function acquireLock({ issueId, dir }: AcquireInput): AcquireResult {
  mkdirSync(dir, { recursive: true })
  const path = lockPath(dir, issueId)
  if (existsSync(path)) {
    const body = readBody(path)
    if (body && isLive(body.pid)) {
      return { ok: false, reason: `lock held by PID ${body.pid} on ${body.hostname}` }
    }
    // Stale — reclaim by overwrite below
  }
  writeFileSync(
    path,
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: hostname()
    })
  )
  return { ok: true }
}

export function reclaimIfStale({ issueId, dir }: AcquireInput): { reclaimed: boolean } {
  const path = lockPath(dir, issueId)
  if (!existsSync(path)) return { reclaimed: false }
  const body = readBody(path)
  if (!body || isLive(body.pid)) return { reclaimed: false }
  unlinkSync(path)
  return { reclaimed: true }
}

export function releaseLock({ issueId, dir }: AcquireInput): void {
  const path = lockPath(dir, issueId)
  if (existsSync(path)) unlinkSync(path)
}

function lockPath(dir: string, issueId: string): string {
  return join(dir, `${issueId}.lock`)
}

function readBody(path: string): { pid: number; startedAt: string; hostname: string } | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function isLive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const DEFAULT_LOCK_DIR = join(process.env.HOME ?? homedir() ?? '/tmp', '.loom', 'locks')
