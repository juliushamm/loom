import type { LinearClient } from '../index.js'

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

export type LinearTeamSummary = { id: string; key: string; name: string }
export type LinearLabelSummary = { id: string; name: string; color?: string }

/**
 * Extended Linear client. `LinearClient` (in ../linear.ts) is the narrow
 * interface used by the pipeline commands. This extended client exposes the
 * extra surface that `loom labels` and `loom doctor` need.
 */
export type ExtendedLinearClient = LinearClient & {
  listTeams(): Promise<LinearTeamSummary[]>
  findTeamByKey(teamKey: string): Promise<LinearTeamSummary | null>
  listTeamLabels(teamId: string): Promise<LinearLabelSummary[]>
  findLabel(name: string, teamId: string): Promise<LinearLabelSummary | null>
  createLabel(
    name: string,
    teamId: string,
    opts?: { color?: string; description?: string }
  ): Promise<LinearLabelSummary>
}

export function linearApiClient(apiKey = process.env.LINEAR_API_KEY): ExtendedLinearClient {
  if (!apiKey) throw new Error('LINEAR_API_KEY env is required for linearApiClient')
  const auth = apiKey
  return {
    async listLabels(issueId) {
      const data = await gql(auth, ISSUE_LABELS_QUERY, { id: issueId })
      return (
        (data.issue as { labels: { nodes: Array<{ name: string }> } } | null)?.labels?.nodes?.map(
          (n: { name: string }) => n.name
        ) ?? []
      )
    },
    async addLabel(issueId, label) {
      const labelId = await findLabelIdByName(auth, issueId, label)
      await gql(auth, ADD_LABEL_MUTATION, { id: issueId, labelIds: [labelId] })
    },
    async removeLabel(issueId, label) {
      const labelId = await findLabelIdByName(auth, issueId, label)
      await gql(auth, REMOVE_LABEL_MUTATION, { id: issueId, labelIds: [labelId] })
    },
    async postComment(issueId, body) {
      await gql(auth, CREATE_COMMENT_MUTATION, { input: { issueId, body } })
    },
    async listComments(issueId) {
      const data = await gql(auth, COMMENTS_QUERY, { id: issueId })
      return (
        (
          data.issue as {
            comments: { nodes: Array<{ id: string; body: string; createdAt: string }> }
          } | null
        )?.comments?.nodes ?? []
      ).map((n: { id: string; body: string; createdAt: string }) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt
      }))
    },
    async listTeams() {
      const data = await gql(auth, TEAMS_QUERY, {})
      const teams = (data.teams as { nodes: LinearTeamSummary[] } | null)?.nodes ?? []
      return teams.map((t) => ({ id: t.id, key: t.key, name: t.name }))
    },
    async findTeamByKey(teamKey) {
      const teams = await this.listTeams()
      return teams.find((t) => t.key === teamKey) ?? null
    },
    async listTeamLabels(teamId) {
      const data = await gql(auth, TEAM_LABELS_QUERY, { id: teamId })
      return (
        (data.team as { labels: { nodes: LinearLabelSummary[] } } | null)?.labels?.nodes ?? []
      ).map((n) => ({ id: n.id, name: n.name, color: n.color }))
    },
    async findLabel(name, teamId) {
      const labels = await this.listTeamLabels(teamId)
      return labels.find((l) => l.name === name) ?? null
    },
    async createLabel(name, teamId, opts) {
      const input: Record<string, unknown> = { name, teamId }
      if (opts?.color) input.color = opts.color
      if (opts?.description) input.description = opts.description
      const data = await gql(auth, CREATE_LABEL_MUTATION, { input })
      const created = (
        data.issueLabelCreate as { issueLabel: LinearLabelSummary } | null
      )?.issueLabel
      if (!created) throw new Error(`Linear: createLabel(${name}) returned no issueLabel`)
      return { id: created.id, name: created.name, color: created.color }
    }
  }
}

async function gql(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey
    },
    body: JSON.stringify({ query, variables })
  })
  if (!res.ok) throw new Error(`Linear API ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown }
  if (json.errors) throw new Error(`Linear GraphQL errors: ${JSON.stringify(json.errors)}`)
  return json.data ?? {}
}

async function findLabelIdByName(
  apiKey: string,
  issueId: string,
  labelName: string
): Promise<string> {
  const data = await gql(apiKey, ISSUE_TEAM_LABELS_QUERY, { id: issueId })
  const issue = data.issue as { team: { labels: { nodes: Array<{ id: string; name: string }> } } }
  const found = issue.team.labels.nodes.find((l) => l.name === labelName)
  if (!found) throw new Error(`Linear label "${labelName}" does not exist on team`)
  return found.id
}

const ISSUE_LABELS_QUERY = `query ($id: String!) { issue(id: $id) { labels { nodes { name } } } }`
const ISSUE_TEAM_LABELS_QUERY = `query ($id: String!) { issue(id: $id) { team { labels(first: 250) { nodes { id name } } } } }`
const COMMENTS_QUERY = `query ($id: String!) { issue(id: $id) { comments(first: 250, orderBy: createdAt) { nodes { id body createdAt } } } }`
const ADD_LABEL_MUTATION = `mutation ($id: String!, $labelIds: [String!]!) { issueAddLabel(id: $id, labelIds: $labelIds) { success } }`
const REMOVE_LABEL_MUTATION = `mutation ($id: String!, $labelIds: [String!]!) { issueRemoveLabel(id: $id, labelIds: $labelIds) { success } }`
const CREATE_COMMENT_MUTATION = `mutation ($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`
const TEAMS_QUERY = `query { teams(first: 100) { nodes { id key name } } }`
const TEAM_LABELS_QUERY = `query ($id: String!) { team(id: $id) { labels(first: 250) { nodes { id name color } } } }`
const CREATE_LABEL_MUTATION = `mutation ($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id name color } } }`
