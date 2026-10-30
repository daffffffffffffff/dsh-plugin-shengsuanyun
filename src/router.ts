import { ROUTER_MODELS_URL } from './constants.js'
import { ShengsuanyunError } from './errors.js'

const MAX_ROUTER_MODELS_BYTES = 2 * 1024 * 1024

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.toLowerCase())
    : []
}

function supportsChatCompletions(item: Record<string, unknown>): boolean {
  const declared = [
    ...stringList(item.capabilities),
    ...stringList(item.supported_generation_methods),
    ...stringList(item.supportedGenerationMethods),
    ...stringList(item.supported_endpoints),
    ...stringList(item.supportedEndpoints),
  ]
  if (declared.length === 0) return true
  return declared.some(value =>
    value === 'chat'
    || value === 'chat-completions'
    || value === 'chat_completions'
    || value.endsWith('/chat/completions'),
  )
}

/** Chat model ids from a ShengSuanYun router `/models` payload. */
export function routerModelIds(payload: unknown): readonly string[] {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new ShengsuanyunError(502, '胜算云模型目录响应无效', 'router-validation-failed')
  }
  const ids = (payload as { readonly data: readonly unknown[] }).data.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    if (!supportsChatCompletions(record)) return []
    const id = record.id
    return typeof id === 'string' && id.trim() !== '' ? [id.trim()] : []
  })
  if (ids.length === 0) throw new ShengsuanyunError(422, '胜算云账号当前没有可用聊天模型', 'no-chat-model')
  return ids
}

async function boundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_ROUTER_MODELS_BYTES) {
    await response.body?.cancel()
    throw new ShengsuanyunError(502, '胜算云模型目录响应过大', 'router-validation-failed')
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_ROUTER_MODELS_BYTES) {
      await reader.cancel()
      throw new ShengsuanyunError(502, '胜算云模型目录响应过大', 'router-validation-failed')
    }
    chunks.push(next.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Host-only check that this key can list chat models. The key never leaves this function. */
export async function listChatModels(token: string, signal: AbortSignal): Promise<readonly string[]> {
  let response: Response
  try {
    response = await fetch(ROUTER_MODELS_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal,
    })
  } catch {
    throw new ShengsuanyunError(502, '胜算云模型服务暂时不可用', 'router-validation-failed')
  }
  const body = await boundedBody(response)
  if (!response.ok) throw new ShengsuanyunError(response.status, '胜算云模型凭据验证失败', 'router-validation-failed')
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new ShengsuanyunError(502, '胜算云模型目录响应无效', 'router-validation-failed')
  }
  return routerModelIds(payload)
}
