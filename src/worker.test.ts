// Runs activate(orca) with a simulated host and a fake fetch: no real network or key.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'
import { validateKey, validateUrl } from './hilbana'
import { extractRefs } from './match'
import { toneFor, toneForType } from './tone'
import { setLang, t as translate } from './i18n'

const rpc = (payload: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }), {
    headers: { 'content-type': 'application/json' }
  })

function fakeFetch(handler: (tool: string, init: RequestInit) => Response) {
  const calls: { tool: string; auth: string | null }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const auth = new Headers(init.headers).get('authorization')
    calls.push({ tool: body.params.name, auth })
    return handler(body.params.name, init)
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('validates URL and key', () => {
  assert.throws(() => validateUrl('http://evil.example/mcp'))
  validateUrl('http://localhost:3003/mcp')
  validateUrl('https://app.hilbana.com/mcp')
  assert.throws(() => validateKey('no-es-una-key'))
  assert.equal(validateKey('  hil_abcdefgh1234 '), 'hil_abcdefgh1234')
})

test('a rejected key is not saved', async () => {
  const net = fakeFetch(() => new Response('no', { status: 401 }))
  const host = mockHost({})
  const worker = await mountWorker(main, { host })
  await assert.rejects(() => worker.request('auth.save', { key: 'hil_abcdefgh1234' }))
  assert.equal((await worker.request('auth.status')).connected, false)
  net.restore()
  await worker.deactivate()
})

test('saves the key after validating it and lists issues with Bearer', async () => {
  const net = fakeFetch((tool) =>
    tool === 'list_workspaces'
      ? rpc([{ id: 'w1', name: 'WS', slug: 'ws', role: 'owner', default: true }])
      : rpc([{ id: 'i1', identifier: 'DRAPPS-1', title: 'Hola', state: 'En curso', stateType: 'started', project: 'P', assignee: null, priority: 2, agentWorking: null, labels: [{ id: 'l', name: 'bug', color: '#f00' }] }])
  )
  const host = mockHost({})
  const worker = await mountWorker(main, { host })
  const saved = await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
  assert.equal(saved.workspaces, 1)
  assert.deepEqual((await worker.request('auth.status')).accounts, [{ id: saved.accountId, name: 'WS' }])
  const issues = await worker.request('issues.list', { scope: 'started' })
  assert.equal(issues.total, 1)
  assert.equal(issues.rows[0]?.identifier, 'DRAPPS-1')
  assert.deepEqual(issues.rows[0]?.labels, ['bug'])
  assert.ok(net.calls.every((c) => c.auth === 'Bearer hil_abcdefgh1234'))
  net.restore()
  await worker.deactivate()
})

test('a read-only key gets a clear notice when writing', async () => {
  const net = fakeFetch((tool) =>
    tool === 'list_workspaces'
      ? rpc([{ id: 'w1', name: 'WS', slug: 'ws', role: 'owner', default: true }])
      : new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: `Tool ${tool} not found` } }), { headers: { 'content-type': 'application/json' } })
  )
  const worker = await mountWorker(main, { host: mockHost({}) })
  await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
  await assert.rejects(() => worker.request('issue.comment', { id: 'i1', body: 'hello' }), /read-only/)
  net.restore()
  await worker.deactivate()
})

test('filters by a specific state, including closed ones, and asks for includeClosed', async () => {
  const sentArgs: unknown[] = []
  const mk = (id: string, state: string) => ({ id, identifier: id, title: id, state, stateType: 'completed', project: null, assignee: null, priority: null, agentWorking: null, labels: [] })
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    if (params.name === 'list_workspaces') return rpc([{ id: 'w', name: 'W', slug: 'w', role: 'owner', default: true }])
    sentArgs.push(params.arguments)
    return rpc([mk('A-1', 'Done'), mk('A-2', 'Canceled'), mk('A-3', 'Done')])
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({}) })
  await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
  const page = await worker.request('issues.list', { scope: 'state:Done' })
  assert.deepEqual(page.rows.map((r) => r.identifier), ['A-1', 'A-3'])
  assert.equal(page.total, 2)
  assert.ok(sentArgs.some((a) => (a as { includeClosed?: boolean }).includeClosed === true))
  globalThis.fetch = original
  await worker.deactivate()
})

