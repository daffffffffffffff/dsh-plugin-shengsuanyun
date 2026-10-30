import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { ACCOUNT_KEYS_URL, AUTH_CHANNEL, AUTH_PAGE_URL } from './constants.js'
import { ShengsuanyunError } from './errors.js'

const MAX_EXCHANGE_BYTES = 64 * 1024
const AUTH_TIMEOUT_MS = 5 * 60_000

export interface BrowserCredential {
  readonly apiKey: string
}

interface ExchangeEnvelope {
  readonly code?: unknown
  readonly data?: unknown
  readonly jwt_token?: unknown
}

function successCode(value: unknown): boolean {
  return value === 0 || value === '0'
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Pull the shared API key out of the authorization exchange body. */
export function credentialFromEnvelope(payload: ExchangeEnvelope): BrowserCredential | undefined {
  const outer = typeof payload.data === 'object' && payload.data !== null ? payload.data as Record<string, unknown> : {}
  const inner = typeof outer.data === 'object' && outer.data !== null ? outer.data as Record<string, unknown> : {}
  const apiKey = nonBlank(inner.api_key ?? outer.api_key ?? payload.data) ?? nonBlank(inner.jwt_token ?? outer.jwt_token ?? payload.jwt_token)
  return apiKey === undefined ? undefined : { apiKey }
}

export function authorizeUrl(authPageUrl: string, callbackUrl: string, state: string, verifier: string): string {
  const authorize = new URL(authPageUrl)
  authorize.searchParams.set('app_name', 'dsh')
  authorize.searchParams.set('callback_url', callbackUrl)
  authorize.searchParams.set('from', AUTH_CHANNEL)
  authorize.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'))
  authorize.searchParams.set('code_challenge_method', 'S256')
  authorize.searchParams.set('state', state)
  return authorize.toString()
}

function callbackPage(res: ServerResponse, ok: boolean): void {
  const title = ok ? '正在验证授权' : '授权失败'
  const heading = ok ? '授权信息已收到' : '授权未完成'
  const detail = ok ? 'dsh 正在验证并保存 API Key，请回到 dsh 查看结果。' : '请回到 dsh 后重新登录。'
  res.statusCode = ok ? 200 : 400
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><body><main><h1>${heading}</h1><p>${detail}</p></main></body></html>`)
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('胜算云回调没有绑到本机端口')
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()))
}

async function exchangeCode(code: string, verifier: string, callbackUrl: string, signal: AbortSignal, accountKeysUrl: string): Promise<BrowserCredential> {
  let response: Response
  try {
    const endpoint = new URL(accountKeysUrl)
    endpoint.searchParams.set('from', AUTH_CHANNEL)
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, callback_url: callbackUrl }),
      redirect: 'manual',
      signal,
    })
  } catch {
    throw new ShengsuanyunError(502, '胜算云授权服务暂时不可用', 'router-validation-failed')
  }
  const body = await response.text()
  if (body.length > MAX_EXCHANGE_BYTES) throw new ShengsuanyunError(502, '胜算云授权响应过大', 'router-validation-failed')
  if (!response.ok) throw new ShengsuanyunError(response.status, '胜算云授权码兑换失败', 'router-validation-failed')
  let payload: ExchangeEnvelope
  try {
    payload = JSON.parse(body) as ExchangeEnvelope
  } catch {
    throw new ShengsuanyunError(502, '胜算云授权响应无效', 'router-validation-failed')
  }
  if (!successCode(payload.code)) throw new ShengsuanyunError(502, '胜算云授权码兑换失败', 'router-validation-failed')
  const value = credentialFromEnvelope(payload)
  if (value === undefined) throw new ShengsuanyunError(502, '胜算云授权未返回有效凭据', 'router-validation-failed')
  return value
}

export interface BrowserAuthorization {
  readonly url: string
  readonly result: Promise<BrowserCredential>
}

/** One loopback login. The verifier stays in this process. */
export async function beginBrowserAuthorization(signal: AbortSignal): Promise<BrowserAuthorization> {
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('base64url')
  let settle: (value: BrowserCredential) => void = () => {}
  let reject: (cause: unknown) => void = () => {}
  let consumed = false
  let callbackUrl = ''
  const result = new Promise<BrowserCredential>((resolve, rejectResult) => {
    settle = resolve
    reject = rejectResult
  })
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || requestUrl.pathname !== '/callback' || consumed) {
      callbackPage(res, false)
      return
    }
    if (requestUrl.searchParams.get('state') !== state) {
      callbackPage(res, false)
      return
    }
    if (requestUrl.searchParams.get('error') !== null) {
      consumed = true
      callbackPage(res, false)
      reject(new ShengsuanyunError(400, '胜算云授权已取消', 'authorization-cancelled'))
      return
    }
    const code = requestUrl.searchParams.get('code')
    if (code === null || code.trim() === '') {
      callbackPage(res, false)
      return
    }
    consumed = true
    callbackPage(res, true)
    void exchangeCode(code, verifier, callbackUrl, signal, ACCOUNT_KEYS_URL).then(settle, reject)
  })
  const port = await listen(server)
  callbackUrl = `http://127.0.0.1:${port}/callback?state=${encodeURIComponent(state)}`
  const timeout = setTimeout(() => reject(new ShengsuanyunError(408, '等待胜算云浏览器授权超时', 'authorization-timeout')), AUTH_TIMEOUT_MS)
  const abort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
  signal.addEventListener('abort', abort, { once: true })
  void result.finally(async () => {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    await closeServer(server)
  }).catch(() => {})
  return { url: authorizeUrl(AUTH_PAGE_URL, callbackUrl, state, verifier), result }
}
