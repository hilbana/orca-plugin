// `orca plugin check` renders the panel once per scenario, each with the worker replaced by this
// invented data. `orca plugin shot . --scenario <name>` uses the same scenarios, which is how the
// README screenshots are made: nothing here comes from a real Hilbana account.
import { defineCheck } from 'orca/testing'
import type { IssueDetail, IssueRow } from './protocol'

const row = (n: number, title: string, project: string, projectId: string, state: string, assignee: string | null, agentWorking: string | null = null): IssueRow => ({
  id: `i-${n}`, identifier: `ACME-${n}`, title, state, stateType: 'started', project, projectId,
  assignee, priority: 'medium', agentWorking, labels: []
})

const rows = [
  row(142, 'Fix the checkout redirect on Safari', 'Acme Web', 'p-web', 'In Progress', 'Alex'),
  row(138, 'Add dark mode to the settings page', 'Acme Web', 'p-web', 'In Review', 'Sam', 'agent-1'),
  row(151, 'Rate-limit the public search endpoint', 'Platform API', 'p-api', 'In Progress', null),
  row(147, 'Onboarding emails land in spam', 'Acme Web', 'p-web', 'In Progress', 'Alex'),
  row(133, 'Crash when opening a deleted invoice', 'Acme Mobile', 'p-mobile', 'In Review', 'Sam'),
  row(129, 'Migrate the image uploads to the new bucket', 'Platform API', 'p-api', 'In Progress', null)
]

const detail: IssueDetail = {
  ...rows[0]!,
  teamId: 't-acme',
  stateId: 's-progress',
  labels: ['bug', 'checkout'],
  relations: [{ type: 'blocks', issueId: 'i-151', identifier: 'ACME-151', title: 'Rate-limit the public search endpoint', state: 'In Progress' }],
  description:
    'Safari drops the `redirect_uri` query string when the payment provider sends the customer back, so the order stays in **pending**.\n\n' +
    '1. Pay with a test card in Safari 17\n2. Wait for the redirect\n3. The order page shows no confirmation\n\nProbably related to ACME-138 and 147.',
  comments: [
    { id: 'c1', author: 'Alex', body: 'Reproduced on Safari 17.4. Chrome and Firefox are fine.', createdAt: '2026-11-09T09:12:00Z' },
    { id: 'c2', author: 'Sam', body: 'The provider docs say the redirect keeps its query string, so this looks like our own router.', createdAt: '2026-11-09T11:40:00Z' }
  ]
}

const common = {
  'auth.status': { connected: true, url: 'https://app.hilbana.com/mcp', protection: 'os-keyring' as const },
  'locale.set': { ok: true as const },
  'workspaces.list': [{ id: 'w1', name: 'Acme', default: true }],
  'projects.list': [{ id: 'p-web', name: 'Acme Web' }, { id: 'p-mobile', name: 'Acme Mobile' }, { id: 'p-api', name: 'Platform API' }],
  'states.list': [
    { id: 's-backlog', name: 'Backlog', type: 'backlog' }, { id: 's-todo', name: 'Todo', type: 'unstarted' },
    { id: 's-progress', name: 'In Progress', type: 'started' }, { id: 's-review', name: 'In Review', type: 'started' },
    { id: 's-done', name: 'Done', type: 'completed' }
  ],
  'issues.list': { rows, total: rows.length },
  'agents.list': [{ terminalId: 't1', title: null, agent: 'agent', state: 'waiting' as const }],
  'workspace.link': { ok: true as const }
}

export default defineCheck({
  connect: { requests: { ...common, 'auth.status': { connected: false, url: 'https://app.hilbana.com/mcp', protection: 'os-keyring' as const } } },
  list: { requests: common },
  // The branch names ACME-142, so following the Orca workspace opens that issue.
  detail: {
    requests: {
      ...common,
      'workspace.resolve': { key: 'acme-web', workspaceId: null, projectId: 'p-web', source: 'branch' as const, issue: { id: 'i-142', identifier: 'ACME-142' } },
      'issue.get': detail,
      'issues.resolve': [
        { id: 'i-138', identifier: 'ACME-138', title: 'Add dark mode to the settings page', state: 'In Review' },
        { id: 'i-147', identifier: 'ACME-147', title: 'Onboarding emails land in spam', state: 'In Progress' }
      ]
    },
    events: [{ event: 'workspace.changed', payload: { context: { branch: 'acme-142-checkout-redirect', displayName: 'acme-web', terminals: [] } } }]
  }
})
