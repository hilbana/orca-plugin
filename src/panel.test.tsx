// The panel against a simulated worker: list -> detail -> actions.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { IssueDetail, IssueRow } from './protocol'

const row: IssueRow = {
  id: 'i1', identifier: 'DRAPPS-1', title: 'Hello world', state: 'In Progress', stateType: 'started',
  project: 'P', projectId: 'p1', assignee: null, priority: 'high', agentWorking: null, labels: ['bug']
}
const detail = (over: Partial<IssueDetail> = {}): IssueDetail => ({
  ...row, relations: [], description: 'A **description**', stateId: 's1', teamId: 't1', comments: [], ...over
})

test('opens the detail, claims the issue and comments', async () => {
  let current = detail()
  const sent: string[] = []
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': () => current,
      'states.list': () => [{ id: 's1', name: 'In Progress', type: 'started' }, { id: 's2', name: 'Done', type: 'completed' }],
      'issue.claim': () => (current = detail({ agentWorking: 'Daniel' })),
      'issue.comment': ({ body }) => {
        sent.push(body)
        return (current = detail({ comments: [{ id: 'c1', author: 'Daniel', body, createdAt: 0 }] }))
      }
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })
  assert.ok(view.find({ text: 'Claim' }), 'shows Claim when the detail opens')

  await view.press({ text: 'Claim' })
  assert.ok(view.find({ text: 'Release' }), 'once claimed it offers Release')

  await view.type({ label: 'New comment' }, 'first comment')
  await view.press({ text: 'Comment' })
  assert.deepEqual(sent, ['first comment'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('when the Orca workspace changes it selects the project, opens the branch issue and remembers manual picks', async () => {
  const resolved: string[] = []
  const linked: { key: string; projectId: string | null }[] = []
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [{ id: 'p0', name: 'Other' }, { id: 'p1', name: 'P' }],
      'states.list': () => [],
      'issues.list': ({ projectId }) => ({ rows: projectId === 'p1' ? [row] : [], total: projectId === 'p1' ? 1 : 0 }),
      'workspace.resolve': ({ displayName, branch }) => {
        resolved.push(`${displayName}@${branch}`)
        if (branch.startsWith('drapps-1-')) return { key: displayName, workspaceId: null, projectId: 'p1', source: 'branch', issue: { id: 'i1', identifier: 'DRAPPS-1' } }
        if (displayName === 'p.com') return { key: displayName, workspaceId: null, projectId: 'p1', source: 'name', issue: null }
        return { key: displayName, workspaceId: null, projectId: null, source: null, issue: null }
      },
      'workspace.link': (input) => { linked.push(input); return { ok: true } },
      'issue.get': () => detail()
    }
  })
  const view = await mount(panel, { host })
  await view.settled()

  // Nothing to infer (no issue branch, no link, no name match): nothing moves.
  await view.emit('workspace.changed', { context: { branch: 'main', displayName: 'my-repo', terminals: [] } })
  await view.settled()
  assert.equal(view.find({ text: 'Claim' }), null)

  // A folder workspace with no branch is matched by name: project selected, no issue opened.
  await view.emit('workspace.changed', { context: { branch: '', displayName: 'p.com', terminals: [] } })
  await view.settled()
  assert.equal(view.find({ text: 'Claim' }), null)
  assert.ok(view.find({ label: 'DRAPPS-1 Hello world' }), 'the list now shows project P')
  assert.ok(view.find({ text: /Matched by name/ }))

  // Picking a project by hand in a workspace remembers it for that workspace.
  await view.select({ label: 'Project' }, 'p0')
  assert.deepEqual(linked, [{ key: 'p.com', projectId: 'p0', workspaceId: 'w' }])

  // An issue branch opens the issue.
  await view.emit('workspace.changed', { context: { branch: 'drapps-1-hola-mundo', displayName: 'x', terminals: [] } })
  await view.settled()
  assert.ok(view.find({ text: 'Claim' }), 'opens the detail of DRAPPS-1')
  assert.deepEqual(resolved, ['my-repo@main', 'p.com@', 'x@drapps-1-hola-mundo'])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('comments show newest first, with the form above them', async () => {
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': () => detail({
        comments: [
          { id: 'c1', author: 'A', body: 'FIRST', createdAt: '2026-01-01T10:00:00Z' },
          { id: 'c3', author: 'A', body: 'THIRD', createdAt: '2026-03-01T10:00:00Z' },
          { id: 'c2', author: 'A', body: 'SECOND', createdAt: '2026-02-01T10:00:00Z' }
        ]
      })
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })
  const dump = JSON.stringify(view.tree())
  const at = (t: string) => dump.indexOf(t)
  assert.ok(at('New comment') < at('THIRD'), 'the form sits above the comments')
  assert.ok(at('THIRD') < at('SECOND') && at('SECOND') < at('FIRST'), 'the latest comment comes first')
  await view.unmount()
})