test('with a query it searches on the server without filtering by state', async () => {
  const tools: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    tools.push(params.name)
    if (params.name === 'list_workspaces') return rpc([{ id: 'w', name: 'W', slug: 'w', role: 'owner', default: true }])
    return rpc([{ id: 'x', identifier: 'A-9', title: 'old', state: 'Done', stateType: 'completed', project: null, assignee: null, priority: null, agentWorking: null, labels: [] }])
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({}) })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    await new Promise((resolve) => setTimeout(resolve, 20)) // let the status bar refresh finish
    tools.length = 0
    const page = await worker.request('issues.list', { scope: 'started', query: ' old ' })
    assert.deepEqual(page.rows.map((r) => r.identifier), ['A-9'])
    assert.ok(tools.includes('search_issues'))
  } finally {
    globalThis.fetch = original
    await worker.deactivate()
  }
})

test('a bare number finds the issue by identifier even if the full-text search does not return it', async () => {
  const mk = (n: number) => ({ id: `id${n}`, identifier: `DRAPPS-${n}`, title: `task ${n}`, state: 'Done', stateType: 'completed', project: null, assignee: null, priority: null, agentWorking: null, labels: [] })
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    if (params.name === 'list_workspaces') return rpc([{ id: 'w', name: 'W', slug: 'w', role: 'owner', default: true }])
    if (params.name === 'search_issues') return rpc([mk(2240)]) // full-text does not know identifiers
    return rpc([mk(2139), mk(2240), mk(1)]) // the full index
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({}) })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    for (const q of ['2139', 'drapps2139', 'DRAPPS-2139']) {
      const page = await worker.request('issues.list', { scope: 'started', query: q })
      assert.equal(page.rows[0]?.identifier, 'DRAPPS-2139', `first for "${q}"`)
    }
  } finally {
    globalThis.fetch = original
    await worker.deactivate()
  }
})

const resolveFetch = (projects: { id: string; name: string }[], issues: unknown[] = []) => {
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    if (params.name === 'list_workspaces') return rpc([{ id: 'w', name: 'W', slug: 'w', role: 'owner', default: true }])
    if (params.name === 'list_projects') return rpc(projects)
    return rpc(issues)
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}
const orcaList = (...workspaces: { name: string; path: string; project?: string }[]) => ({
  workspaces: workspaces.map((w) => ({ id: w.name, kind: 'folder', branch: null, hostId: 'local', ...w })),
  truncated: false
})

