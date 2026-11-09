import { t } from './i18n'

// Minimal client for Hilbana's MCP (stateless Streamable HTTP, JSON response).
// No dependencies: one JSON-RPC POST per call. The API key travels ONLY in the Authorization
// header to the configured URL and is never written to logs or error messages.

export type Issue = {
  id: string
  identifier: string
  title: string
  state: string | null
  stateType: string | null
  stateId?: string | null
  project: string | null
  projectId?: string | null
  assignee: string | null
  priority: string | number | null
  agentWorking: string | null
  labels: { id: string; name: string; color: string }[]
}

export type Workspace = { id: string; name: string; slug: string; role: string; default: boolean }
export type Project = { id: string; name: string }

export const DEFAULT_URL = 'https://app.hilbana.com/mcp'

/** https is mandatory except for localhost: the key must never travel in clear text. */
export function validateUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(t('errUrlInvalid'))
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(t('errUrlHttps'))
  }
  return url
}

export function validateKey(key: string): string {
  const trimmed = key.trim()
  if (!/^hil_[A-Za-z0-9_-]{8,}$/.test(trimmed)) {
    throw new Error(t('errKeyFormat'))
  }
  return trimmed
}

let nextId = 1

export async function callTool<T>(
  url: string,
  key: string,
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<T> {
  const target = validateUrl(url)
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name, arguments: args }
    }),
    signal: signal ?? AbortSignal.timeout(20_000)
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error(t('errRejected'))
  }
  if (!response.ok) throw new Error(t('errHttp', { status: response.status }))
  const message = await readRpc(response)
  if (message.error) throw new Error(t('errMcp', { message: message.error.message ?? t('errMcpUnknown') }))
  const text = message.result?.content?.find((part) => part.type === 'text')?.text ?? ''
  if (message.result?.isError) throw new Error(text || t('errToolFailed', { name }))
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(t('errNotJson', { name }))
  }
}

type RpcMessage = {
  result?: { isError?: boolean; content?: { type: string; text?: string }[] }
  error?: { message?: string }
}

/** The server answers JSON, but a single-event SSE is also valid. */
async function readRpc(response: Response): Promise<RpcMessage> {
  const body = await response.text()
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .pop()
    if (!data) throw new Error(t('errEmptyMcp'))
    return JSON.parse(data) as RpcMessage
  }
  return JSON.parse(body) as RpcMessage
}
