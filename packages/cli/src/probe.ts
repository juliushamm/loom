export type GhClient = {
  listPullRequests(query: string): Promise<PullRequestSummary[]>
  getPullRequestStatus(prNumber: number): Promise<{
    state: 'green' | 'red' | 'running' | 'none'
    mergeable: boolean
  }>
}

export type GitClient = {
  lsRemoteBranches(pattern: string): Promise<string[]>
  listCommitsAhead(branch: string, base: string): Promise<number>
  /**
   * Returns paths from `git diff --name-only <main>...HEAD`. Used by the
   * §5.5 diff-verify gate. `mainBranch` defaults to "main" — callers should
   * pass `cfg.git.mainBranch`.
   */
  diffNamesAgainstMain(mainBranch?: string): Promise<string[]>
}

export type PullRequestSummary = {
  number: number
  author: string
  isDraft: boolean
  headRefName: string
  title: string
}

export type ProbeState =
  | { state: 'fresh' }
  | { state: 'resume-branch'; branchName: string; commitsAhead: number }
  | {
      state: 'continue-pr'
      prNumber: number
      ciState: 'green' | 'red' | 'running' | 'none'
      mergeable: boolean
    }
  | { state: 'merge-ready'; prNumber: number }
  | { state: 'abort-not-ours'; prNumber: number; author: string }
  | { state: 'abort-ci-running'; prNumber: number }

export async function probe({
  issueId,
  ghUser,
  gh,
  git,
  teamKey = 'RIFT',
  mainBranch = 'main'
}: {
  issueId: string
  ghUser: string
  gh: GhClient
  git: GitClient
  teamKey?: string
  mainBranch?: string
}): Promise<ProbeState> {
  const prs = await gh.listPullRequests(`${issueId} in:title,body`)
  const nonDraftOpen = prs.filter((p) => !p.isDraft)

  if (nonDraftOpen.length > 0) {
    const mine = nonDraftOpen.find((p) => p.author === ghUser)
    const theirs = nonDraftOpen.find((p) => p.author !== ghUser)
    if (theirs) return { state: 'abort-not-ours', prNumber: theirs.number, author: theirs.author }

    if (mine) {
      const status = await gh.getPullRequestStatus(mine.number)
      if (status.state === 'running') return { state: 'abort-ci-running', prNumber: mine.number }
      if (status.state === 'green' && status.mergeable)
        return { state: 'merge-ready', prNumber: mine.number }
      return {
        state: 'continue-pr',
        prNumber: mine.number,
        ciState: status.state,
        mergeable: status.mergeable
      }
    }
  }

  const issueNum = extractNum(issueId, teamKey)
  const branches = await git.lsRemoteBranches(`*${teamKey.toLowerCase()}-${issueNum}-*`)
  if (branches.length > 0) {
    const ahead = await git.listCommitsAhead(branches[0], mainBranch)
    if (ahead > 0) return { state: 'resume-branch', branchName: branches[0], commitsAhead: ahead }
  }
  return { state: 'fresh' }
}

function extractNum(issueId: string, teamKey: string): string {
  const rx = new RegExp(`${escapeForRegex(teamKey)}-(\\d+)`, 'i')
  const m = issueId.match(rx)
  if (!m) throw new Error(`probe: issueId "${issueId}" does not match ${teamKey}-\\d+`)
  return m[1]
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