test('resolves a workspace: branch issue first, then a learned link, then a name match', async () => {
  const mk = (n: number, projectId: string) => ({ id: `id${n}`, identifier: `DRAPPS-${n}`, title: `t${n}`, state: 'Done', stateType: 'completed', project: null, projectId, assignee: null, priority: null, agentWorking: null, labels: [] })
  const restore = resolveFetch(
    [{ id: 'pA', name: 'Alpha' }, { id: 'pB', name: 'Beta' }, { id: 'pI', name: 'acme-shop' }],
    [mk(2139, 'pA'), mk(7, 'pB')]
  )
  const host = mockHost({ results: { 'workspace.list': orcaList({ name: 'acme-shop.com', path: 'C:\\Projects\\acme-shop.com' }) } })
  const worker = await mountWorker(main, { host })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    // 1) the branch wins
    const byBranch = await worker.request('workspace.resolve', { displayName: 'whatever', branch: 'drapps-2139-search' })
    assert.deepEqual([byBranch.source, byBranch.projectId, byBranch.issue?.identifier], ['branch', 'pA', 'DRAPPS-2139'])
    assert.equal((await worker.request('workspace.resolve', { displayName: 'x', branch: 'feature/drapps-7' })).projectId, 'pB')
    // A branch naming a missing issue does not stop the other signals.
    assert.equal((await worker.request('workspace.resolve', { displayName: 'x', branch: 'drapps-9999-gone' })).source, null)
    // 3) a folder workspace with no branch is matched by name (the .com is ignored)
    const byName = await worker.request('workspace.resolve', { displayName: 'acme-shop.com', branch: '' })
    assert.deepEqual([byName.source, byName.projectId, byName.issue], ['name', 'pI', null])
    // 2) a learned link beats the name, and forgetting it brings the name back
    await worker.request('workspace.link', { key: 'acme-shop.com', projectId: 'pB' })
    assert.deepEqual((await worker.request('workspace.resolve', { displayName: 'acme-shop.com', branch: '' })).source, 'link')
    assert.equal((await worker.request('workspace.resolve', { displayName: 'acme-shop.com', branch: '' })).projectId, 'pB')
    await worker.request('workspace.link', { key: 'acme-shop.com', projectId: null })
    assert.equal((await worker.request('workspace.resolve', { displayName: 'acme-shop.com', branch: '' })).source, 'name')
    // A link to a project that no longer exists is ignored.
    await worker.request('workspace.link', { key: 'acme-shop.com', projectId: 'deleted' })
    assert.equal((await worker.request('workspace.resolve', { displayName: 'acme-shop.com', branch: '' })).source, 'name')
  } finally {
    restore()
    await worker.deactivate()
  }
})

test('matches by folder name, and stays silent when the match is ambiguous or absent', async () => {
  const restore = resolveFetch([{ id: 'p1', name: 'Harbor North' }, { id: 'p2', name: 'Harbor South' }, { id: 'p3', name: 'Orange Grove' }])
  const host = mockHost({ results: { 'workspace.list': orcaList({ name: 'main-checkout', path: 'C:\\Projects\\orangegrove.es' }) } })
  const worker = await mountWorker(main, { host })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    // the workspace name says nothing but its folder does
    assert.equal((await worker.request('workspace.resolve', { displayName: 'main-checkout', branch: '' })).projectId, 'p3')
    // two projects fit equally well: no guess
    assert.equal((await worker.request('workspace.resolve', { displayName: 'harbor', branch: '' })).projectId, null)
    // nothing fits
    assert.equal((await worker.request('workspace.resolve', { displayName: 'my-repo', branch: 'main' })).projectId, null)
  } finally {
    restore()
    await worker.deactivate()
  }
})

test('extracts mentioned identifiers, including lists with bare numbers', () => {
  const text = 'Related: DRAPPS-101 (done), DRAPPS-102 (billing, canceled), DRAPPS-103 and 104 (public form). See DRAPPS-1, 2 and 3 and drapps-101; also DRAPPS-8 y 9.'
  assert.deepEqual(extractRefs(text), ['DRAPPS-101', 'DRAPPS-102', 'DRAPPS-103', 'DRAPPS-104', 'DRAPPS-1', 'DRAPPS-2', 'DRAPPS-3', 'DRAPPS-8', 'DRAPPS-9']) // "y" is the Spanish "and"
  assert.deepEqual(extractRefs('Esta es DRAPPS-5 y DRAPPS-6', 'drapps-5'), ['DRAPPS-6'])
  assert.deepEqual(extractRefs('no references, just the year 2026'), [])
})

const agent = (state: string) => ({ agents: [{ terminalId: 't1', title: 'agent-1', agent: 'agent-1', state, stateStartedAt: 0 }, { terminalId: null, title: null, agent: null, state: 'done', stateStartedAt: 0 }] })

test('runs the Hilbana command in an idle agent', async () => {
  const host = mockHost({ results: { 'agents.list': agent('waiting'), 'terminal.sendText': { accepted: true } } })
  const worker = await mountWorker(main, { host })
  try {
    // Agents without a terminal are not offered.
    assert.deepEqual((await worker.request('agents.list')).map((a) => a.terminalId), ['t1'])
    assert.deepEqual(await worker.request('agent.send', { terminalId: 't1', identifier: 'DRAPPS-2139' }), { sent: '/hilbana:trabajar-issue DRAPPS-2139' })
    assert.deepEqual(host.callsOf('terminal.sendText'), [{ terminalId: 't1', text: '/hilbana:trabajar-issue DRAPPS-2139', enter: true }])
  } finally {
    await worker.deactivate()
  }
})

