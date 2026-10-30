import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { beginBrowserAuthorization } from './auth.js'
import { readAccountName } from './account.js'
import { API_KEY_ENV, DEFAULT_MODEL, PROVIDER } from './constants.js'
import { ShengsuanyunError, reasonOf, type ShengsuanyunReason } from './errors.js'
import { capModelIds, maskToken, shouldSelectDefault } from './flow.js'
import { currentProviderModel, selectDefaultModel } from './provider.js'
import { listChatModels } from './router.js'

const SESSION_TTL_MS = 10 * 60_000
const MAX_PENDING = 3
const TOKEN_LIMIT = 8_192
const ref = credentialRef(API_KEY_ENV)

export type LoginState = 'pending' | 'verifying' | 'model-selection-required' | 'complete' | 'cancelled' | 'failed'

export interface LoginStart {
  readonly sessionId: string
  readonly url: string
}

export interface LoginStatus {
  readonly state: LoginState
  readonly reason?: ShengsuanyunReason
  readonly models?: readonly string[]
}

export interface CredentialSnapshot {
  readonly configured: boolean
  readonly writable: boolean
  readonly maskedToken?: string
  readonly accountName?: string
  readonly model: {
    readonly provider: typeof PROVIDER
    readonly id?: string
    readonly ready: boolean
  }
  readonly chatModels?: readonly string[]
}

interface Session {
  readonly id: string
  readonly controller: AbortController
  readonly previous: string | undefined
  readonly useAsDefault: boolean
  readonly expiresAt: number
  readonly expiryTimer: ReturnType<typeof setTimeout>
  modelIds: readonly string[]
  wrote: boolean
  state: LoginState
  reason?: ShengsuanyunReason
}

function finalState(state: LoginState): boolean {
  return state === 'complete' || state === 'cancelled' || state === 'failed'
}

export class ShengsuanyunLogin {
  readonly #sessions = new Map<string, Session>()

  constructor(private readonly ctx: Context) {}

