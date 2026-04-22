import { describe, it, expect } from 'vitest'
import { probe, type GhClient, type GitClient, type PullRequestSummary } from '../src/probe'

function mockGh(overrides: Partial<GhClient> = {}): GhClient {
  return {
    async listPullRequests() {
      return []
    },
    async getPullRequestStatus() {
      return { state: 'none', mergeable: false }
    },
    ...overrides
  }
}

function mockGit(overrides: Partial<GitClient> = {}): GitClient {
  return {
    async lsRemoteBranches() {
      return []
    },
    async listCommitsAhead() {
      return 0
    },
    ...overrides
  }
}

const pr = (over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 1,
  author: 'juliushamm',
  isDraft: false,
  headRefName: 'feat/x',
  title: 'x',
  ...over
})

const TEAM_KEY = 'TEST'

describe('probe — state machine', () => {
  it('fresh when no PRs and no branches', async () => {
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh: mockGh(),
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    expect(r.state).toBe('fresh')
  })

  it('resume-branch when remote has a matching branch with commits ahead', async () => {
    const git = mockGit({
      async lsRemoteBranches() {
        return ['feat/test-1-foo']
      },
      async listCommitsAhead() {
        return 3
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh: mockGh(),
      git,
      teamKey: TEAM_KEY
    })
    if (r.state !== 'resume-branch') throw new Error(`expected resume-branch, got ${r.state}`)
    expect(r.branchName).toBe('feat/test-1-foo')
    expect(r.commitsAhead).toBe(3)
  })

  it('fresh when remote branch exists but has 0 commits ahead of main', async () => {
    const git = mockGit({
      async lsRemoteBranches() {
        return ['feat/test-1-foo']
      },
      async listCommitsAhead() {
        return 0
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh: mockGh(),
      git,
      teamKey: TEAM_KEY
    })
    expect(r.state).toBe('fresh')
  })

  it('abort-not-ours when an open non-draft PR is authored by someone else', async () => {
    const gh = mockGh({
      async listPullRequests() {
        return [pr({ number: 42, author: 'someone-else' })]
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    if (r.state !== 'abort-not-ours') throw new Error(`expected abort-not-ours, got ${r.state}`)
    expect(r.prNumber).toBe(42)
    expect(r.author).toBe('someone-else')
  })

  it('continue-pr when my PR is open with CI red', async () => {
    const gh = mockGh({
      async listPullRequests() {
        return [pr({ number: 7 })]
      },
      async getPullRequestStatus() {
        return { state: 'red', mergeable: true }
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    if (r.state !== 'continue-pr') throw new Error(`expected continue-pr, got ${r.state}`)
    expect(r.prNumber).toBe(7)
    expect(r.ciState).toBe('red')
    expect(r.mergeable).toBe(true)
  })

  it('abort-ci-running when my PR is open with CI running', async () => {
    const gh = mockGh({
      async listPullRequests() {
        return [pr({ number: 8 })]
      },
      async getPullRequestStatus() {
        return { state: 'running', mergeable: false }
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    if (r.state !== 'abort-ci-running') throw new Error(`expected abort-ci-running, got ${r.state}`)
    expect(r.prNumber).toBe(8)
  })

  it('merge-ready when my PR is green and mergeable', async () => {
    const gh = mockGh({
      async listPullRequests() {
        return [pr({ number: 9 })]
      },
      async getPullRequestStatus() {
        return { state: 'green', mergeable: true }
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    if (r.state !== 'merge-ready') throw new Error(`expected merge-ready, got ${r.state}`)
    expect(r.prNumber).toBe(9)
  })

  it('continue-pr (not merge-ready) when green but not mergeable', async () => {
    const gh = mockGh({
      async listPullRequests() {
        return [pr({ number: 10 })]
      },
      async getPullRequestStatus() {
        return { state: 'green', mergeable: false }
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    if (r.state !== 'continue-pr') throw new Error(`expected continue-pr, got ${r.state}`)
    expect(r.mergeable).toBe(false)
  })

  it('draft PRs are ignored by the state machine', async () => {
    const gh = mockGh({
      async listPullRequests() {
        return [pr({ number: 11, isDraft: true })]
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    expect(r.state).toBe('fresh')
  })

  it('issueId number is extracted case-insensitively into the branch pattern', async () => {
    const seen: string[] = []
    const git = mockGit({
      async lsRemoteBranches(pattern) {
        seen.push(pattern)
        return []
      }
    })
    await probe({
      issueId: 'test-18',
      ghUser: 'juliushamm',
      gh: mockGh(),
      git,
      teamKey: TEAM_KEY
    })
    expect(seen).toEqual(['*test-18-*'])
  })

  it('passes issueId-scoped query to listPullRequests', async () => {
    const seen: string[] = []
    const gh = mockGh({
      async listPullRequests(q) {
        seen.push(q)
        return []
      }
    })
    await probe({
      issueId: 'TEST-7',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    expect(seen).toEqual(['TEST-7 in:title,body'])
  })

  it('throws on malformed issueId (mismatched teamKey)', async () => {
    await expect(
      probe({
        issueId: 'FOO-5',
        ghUser: 'juliushamm',
        gh: mockGh(),
        git: mockGit(),
        teamKey: TEAM_KEY
      })
    ).rejects.toThrow(/does not match TEST/)
  })

  it('respects a different teamKey (ENG)', async () => {
    const seen: string[] = []
    const git = mockGit({
      async lsRemoteBranches(pattern) {
        seen.push(pattern)
        return []
      }
    })
    await probe({
      issueId: 'ENG-42',
      ghUser: 'juliushamm',
      gh: mockGh(),
      git,
      teamKey: 'ENG'
    })
    expect(seen).toEqual(['*eng-42-*'])
  })

  it('abort-not-ours when both mine and theirs exist (theirs wins)', async () => {
    const gh = mockGh({
      async listPullRequests() {
        return [
          pr({ number: 50, author: 'juliushamm' }),
          pr({ number: 51, author: 'someone-else' })
        ]
      }
    })
    const r = await probe({
      issueId: 'TEST-1',
      ghUser: 'juliushamm',
      gh,
      git: mockGit(),
      teamKey: TEAM_KEY
    })
    if (r.state !== 'abort-not-ours') throw new Error(`expected abort-not-ours, got ${r.state}`)
    expect(r.prNumber).toBe(51)
    expect(r.author).toBe('someone-else')
  })
})