test('never types into an agent that is working or blocked', async () => {
  for (const state of ['working', 'blocked']) {
    const host = mockHost({ results: { 'agents.list': agent(state), 'terminal.sendText': { accepted: true } } })
    const worker = await mountWorker(main, { host })
    try {
      await assert.rejects(() => worker.request('agent.send', { terminalId: 't1', identifier: 'DRAPPS-1' }), new RegExp(state))
      assert.deepEqual(host.callsOf('terminal.sendText'), [])
    } finally {
      await worker.deactivate()
    }
  }
})

test('rejects an agent that left the workspace and a malformed identifier', async () => {
  const host = mockHost({ results: { 'agents.list': agent('done'), 'terminal.sendText': { accepted: true } } })
  const worker = await mountWorker(main, { host })
  try {
    await assert.rejects(() => worker.request('agent.send', { terminalId: 'gone', identifier: 'DRAPPS-1' }), /no longer/)
    await assert.rejects(() => worker.request('agent.send', { terminalId: 't1', identifier: 'DRAPPS-1; rm -rf /' }), /Invalid issue identifier/)
    assert.deepEqual(host.callsOf('terminal.sendText'), [])
  } finally {
    await worker.deactivate()
  }
})

test('a custom prompt is sent as a single line', async () => {
  const host = mockHost({
    results: { 'agents.list': agent('done'), 'terminal.sendText': { accepted: true } },
    settings: { agentPrompt: 'Work on {identifier}\nthen stop' }
  })
  const worker = await mountWorker(main, { host })
  try {
    assert.deepEqual(await worker.request('agent.send', { terminalId: 't1', identifier: 'ABC-7' }), { sent: 'Work on ABC-7 then stop' })
  } finally {
    await worker.deactivate()
  }
})

test('a link remembers the Hilbana workspace too, and scopes the lookups to it', async () => {
  const seen: { tool: string; workspaceId?: string }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    seen.push({ tool: params.name, workspaceId: params.arguments?.workspaceId })
    if (params.name === 'list_workspaces') return rpc([{ id: 'wA', name: 'A', slug: 'a', role: 'owner', default: true }, { id: 'wB', name: 'B', slug: 'b', role: 'member', default: false }])
    if (params.name === 'list_projects') return rpc(params.arguments?.workspaceId === 'wB' ? [{ id: 'bB', name: 'Beta' }] : [{ id: 'pA', name: 'Alpha' }])
    return rpc([])
  }) as typeof fetch
  const host = mockHost({
    results: { 'workspace.list': orcaList({ name: 'beta.com', path: 'C:\\x\\beta.com' }) },
    // A link saved by an earlier version: just the project id.
    storage: { workspaceLinks: { old: 'pA' } }
  })
  const worker = await mountWorker(main, { host })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    // legacy string links still work
    assert.deepEqual(await worker.request('workspace.resolve', { displayName: 'old', branch: '' }), { key: 'old', accountId: null, workspaceId: null, projectId: 'pA', source: 'link', issue: null })

    // workspace linked, project not: the project is found by name inside THAT workspace
    await worker.request('workspace.link', { key: 'beta.com', projectId: null, workspaceId: 'wB' })
    seen.length = 0
    const found = await worker.request('workspace.resolve', { displayName: 'beta.com', branch: '', workspaceId: 'wA' })
    assert.deepEqual([found.workspaceId, found.projectId, found.source], ['wB', 'bB', 'name'])
    assert.ok(seen.filter((c) => c.tool === 'list_projects').every((c) => c.workspaceId === 'wB'), 'projects were listed in the linked workspace, not the panel one')

    // workspace + project both remembered
    await worker.request('workspace.link', { key: 'beta.com', projectId: 'bB', workspaceId: 'wB' })
    assert.deepEqual(await worker.request('workspace.resolve', { displayName: 'beta.com', branch: '', workspaceId: 'wA' }), { key: 'beta.com', accountId: null, workspaceId: 'wB', projectId: 'bB', source: 'link', issue: null })

    // forgetting removes both
    await worker.request('workspace.link', { key: 'beta.com', projectId: null, workspaceId: null })
    assert.equal((await worker.request('workspace.resolve', { displayName: 'beta.com', branch: '', workspaceId: 'wA' })).workspaceId, null)
  } finally {
    globalThis.fetch = original
    await worker.deactivate()
  }
})