  async start(useAsDefault: boolean): Promise<LoginStart> {
    this.#sweep()
    const active = [...this.#sessions.values()].filter(session => !finalState(session.state)).length
    if (active >= MAX_PENDING) throw new ShengsuanyunError(429, '已有进行中的胜算云登录', 'invalid-request')
    const controller = new AbortController()
    const previous = await this.ctx.credentials.resolve(ref)
    const authorization = await beginBrowserAuthorization(controller.signal)
    const session = this.#open(controller, previous?.value, useAsDefault)
    void authorization.result.then(async credential => {
      if (finalState(session.state)) return
      await this.#finishCredential(session, credential.apiKey)
    }).catch(cause => {
      if (controller.signal.aborted || finalState(session.state)) this.#finish(session, 'cancelled', 'authorization-cancelled')
      else this.#finish(session, 'failed', reasonOf(cause))
    })
    return { sessionId: session.id, url: authorization.url }
  }

  status(sessionId: string): LoginStatus | undefined {
    this.#sweep()
    const session = this.#sessions.get(sessionId)
    if (session === undefined) return undefined
    return {
      state: session.state,
      ...(session.reason === undefined ? {} : { reason: session.reason }),
      ...(session.state === 'model-selection-required' ? { models: capModelIds(session.modelIds) } : {}),
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (session === undefined || finalState(session.state)) return
    session.controller.abort()
    await this.#restore(session)
    this.#finish(session, 'cancelled', 'authorization-cancelled')
  }

  async saveToken(token: string, useAsDefault: boolean, signal: AbortSignal): Promise<LoginStatus> {
    const normalized = token.trim()
    if (normalized === '' || normalized.length > TOKEN_LIMIT) {
      throw new ShengsuanyunError(400, '胜算云 API Key 不能为空', 'invalid-request')
    }
    const previous = await this.ctx.credentials.resolve(ref)
    const modelIds = await listChatModels(normalized, signal)
    await this.ctx.credentials.set(ref, normalized)
    try {
      return await this.#afterStore(modelIds, useAsDefault)
    } catch (cause) {
      await this.#putBack(previous?.value)
      throw cause
    }
  }

  async chooseModel(modelId: string, signal: AbortSignal): Promise<void> {
    const token = await this.#token()
    if (token === undefined) throw new ShengsuanyunError(401, '还没有胜算云 API Key', 'invalid-request')
    const modelIds = await listChatModels(token, signal)
    if (!modelIds.includes(modelId)) throw new ShengsuanyunError(422, '这个模型不在当前账号的聊天模型里', 'no-chat-model')
    await selectDefaultModel(this.ctx, modelId)
    for (const session of this.#sessions.values()) {
      if (session.state === 'model-selection-required') this.#finish(session, 'complete')
    }
  }

  async logout(): Promise<void> {
    await this.ctx.credentials.unset(ref)
  }

  async snapshot(signal: AbortSignal): Promise<CredentialSnapshot> {
    const info = await this.ctx.credentials.describe(ref)
    const selected = currentProviderModel(this.ctx)
    if (!info.configured) {
      return {
        configured: false,
        writable: info.writable,
        model: { provider: PROVIDER, ...(selected === undefined ? {} : { id: selected }), ready: false },
      }
    }
    const token = await this.#token()
    const [models, accountName] = await Promise.all([
      token === undefined ? Promise.resolve(undefined) : listChatModels(token, signal).catch(() => undefined),
      token === undefined ? Promise.resolve(undefined) : readAccountName(token, signal),
    ])
    const ready = models !== undefined && selected !== undefined && models.includes(selected)
    return {
      configured: true,
      writable: info.writable,
      ...(token === undefined ? {} : { maskedToken: maskToken(token) }),
      ...(accountName === undefined ? {} : { accountName }),
      model: { provider: PROVIDER, ...(selected === undefined ? {} : { id: selected }), ready },
      ...(models === undefined ? {} : { chatModels: capModelIds(models) }),
    }
  }

  async dispose(): Promise<void> {
    for (const session of this.#sessions.values()) {
      clearTimeout(session.expiryTimer)
      session.controller.abort()
      await this.#restore(session)
    }
    this.#sessions.clear()
  }

  async #finishCredential(session: Session, token: string): Promise<void> {
    session.state = 'verifying'
    try {
      const modelIds = await listChatModels(token, session.controller.signal)
      if (session.controller.signal.aborted) return
      await this.ctx.credentials.set(ref, token)
      session.wrote = true
      session.modelIds = modelIds
      const decision = shouldSelectDefault(session.useAsDefault, modelIds)
      if (decision === 'choose') {
        this.#finish(session, 'model-selection-required')
        return
      }
      if (decision === 'select') await selectDefaultModel(this.ctx, DEFAULT_MODEL)
      if (session.controller.signal.aborted) {
        await this.#restore(session)
        this.#finish(session, 'cancelled', 'authorization-cancelled')
        return
      }
      session.wrote = false
      this.#finish(session, 'complete')
    } catch (cause) {
      if (session.wrote) await this.#restore(session)
      if (session.controller.signal.aborted) this.#finish(session, 'cancelled', 'authorization-cancelled')
      else this.#finish(session, 'failed', reasonOf(cause))
    }
  }

  async #afterStore(modelIds: readonly string[], useAsDefault: boolean): Promise<LoginStatus> {
    const decision = shouldSelectDefault(useAsDefault, modelIds)
    if (decision === 'select') await selectDefaultModel(this.ctx, DEFAULT_MODEL)
    if (decision === 'choose') return { state: 'model-selection-required', models: capModelIds(modelIds) }
    return { state: 'complete' }
  }

  async #token(): Promise<string | undefined> {
    return (await this.ctx.credentials.resolve(ref))?.value
  }

  async #putBack(previous: string | undefined): Promise<void> {
    if (previous === undefined) await this.ctx.credentials.unset(ref)
    else await this.ctx.credentials.set(ref, previous)
  }

  async #restore(session: Session): Promise<void> {
    if (!session.wrote) return
    await this.#putBack(session.previous)
    session.wrote = false
  }

  #open(controller: AbortController, previous: string | undefined, useAsDefault: boolean): Session {
    const id = randomBytes(24).toString('base64url')
    const expiryTimer = setTimeout(() => { void this.#expire(id) }, SESSION_TTL_MS)
    expiryTimer.unref?.()
    const session: Session = {
      id,
      controller,
      previous,
      useAsDefault,
      expiresAt: Date.now() + SESSION_TTL_MS,
      expiryTimer,
      modelIds: [],
      wrote: false,
      state: 'pending',
    }
    this.#sessions.set(id, session)
    return session
  }

  #finish(session: Session, state: LoginState, reason?: ShengsuanyunReason): void {
    if (finalState(session.state)) return
    session.state = state
    if (state === 'complete') session.wrote = false
    if (reason === undefined) delete session.reason
    else session.reason = reason
  }

  async #expire(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (session === undefined) return
    if (!finalState(session.state)) {
      session.controller.abort()
      await this.#restore(session)
      this.#finish(session, 'failed', 'authorization-timeout')
    }
    const removal = setTimeout(() => this.#sessions.delete(sessionId), 60_000)
    removal.unref?.()
  }

  #sweep(): void {
    const now = Date.now()
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now && finalState(session.state)) this.#sessions.delete(id)
    }
  }
}
