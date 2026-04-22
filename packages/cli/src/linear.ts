export type LinearClient = {
  listLabels(issueId: string): Promise<string[]>
  addLabel(issueId: string, label: string): Promise<void>
  removeLabel(issueId: string, label: string): Promise<void>
  postComment(issueId: string, body: string): Promise<void>
  listComments(issueId: string): Promise<Array<{ id: string; body: string; createdAt: string }>>
}

export async function applyInflightLock(
  client: LinearClient,
  issueId: string,
  now: Date = new Date(),
  inflightLabel = 'automation:in-flight'
): Promise<void> {
  await client.addLabel(issueId, inflightLabel)
  await client.postComment(issueId, `🟡 ${inflightLabel} — heartbeat ${now.toISOString()}`)
}

export async function refreshInflightHeartbeat(
  client: LinearClient,
  issueId: string,
  now: Date = new Date()
): Promise<void> {
  await client.postComment(issueId, `🟡 automation:heartbeat — ${now.toISOString()}`)
}

export async function releaseInflightLock(
  client: LinearClient,
  issueId: string,
  inflightLabel = 'automation:in-flight'
): Promise<void> {
  await client.removeLabel(issueId, inflightLabel)
}

export async function isLockStale(
  client: LinearClient,
  issueId: string,
  ttlMs: number,
  now: Date = new Date()
): Promise<boolean> {
  const comments = await client.listComments(issueId)
  const heartbeats = comments.filter(
    (c) => c.body.includes('automation:heartbeat') || c.body.includes('automation:in-flight')
  )
  if (heartbeats.length === 0) return true
  const latest = heartbeats.reduce((a, b) =>
    new Date(a.createdAt).getTime() >= new Date(b.createdAt).getTime() ? a : b
  )
  const age = now.getTime() - new Date(latest.createdAt).getTime()
  return age > ttlMs
}
