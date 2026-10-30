import { ACCOUNT_INFO_URL } from './constants.js'

const MAX_ACCOUNT_RESPONSE_BYTES = 256 * 1024
const IDENTITY_FIELDS = ['uid', 'id', 'userId', 'displayName', 'display_name', 'name', 'Nickname', 'nickname', 'Username', 'username'] as const
const ENVELOPES = ['data', 'user', 'userInfo', 'profile', 'account', 'result'] as const

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

function userRecord(payload: unknown): Record<string, unknown> {
  const queue: unknown[] = [payload]
  const visited = new Set<object>()
  while (queue.length > 0) {
    const candidate = queue.shift()
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate) || visited.has(candidate)) continue
    visited.add(candidate)
    const current = candidate as Record<string, unknown>
    if (IDENTITY_FIELDS.some(field => field in current)) return current
    for (const key of ENVELOPES) queue.push(current[key])
  }
  return {}
}

/** Display name from the account payload. Anything else stays on the host. */
export function accountDisplayName(payload: unknown): string | undefined {
  const user = userRecord(payload)
  return text(
    user.displayName ?? user.display_name ?? user.name
      ?? user.Nickname ?? user.nickname
      ?? user.Username ?? user.username,
  )
}

async function boundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_ACCOUNT_RESPONSE_BYTES) {
    await response.body?.cancel()
    return ''
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_ACCOUNT_RESPONSE_BYTES) {
      await reader.cancel()
      return ''
    }
    chunks.push(next.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Best-effort nickname. A failure leaves the connection usable. */
export async function readAccountName(token: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(ACCOUNT_INFO_URL, {
      headers: { accept: 'application/json', 'x-token': token },
      signal,
    })
    if (!response.ok) return undefined
    const body = await boundedBody(response)
    if (body === '') return undefined
    const payload: unknown = JSON.parse(body)
    const envelope = record(payload)
    if (typeof envelope.code === 'number' && envelope.code !== 0) return undefined
    return accountDisplayName(payload)
  } catch {
    return undefined
  }
}