test('the worker speaks the language the panel announces, and remembers it', async () => {
  const host = mockHost({ results: { 'agents.list': agent('done') } })
  const worker = await mountWorker(main, { host })
  try {
    await worker.request('locale.set', { locale: 'es-ES' })
    assert.equal(host.data().storage.lang, 'es')
    await assert.rejects(() => worker.request('agent.send', { terminalId: 't1', identifier: 'nope' }), /no válido/)
    await worker.request('locale.set', { locale: 'en-US' })
    await assert.rejects(() => worker.request('agent.send', { terminalId: 't1', identifier: 'nope' }), /Invalid issue identifier/)
  } finally {
    setLang('en')
    await worker.deactivate()
  }
})

test('a language remembered by an earlier session is used right at startup', async () => {
  const worker = await mountWorker(main, { host: mockHost({ results: { 'agents.list': agent('done') }, storage: { lang: 'es' } }) })
  try {
    await new Promise((resolve) => setTimeout(resolve, 20)) // the stored language loads asynchronously
    await assert.rejects(() => worker.request('agent.send', { terminalId: 't1', identifier: 'nope' }), /no válido/)
    assert.equal(translate('connect'), 'Conectar')
  } finally {
    setLang('en')
    await worker.deactivate()
  }
})

test('issue.get maps the sub-issues Hilbana returns', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    if (params.name === 'list_workspaces') return rpc([{ id: 'w', name: 'W', slug: 'w', role: 'owner', default: true }])
    if (params.name === 'get_issue') {
      return rpc({
        id: 'p1', identifier: 'ACME-1', title: 'Parent', state: 'In Progress', stateType: 'started', project: null, assignee: null, priority: null, agentWorking: null, labels: [],
        description: 'd', comments: [], relations: [],
        // The server sends whole issues; only what the panel needs should travel.
        subIssues: [
          { id: 'c1', identifier: 'ACME-2', title: 'Child one', state: 'Done', stateType: 'completed', description: 'x'.repeat(50) },
          { id: 'c2', identifier: 'ACME-3', title: 'Child two', state: 'Todo', stateType: 'unstarted' }
        ]
      })
    }
    return rpc([])
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({}) })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    const issue = await worker.request('issue.get', { id: 'p1' })
    assert.deepEqual(issue.subIssues, [
      { id: 'c1', identifier: 'ACME-2', title: 'Child one', state: 'Done', stateTone: 'success' },
      { id: 'c2', identifier: 'ACME-3', title: 'Child two', state: 'Todo', stateTone: 'neutral' }
    ])
    // No sub-issues at all (the field may be missing) is just an empty list.
    globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
      const { params } = JSON.parse(String(init.body))
      return params.name === 'get_issue' ? rpc({ id: 'p2', identifier: 'ACME-9', title: 'Solo', state: null, stateType: null, project: null, assignee: null, priority: null, agentWorking: null, labels: [] }) : rpc([])
    }) as typeof fetch
    assert.deepEqual((await worker.request('issue.get', { id: 'p2' })).subIssues, [])
  } finally {
    globalThis.fetch = original
    await worker.deactivate()
  }
})

