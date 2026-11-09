// The panel against a simulated worker: list -> detail -> actions.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { IssueDetail, IssueRow } from './protocol'

const row: IssueRow = {
  id: 'i1', identifier: 'DRAPPS-1', title: 'Hello world', state: 'In Progress', stateTone: 'success', stateType: 'started',
  project: 'P', projectId: 'p1', assignee: null, priority: 'high', agentWorking: null, labels: ['bug']
}
const detail = (over: Partial<IssueDetail> = {}): IssueDetail => ({
  ...row, subIssues: [], relations: [], description: 'A **description**', stateId: 's1', teamId: 't1', comments: [], ...over
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

test('the panel follows Orca\'s language and tells the worker', async () => {
  const locales: string[] = []
  const requests = {
    'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
    'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
    'projects.list': () => [],
    'states.list': () => [],
    'issues.list': () => ({ rows: [row], total: 1 }),
    'issue.get': () => detail({ comments: [{ id: 'c1', author: null, body: 'hi', createdAt: '2026-01-01T10:00:00Z' }] }),
    'agents.list': () => [{ terminalId: 't1', title: null, agent: null, state: 'working' as const }],
    'locale.set': ({ locale }: { locale: string }) => { locales.push(locale); return { ok: true as const } }
  }

  // Spanish
  const es = await mount(panel, { host: mockHost({ requests }), locale: 'es-ES' })
  await es.settled()
  assert.ok(es.find({ label: 'Buscar' }), 'the search box is in Spanish')
  assert.ok(es.find({ label: 'Seguir el workspace de Orca' }), 'so is the follow switch')
  await es.press({ label: 'DRAPPS-1 Hello world' })
  assert.ok(es.find({ text: 'Tomar' }), 'Claim becomes Tomar')
  assert.ok(es.find({ text: 'Ejecutar en el agente' }), 'Run in agent becomes Ejecutar en el agente')
  assert.ok(es.find({ text: /El agente está trabajando/ }), 'agent states are translated too')
  assert.ok(es.find({ label: 'Sistema' }), 'a comment without an author says Sistema')
  assert.equal(es.find({ text: /Description|Claim|Comments/ }), null, 'no English is left in the detail view')
  await es.unmount()

  // English again (the default, and any non-Spanish locale)
  const en = await mount(panel, { host: mockHost({ requests }), locale: 'fr-FR' })
  await en.settled()
  await en.press({ label: 'DRAPPS-1 Hello world' })
  assert.ok(en.find({ text: 'Claim' }), 'other languages fall back to English')
  await en.unmount()

  assert.deepEqual(locales, ['es-ES', 'fr-FR'])
})

test('lists the sub-issues, jumps to one and comes back', async () => {
  const issues: Record<string, IssueDetail> = {
    i1: detail({
      description: 'Parent of two, and it mentions DRAPPS-5.',
      subIssues: [
        { id: 'i5', identifier: 'DRAPPS-5', title: 'First child', state: 'Done' },
        { id: 'i6', identifier: 'DRAPPS-6', title: 'Second child', state: 'Todo' }
      ]
    }),
    i5: { ...detail(), id: 'i5', identifier: 'DRAPPS-5', title: 'First child' }
  }
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': ({ id }) => issues[id]!,
      // DRAPPS-5 is both a child and mentioned in the text: it must only be listed once.
      'issues.resolve': () => [{ id: 'i5', identifier: 'DRAPPS-5', title: 'First child', state: 'Done' }]
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })

  assert.ok(view.find({ text: /Sub-issues/ }), 'the section is there')
  assert.ok(view.find({ label: 'DRAPPS-5 First child' }), 'the first child is listed')
  assert.ok(view.find({ label: 'DRAPPS-6 Second child' }), 'so is the second')
  assert.equal(view.findAll({ label: 'DRAPPS-5 First child' }).length, 1, 'a child that is also mentioned is not listed twice')
  assert.equal(view.find({ text: /Mentioned/ }), null, 'and the Mentioned section is not shown for it')

  await view.press({ label: 'DRAPPS-5 First child' })
  assert.ok(view.find({ text: 'DRAPPS-5' }), 'opened the child')
  await view.press({ label: 'Back' })
  assert.ok(view.find({ label: 'DRAPPS-6 Second child' }), 'back returns to the parent')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('an issue with no sub-issues shows no section', async () => {
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': () => detail()
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })
  assert.equal(view.find({ text: /Sub-issues/ }), null)
  await view.unmount()
})

test('the Spanish panel calls them Subtareas', async () => {
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [row], total: 1 }),
      'issue.get': () => detail({ subIssues: [{ id: 'i5', identifier: 'DRAPPS-5', title: 'Hija', state: 'Todo' }] })
    }
  })
  const view = await mount(panel, { host, locale: 'es' })
  await view.settled()
  await view.press({ label: 'DRAPPS-1 Hello world' })
  assert.ok(view.find({ text: /Subtareas/ }))
  await view.unmount()
})

test('every state is a badge in the tone of its Hilbana colour, in the list and in the detail', async () => {
  const red = { ...row, id: 'a', identifier: 'ACME-1', title: 'Red one', state: 'Backlog', stateTone: 'danger' as const }
  const green = { ...row, id: 'b', identifier: 'ACME-2', title: 'Green one', state: 'In Progress', stateTone: 'success' as const }
  const host = mockHost({
    requests: {
      'auth.status': () => ({ connected: true, url: 'https://x/mcp', protection: 'os-keyring' }),
      'workspaces.list': () => [{ id: 'w', name: 'WS', default: true }],
      'projects.list': () => [],
      'states.list': () => [],
      'issues.list': () => ({ rows: [red, green], total: 2 }),
      'issue.get': () => detail({
        ...red,
        subIssues: [{ id: 'c', identifier: 'ACME-3', title: 'Child', state: 'Done', stateTone: 'accent' }],
        relations: [{ type: 'blocks', issueId: 'd', identifier: 'ACME-4', title: 'Blocked', state: 'Canceled', stateTone: 'neutral' }]
      })
    }
  })
  const view = await mount(panel, { host })
  await view.settled()
  const tone = (text: string) => view.findAll({ type: 'Badge', text }).map((b) => b.props.tone)
  assert.deepEqual(tone('Backlog'), ['danger'], 'the list badge uses the state colour')
  assert.deepEqual(tone('In Progress'), ['success'])

  await view.press({ label: 'ACME-1 Red one' })
  assert.deepEqual(tone('Backlog'), ['danger'], 'so does the detail header')
  assert.deepEqual(tone('Done'), ['accent'], 'a sub-issue keeps its own colour')
  assert.deepEqual(tone('Canceled'), ['neutral'], 'and a related one')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
