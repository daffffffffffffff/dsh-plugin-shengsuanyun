export interface ShengsuanyunStatus {
  readonly configured: boolean
  readonly writable: boolean
  readonly maskedToken?: string
  readonly accountName?: string
  readonly model: {
    readonly provider: 'shengsuanyun'
    readonly id?: string
    readonly ready: boolean
  }
  readonly chatModels?: readonly string[]
}

export type LoginState = 'pending' | 'verifying' | 'model-selection-required' | 'complete' | 'cancelled' | 'failed'

export interface LoginStart {
  readonly sessionId: string
  readonly url: string
}

export interface LoginStatus {
  readonly state: LoginState
  readonly reason?: string
  readonly models?: readonly string[]
}

export class ShengsuanyunClientError extends Error {
  constructor(message: string, readonly reason?: string) {
    super(message)
    this.name = 'ShengsuanyunClientError'
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? payload as { error?: unknown, reason?: unknown } : {}
    const message = typeof record.error === 'string' && record.error.trim() !== '' ? record.error : '请求没有完成'
    const reason = typeof record.reason === 'string' ? record.reason : undefined
    throw new ShengsuanyunClientError(message, reason)
  }
  return payload
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function readStatus(signal?: AbortSignal): Promise<ShengsuanyunStatus> {
  const body = object(await request('/api/shengsuanyun/status', signal === undefined ? {} : { signal }))
  const model = object(body.model)
  const id = typeof model.id === 'string' ? model.id : undefined
  const chatModels = Array.isArray(body.chatModels) ? body.chatModels.filter((item): item is string => typeof item === 'string') : undefined
  return {
    configured: body.configured === true,
    writable: body.writable !== false,
    ...(typeof body.maskedToken === 'string' ? { maskedToken: body.maskedToken } : {}),
    ...(typeof body.accountName === 'string' ? { accountName: body.accountName } : {}),
    model: {
      provider: 'shengsuanyun',
      ...(id === undefined ? {} : { id }),
      ready: model.ready === true,
    },
    ...(chatModels === undefined ? {} : { chatModels }),
  }
}

export async function startLogin(useAsDefault: boolean, signal?: AbortSignal): Promise<LoginStart> {
  const body = object(await request('/api/shengsuanyun/login/start', {
    method: 'POST',
    body: JSON.stringify({ useAsDefault }),
    ...(signal === undefined ? {} : { signal }),
  }))
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const url = typeof body.url === 'string' ? body.url : ''
  if (sessionId === '' || url === '') throw new ShengsuanyunClientError('登录没有开始')
  return { sessionId, url }
}

export async function readLogin(sessionId: string, signal?: AbortSignal): Promise<LoginStatus> {
  const body = object(await request(`/api/shengsuanyun/login/status?sessionId=${encodeURIComponent(sessionId)}`, signal === undefined ? {} : { signal }))
  const state = body.state
  if (state !== 'pending' && state !== 'verifying' && state !== 'model-selection-required' && state !== 'complete' && state !== 'cancelled' && state !== 'failed') {
    throw new ShengsuanyunClientError('登录状态无效')
  }
  const models = Array.isArray(body.models) ? body.models.filter((item): item is string => typeof item === 'string') : undefined
  return {
    state,
    ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    ...(models === undefined ? {} : { models }),
  }
}

export async function cancelLogin(sessionId: string): Promise<void> {
  await request('/api/shengsuanyun/login/cancel', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
}

export async function saveToken(token: string, useAsDefault: boolean): Promise<LoginStatus> {
  const body = object(await request('/api/shengsuanyun/token', {
    method: 'POST',
    body: JSON.stringify({ token, useAsDefault }),
  }))
  const state = body.state
  if (state !== 'complete' && state !== 'model-selection-required' && state !== 'failed') {
    throw new ShengsuanyunClientError('保存密钥没有完成')
  }
  const models = Array.isArray(body.models) ? body.models.filter((item): item is string => typeof item === 'string') : undefined
  return {
    state,
    ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    ...(models === undefined ? {} : { models }),
  }
}

export async function chooseModel(model: string): Promise<void> {
  await request('/api/shengsuanyun/model', {
    method: 'POST',
    body: JSON.stringify({ model }),
  })
}

export async function logout(): Promise<void> {
  await request('/api/shengsuanyun/logout', { method: 'POST', body: '{}' })
}

export function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'authorization-cancelled': return '登录已取消'
    case 'authorization-timeout': return '登录超时，请重试'
    case 'router-validation-failed': return '这把密钥连不上胜算云的聊天模型'
    case 'no-chat-model': return '这个账号当前没有可用的聊天模型'
    case 'credential-save-failed': return '密钥没能保存'
    default: return '没有完成，请重试'
  }
}