test('a Hilbana colour becomes the nearest Orca tone', () => {
  // The palette of a real workspace: it must come out distinguishable and sensible.
  assert.equal(toneFor('#eb5757'), 'danger') // red
  assert.equal(toneFor('#f2c94c'), 'warning') // yellow
  assert.equal(toneFor('#4cb782'), 'success') // green
  assert.equal(toneFor('#6e7781'), 'neutral') // grey
  assert.equal(toneFor('#26b5ce'), 'accent') // turquoise
  assert.equal(toneFor('#95a2b3'), 'neutral') // blue-grey
  assert.equal(toneFor('#f90'), 'warning') // short hex
  assert.equal(toneFor('#000000'), 'neutral') // black has no hue
  // No colour, or one we cannot read: the state's category decides.
  assert.equal(toneFor(null, 'completed'), 'success')
  assert.equal(toneFor('not a colour', 'canceled'), 'danger')
  assert.equal(toneFor(undefined, 'started'), 'accent')
  assert.equal(toneFor('', 'backlog'), 'neutral')
  assert.equal(toneForType(undefined), 'neutral')
})

test('rows, sub-issues and mentions carry the tone of their state colour', async () => {
  const mk = (n: number, stateId: string, state: string, stateType: string) => ({ id: `i${n}`, identifier: `ACME-${n}`, title: `t${n}`, state, stateId, stateType, project: null, assignee: null, priority: null, agentWorking: null, labels: [] })
  const issues = [mk(1, 's-red', 'Backlog', 'backlog'), mk(2, 's-green', 'In Progress', 'started'), mk(3, 's-none', 'Mystery', 'completed')]
  let colourCalls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    if (params.name === 'list_workspaces') return rpc([{ id: 'w', name: 'W', slug: 'w', role: 'owner', default: true }])
    if (params.name === 'list_workflow_states') {
      colourCalls++
      // "s-none" has no colour at all
      return rpc([{ id: 's-red', name: 'Backlog', type: 'backlog', color: '#eb5757', teamId: 't' }, { id: 's-green', name: 'In Progress', type: 'started', color: '#4cb782', teamId: 't' }, { id: 's-none', name: 'Mystery', type: 'completed', teamId: 't' }])
    }
    if (params.name === 'get_issue') {
      return rpc({ ...issues[0], description: '', comments: [], subIssues: [issues[1], issues[2]], relations: [{ type: 'blocks', issueId: 'i2', issue: 'ACME-2', title: 't2', state: 'Done', stateType: 'completed' }] })
    }
    return rpc(issues)
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({}) })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    const page = await worker.request('issues.list', { scope: 'open' })
    assert.deepEqual(page.rows.map((r) => r.stateTone), ['danger', 'success', 'success'], 'a state with no colour falls back to its category (completed = success)')

    const detail = await worker.request('issue.get', { id: 'i1' })
    assert.equal(detail.stateTone, 'danger')
    assert.deepEqual(detail.subIssues.map((s) => s.stateTone), ['success', 'success'])
    assert.equal(detail.relations[0]?.stateTone, 'success', 'relations only know the category')

    const found = await worker.request('issues.resolve', { identifiers: ['ACME-1'] })
    assert.equal(found[0]?.stateTone, 'danger')
    assert.equal(colourCalls, 1, 'the colours are read once and cached, not on every request')
  } finally {
    globalThis.fetch = original
    await worker.deactivate()
  }
})

test('the list still works when the colours cannot be read', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    if (params.name === 'list_workspaces') return rpc([{ id: 'w', name: 'W', slug: 'w', role: 'owner', default: true }])
    if (params.name === 'list_workflow_states') return new Response('boom', { status: 500 })
    return rpc([{ id: 'i1', identifier: 'ACME-1', title: 't', state: 'Done', stateId: 's', stateType: 'completed', project: null, assignee: null, priority: null, agentWorking: null, labels: [] }])
  }) as typeof fetch
  const worker = await mountWorker(main, { host: mockHost({}) })
  try {
    await worker.request('auth.save', { key: 'hil_abcdefgh1234' })
    const page = await worker.request('issues.list', { scope: 'open' })
    assert.equal(page.rows.length, 1)
    assert.equal(page.rows[0]?.stateTone, 'success', 'falls back to the category')
  } finally {
    globalThis.fetch = original
    await worker.deactivate()
  }
})