test('travels to mentioned and related issues, and returns the same way', async () => {
  const issues: Record<string, IssueDetail> = {
    i1: detail({ description: 'See DRAPPS-2 and 3. Also UTF-8.', relations: [{ type: 'blocks', issueId: 'i4', identifier: 'DRAPPS-4', title: 'Blocked one', state: 'Todo' }] }),
    i2: { ...detail({ description: 'otra' }), id: 'i2', identifier: 'DRAPPS-2', title: 'Segunda' },
    i4: { ...detail({ description: 'cuarta' }), id: 'i4', identifier: 'DRAPPS-4', title: 'Blocked one' }
  }
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': ({ id }) => issues[id]!,
      // Only DRAPPS-2 and DRAPPS-3 exist; UTF-8 is dropped.
      'issues.resolve': ({ identifiers }) =>
        identifiers.filter((i) => i === 'DRAPPS-2' || i === 'DRAPPS-3').map((i) => ({ id: i === 'DRAPPS-2' ? 'i2' : 'i3', identifier: i, title: `T${i}`, state: 'Todo' }))
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })
  assert.ok(view.find({ label: 'DRAPPS-2 TDRAPPS-2' }), 'DRAPPS-2 is mentioned')
  assert.ok(view.find({ label: 'DRAPPS-3 TDRAPPS-3' }), 'so is the bare number after "and"')
  assert.equal(view.find({ label: /UTF/ }), null, 'anything that is not a real issue is not linked')
  assert.ok(view.find({ label: /Blocks · DRAPPS-4/ }), 'a Hilbana relation')

  await view.press({ label: 'DRAPPS-2 TDRAPPS-2' })
  assert.ok(view.find({ text: 'DRAPPS-2' }), 'opened DRAPPS-2')
  await view.press({ label: 'Back' })
  assert.ok(view.find({ label: 'DRAPPS-2 TDRAPPS-2' }), 'back returns to DRAPPS-1, where the link was')
  await view.press({ label: 'Back' })
  assert.ok(view.find({ label: 'DRAPPS-1 Hello world' }), 'and the second back reaches the list')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('the Run in agent button targets an idle agent and is disabled while it works', async () => {
  let state: 'waiting' | 'working' = 'waiting'
  const sent: { terminalId: string; identifier: string }[] = []
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': () => detail(),
      'agents.list': () => [{ terminalId: 't1', title: 'agent-1', agent: 'agent-1', state }],
      'agent.send': (input) => {
        sent.push(input)
        return { sent: `/hilbana:trabajar-issue ${input.identifier}` }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })
  assert.equal(view.find({ text: 'Run in agent' })?.disabled, false)

  await view.press({ text: 'Run in agent' })
  assert.deepEqual(sent, [{ terminalId: 't1', identifier: 'DRAPPS-1' }])
  assert.ok(view.find({ text: /Sent to the agent: \/hilbana:trabajar-issue DRAPPS-1/ }), 'confirms what was sent')

  // The agent starts working: the status event refreshes the list and the button locks.
  state = 'working'
  await view.emit('agent.status.changed', { workspaceId: 'w', paneKey: 'p', terminalId: 't1', state: 'working', receivedAt: 0 })
  await view.settled()
  assert.equal(view.find({ text: 'Run in agent' })?.disabled, true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('without an agent the button is still visible, disabled, with the reason', async () => {
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': () => detail(),
      'agents.list': () => []
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })
  assert.equal(view.find({ text: 'Run in agent' })?.disabled, true)
  assert.ok(view.find({ text: /No agent detected/ }))
  await view.unmount()
})

test('remembers the Hilbana workspace per Orca workspace, and switches to it when you come back', async () => {
  const issuesCalls: { workspaceId?: string; projectId?: string }[] = []
  const projectsCalls: (string | undefined)[] = []
  const linked: { key: string; projectId: string | null; workspaceId?: string | null }[] = []
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w1', name: 'First', default: true }, { id: 'w2', name: 'Second', default: false }],
      'projects.list': ({ workspaceId }) => {
        projectsCalls.push(workspaceId)
        return workspaceId === 'w2' ? [{ id: 'q1', name: 'Q' }] : [{ id: 'p1', name: 'P' }]
      },
      'states.list': () => [],
      'issues.list': (input) => { issuesCalls.push({ workspaceId: input.workspaceId, projectId: input.projectId }); return { rows: [], total: 0 } },
      'workspace.resolve': ({ displayName }) =>
        displayName === 'linked.com'
          ? { key: 'linked.com', workspaceId: 'w2', projectId: 'q1', source: 'link', issue: null }
          : { key: displayName, workspaceId: null, projectId: null, source: null, issue: null },
      'workspace.link': (input) => { linked.push(input); return { ok: true } }
    }
  })
  const view = await mount(panel, { host })
  await view.settled()

  // Coming back to a workspace linked to the other Hilbana workspace switches to it and its project.
  await view.emit('workspace.changed', { context: { branch: '', displayName: 'linked.com', terminals: [] } })
  await view.settled()
  assert.ok(projectsCalls.includes('w2'), 'loaded the projects of the remembered workspace')
  assert.deepEqual(issuesCalls.at(-1), { workspaceId: 'w2', projectId: 'q1' })

  // Switching the Hilbana workspace by hand is remembered for the Orca workspace.
  await view.select({ label: 'Workspace' }, 'w1')
  await view.settled()
  assert.deepEqual(linked.at(-1), { key: 'linked.com', projectId: null, workspaceId: 'w1' })
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
