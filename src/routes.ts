import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { API_PREFIX } from './constants.js'
import { ShengsuanyunError } from './errors.js'
import type { ShengsuanyunLogin } from './login.js'

const MAX_JSON_BYTES = 32 * 1024
const SESSION_PATTERN = /^[A-Za-z0-9_-]{32}$/
const MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]{1,200}$/

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function sameAuthority(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host?.toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

function allowed(req: IncomingMessage, res: ServerResponse, port: number): boolean {
  if (!sameAuthority(req, port)) {
    sendJson(res, 403, { error: '只接受本机请求' })
    return false
  }
  if (req.method === 'GET' || req.method === 'HEAD') return true
  const host = req.headers.host?.toLowerCase()
  if (host !== undefined && req.headers.origin === `http://${host}`) return true
  sendJson(res, 403, { error: '只接受本机请求' })
  return false
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/iu.test(req.headers['content-type'] ?? '')) {
    throw new ShengsuanyunError(415, '请求必须是 JSON', 'invalid-request')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.byteLength
    if (size > MAX_JSON_BYTES) throw new ShengsuanyunError(413, '请求过大', 'invalid-request')
    chunks.push(bytes)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('shape')
    return value as Record<string, unknown>
  } catch (cause) {
    if (cause instanceof ShengsuanyunError) throw cause
    throw new ShengsuanyunError(400, '请求必须是 JSON 对象', 'invalid-request')
  }
}

function fail(res: ServerResponse, cause: unknown): void {
  if (cause instanceof ShengsuanyunError) {
    const status = cause.status >= 400 && cause.status < 600 ? cause.status : 502
    sendJson(res, status, { error: cause.message, reason: cause.reason })
    return
  }
  sendJson(res, 400, { error: '请求没有完成', reason: 'invalid-request' })
}

function useAsDefault(body: Record<string, unknown>): boolean {
  return body.useAsDefault !== false
}

export function registerRoutes(ctx: Context, login: ShengsuanyunLogin): () => void {
  const port = ctx.webServer.port
  const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    ctx.webServer.register({ kind: 'exact', path, handler })

  const routes = [
    register(`${API_PREFIX}/status`, async (req, res) => {
      if (req.method !== 'GET' || !allowed(req, res, port)) return
      try {
        sendJson(res, 200, await login.snapshot(AbortSignal.timeout(8_000)))
      } catch {
        sendJson(res, 503, { error: '暂时读不到胜算云连接状态' })
      }
    }),
    register(`${API_PREFIX}/login/start`, async (req, res) => {
      if (req.method !== 'POST' || !allowed(req, res, port)) return
      try {
        const body = await readJson(req)
        sendJson(res, 200, await login.start(useAsDefault(body)))
      } catch (cause) {
        fail(res, cause)
      }
    }),
    register(`${API_PREFIX}/login/status`, async (req, res) => {
      if (req.method !== 'GET' || !allowed(req, res, port)) return
      const sessionId = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId') ?? ''
      if (!SESSION_PATTERN.test(sessionId)) {
        sendJson(res, 400, { error: '登录会话无效' })
        return
      }
      const status = login.status(sessionId)
      if (status === undefined) sendJson(res, 404, { error: '登录会话不存在' })
      else sendJson(res, 200, status)
    }),
    register(`${API_PREFIX}/login/cancel`, async (req, res) => {
      if (req.method !== 'POST' || !allowed(req, res, port)) return
      try {
        const body = await readJson(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        if (!SESSION_PATTERN.test(sessionId)) throw new ShengsuanyunError(400, '登录会话无效', 'invalid-request')
        await login.cancel(sessionId)
        sendJson(res, 200, { ok: true })
      } catch (cause) {
        fail(res, cause)
      }
    }),
    register(`${API_PREFIX}/token`, async (req, res) => {
      if (req.method !== 'POST' || !allowed(req, res, port)) return
      try {
        const body = await readJson(req)
        const token = typeof body.token === 'string' ? body.token : ''
        sendJson(res, 200, await login.saveToken(token, useAsDefault(body), AbortSignal.timeout(20_000)))
      } catch (cause) {
        fail(res, cause)
      }
    }),
    register(`${API_PREFIX}/model`, async (req, res) => {
      if (req.method !== 'POST' || !allowed(req, res, port)) return
      try {
        const body = await readJson(req)
        const model = typeof body.model === 'string' ? body.model.trim() : ''
        if (!MODEL_PATTERN.test(model)) throw new ShengsuanyunError(400, '模型 id 无效', 'invalid-request')
        await login.chooseModel(model, AbortSignal.timeout(20_000))
        sendJson(res, 200, { ok: true })
      } catch (cause) {
        fail(res, cause)
      }
    }),
    register(`${API_PREFIX}/logout`, async (req, res) => {
      if (req.method !== 'POST' || !allowed(req, res, port)) return
      try {
        await login.logout()
        sendJson(res, 200, { ok: true })
      } catch (cause) {
        fail(res, cause)
      }
    }),
  ]
  return () => {
    for (const dispose of routes) dispose()
  }
}