test('several accounts: each has its own key, the link picks one, and the old key is adopted', async () => {
  const original = globalThis.fetch
  const seen: { tool: string; auth: string | null; workspaceId?: string }[] = []
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    const auth = new Headers(init.headers).get('authorization')
    seen.push({ tool: params.name, auth, workspaceId: params.arguments?.workspaceId })
    if (params.name === 'list_workspaces') {
      return rpc(auth === 'Bearer hil_personal0000' ? [{ id: 'wP', name: 'Mine', slug: 'm', role: 'owner', default: true }] : [{ id: 'wC', name: 'Company', slug: 'c', role: 'owner', default: true }])
    }
    if (params.name === 'list_projects') return rpc(auth === 'Bearer hil_personal0000' ? [{ id: 'pP', name: 'Garden' }] : [{ id: 'pC', name: 'Shop' }])
    return rpc([])
  }) as typeof fetch
  // A key saved by an earlier version, before accounts existed.
  const host = mockHost({ secrets: { apiKey: 'hil_company0000' }, results: { 'workspace.list': orcaList({ name: 'garden.com', path: '/x/garden.com' }) } })
  const worker = await mountWorker(main, { host })
  try {
    const first = await worker.request('auth.status')
    assert.deepEqual(first.accounts, [{ id: 'default', name: 'Company' }])
    assert.equal(first.activeId, 'default')

    const second = await worker.request('auth.save', { key: 'hil_personal0000', name: 'Personal' })
    assert.equal((await worker.request('auth.status')).activeId, second.accountId)
    seen.length = 0
    assert.deepEqual(await worker.request('projects.list', {}), [{ id: 'pP', name: 'Garden' }])
    assert.equal(seen.at(-1)?.auth, 'Bearer hil_personal0000')

    await worker.request('account.select', { accountId: 'default' })
    assert.deepEqual(await worker.request('projects.list', {}), [{ id: 'pC', name: 'Shop' }])
    await assert.rejects(() => worker.request('account.select', { accountId: 'nope' }))

    // The Orca workspace is linked to the personal account while the company one is active:
    // its lookups run with the personal key and the panel's (company) workspace is not used.
    await worker.request('workspace.link', { key: 'garden.com', projectId: null, workspaceId: null, accountId: second.accountId })
    seen.length = 0
    const found = await worker.request('workspace.resolve', { displayName: 'garden.com', branch: '', workspaceId: 'wC' })
    assert.equal(found.accountId, second.accountId)
    assert.equal(found.projectId, 'pP')
    assert.ok(seen.filter((c) => c.tool === 'list_projects').every((c) => c.auth === 'Bearer hil_personal0000' && c.workspaceId === undefined))

    // Typing an existing name replaces that account's key instead of adding a duplicate.
    await worker.request('auth.save', { key: 'hil_personal1111', name: 'personal' })
    assert.equal((await worker.request('auth.status')).accounts.length, 2)
    assert.equal(host.data().secrets[`apiKey-${second.accountId}`], 'hil_personal1111')

    // Removing an account drops its key and a link that points to it.
    const left = await worker.request('auth.clear', { accountId: second.accountId })
    assert.equal(left.activeId, 'default')
    assert.equal(host.data().secrets[`apiKey-${second.accountId}`], undefined)
    const again = await worker.request('workspace.resolve', { displayName: 'garden.com', branch: '', workspaceId: 'wC' })
    assert.equal(again.accountId, null)
    assert.equal(again.source, null)

    // Removing the last one disconnects.
    await worker.request('auth.clear', { accountId: 'default' })
    assert.equal((await worker.request('auth.status')).connected, false)
  } finally {
    globalThis.fetch = original
    await worker.deactivate()
  }
})
