import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  type LoginState,
  type ShengsuanyunStatus,
  cancelLogin,
  chooseModel,
  logout,
  readLogin,
  readStatus,
  reasonText,
  saveToken,
  startLogin,
} from './api.js'

type Stage = 'loading' | 'unconfigured' | 'authorizing' | 'model-selection' | 'connected'

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() !== '' ? cause.message : '没有完成，请重试'
}

export function ShengsuanyunSettings(_props: { readonly close: () => void }) {
  const [stage, setStage] = useState<Stage>('loading')
  const [status, setStatus] = useState<ShengsuanyunStatus | undefined>()
  const [loginState, setLoginState] = useState<LoginState>('pending')
  const [models, setModels] = useState<readonly string[]>([])
  const [picked, setPicked] = useState('')
  const [token, setToken] = useState('')
  const [useAsDefault, setUseAsDefault] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [blocked, setBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef<string | undefined>()
  const urlRef = useRef<string | undefined>()
  const pollRef = useRef<AbortController | undefined>()
  const keepSession = useRef(false)
  const errorId = useId()

  const stopPolling = useCallback((cancelRemote: boolean) => {
    pollRef.current?.abort()
    pollRef.current = undefined
    const sessionId = sessionRef.current
    sessionRef.current = undefined
    urlRef.current = undefined
    if (cancelRemote && !keepSession.current && sessionId !== undefined) void cancelLogin(sessionId).catch(() => undefined)
  }, [])

  const refresh = useCallback(async () => {
    setStage('loading')
    setError(undefined)
    try {
      const next = await readStatus()
      setStatus(next)
      setPicked(next.chatModels?.[0] ?? next.model.id ?? '')
      if (!next.configured) {
        setStage('unconfigured')
        return
      }
      if (next.model.id !== undefined && !next.model.ready) {
        setModels(next.chatModels ?? [])
        setPicked(next.chatModels?.[0] ?? '')
        setStage('model-selection')
        return
      }
      setStage('connected')
    } catch (cause) {
      setStage('unconfigured')
      setError(messageOf(cause))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => () => { stopPolling(true) }, [stopPolling])

  const poll = useCallback(async (sessionId: string, controller: AbortController) => {
    try {
      for (;;) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, 500)
          controller.signal.addEventListener('abort', () => {
            window.clearTimeout(timer)
            reject(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        })
        const next = await readLogin(sessionId, controller.signal)
        setLoginState(next.state)
        if (next.state === 'pending' || next.state === 'verifying') continue
        pollRef.current = undefined
        if (next.state === 'complete') {
          sessionRef.current = undefined
          urlRef.current = undefined
          keepSession.current = false
          await refresh()
          return
        }
        if (next.state === 'model-selection-required') {
          keepSession.current = true
          setModels(next.models ?? [])
          setPicked(next.models?.[0] ?? '')
          setStage('model-selection')
          return
        }
        sessionRef.current = undefined
        setStage('unconfigured')
        setError(reasonText(next.reason))
        return
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setStage('unconfigured')
      setError(messageOf(cause))
    }
  }, [refresh])

  const signIn = useCallback(async () => {
    stopPolling(true)
    keepSession.current = false
    setError(undefined)
    setBlocked(false)
    setBusy(true)
    try {
      const login = await startLogin(useAsDefault)
      sessionRef.current = login.sessionId
      urlRef.current = login.url
      const popup = window.open(login.url, '_blank', 'noopener,noreferrer')
      setBlocked(popup === null)
      const controller = new AbortController()
      pollRef.current = controller
      setLoginState('pending')
      setStage('authorizing')
      void poll(login.sessionId, controller)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [poll, stopPolling, useAsDefault])

  const paste = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await saveToken(token, useAsDefault)
      setToken('')
      if (result.state === 'model-selection-required') {
        setModels(result.models ?? [])
        setPicked(result.models?.[0] ?? '')
        setStage('model-selection')
        return
      }
      await refresh()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [refresh, token, useAsDefault])

  const applyModel = useCallback(async (model: string) => {
    if (model === '') return
    setBusy(true)
    setError(undefined)
    try {
      await chooseModel(model)
      keepSession.current = false
      sessionRef.current = undefined
      await refresh()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const disconnect = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      await logout()
      await refresh()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const copyLink = useCallback(async () => {
    const url = urlRef.current
    if (url === undefined) return
    try {
      await navigator.clipboard.writeText(url)
      setError(undefined)
    } catch {
      setError('没能复制登录链接')
    }
  }, [])

  const locked = status?.configured === true && status.writable === false

  return (
    <section className="ssyRoot">
      <div>
        <h2>胜算云</h2>
        <p className="ssyLead">把胜算云接成这个 dsh 的聊天模型。密钥只存在本机凭据里，页面上只显示末四位。</p>
      </div>
      {error !== undefined ? <p className="ssyError" id={errorId}>{error}</p> : null}
      {stage === 'loading' ? <p className="ssyNote">正在确认连接…</p> : null}
      {stage === 'authorizing' ? (
        <div className="ssyCard">
          <p className="ssyOk">{loginState === 'verifying' ? '正在验证密钥…' : '请在浏览器里完成胜算云登录。'}</p>
          {blocked ? <p className="ssyNote">浏览器拦截了新窗口。</p> : null}
          <div className="ssyRow">
            {blocked ? <button type="button" onClick={() => { void copyLink() }}>复制登录链接</button> : null}
            <button type="button" onClick={() => { stopPolling(true); setStage('unconfigured') }}>取消</button>
          </div>
        </div>
      ) : null}
      {stage === 'connected' && status !== undefined ? (
        <div className="ssyCard">
          <p className="ssyOk">{status.accountName ?? '已连接'}{status.maskedToken === undefined ? '' : ` · ${status.maskedToken}`}</p>
          <p className="ssyNote">
            {status.model.ready
              ? `新建对话使用 ${status.model.id ?? '胜算云'}。`
              : '密钥已保存。新建对话仍用现在的默认模型。'}
          </p>
          {locked ? <p className="ssyNote">密钥来自环境变量 SHENGSUANYUN_API_KEY，这里不能改。</p> : null}
          {!status.model.ready && (status.chatModels?.length ?? 0) > 0 ? (
            <label className="ssyField">
              <span>改用胜算云模型</span>
              <select value={picked} onChange={event => setPicked(event.target.value)}>
                {(status.chatModels ?? []).map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
          ) : null}
          <div className="ssyRow">
            {!status.model.ready && picked !== '' ? (
              <button className="ssyPrimary" type="button" disabled={busy} onClick={() => { void applyModel(picked) }}>新建对话改用这个模型</button>
            ) : null}
            <button type="button" disabled={busy || locked} onClick={() => { void disconnect() }}>断开</button>
          </div>
        </div>
      ) : null}
      {stage === 'model-selection' ? (
        <div className="ssyCard">
          <p className="ssyOk">密钥已验证。当前账号里没有默认模型 deepseek-v4-flash，请选一个聊天模型。</p>
          <label className="ssyField">
            <span>聊天模型</span>
            <select value={picked} onChange={event => setPicked(event.target.value)}>
              {models.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <div className="ssyRow">
            <button className="ssyPrimary" type="button" disabled={busy || picked === ''} onClick={() => { void applyModel(picked) }}>设为新建对话的模型</button>
            <button type="button" disabled={busy || locked} onClick={() => { void disconnect() }}>断开</button>
          </div>
        </div>
      ) : null}
      {stage === 'unconfigured' ? (
        <div className="ssyCard">
          <label className="ssyCheck">
            <input type="checkbox" checked={useAsDefault} onChange={event => setUseAsDefault(event.target.checked)} />
            <span>连上之后，新建对话改用胜算云的 DeepSeek V4 Flash。已经开着的对话不变。</span>
          </label>
          <div className="ssyRow">
            <button className="ssyPrimary" type="button" disabled={busy || locked} onClick={() => { void signIn() }}>在浏览器中登录胜算云</button>
          </div>
          <label className="ssyField">
            <span>或者粘贴 API Key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              aria-describedby={error === undefined ? undefined : errorId}
              onChange={event => setToken(event.target.value)}
            />
          </label>
          <div className="ssyRow">
            <button type="button" disabled={busy || locked || token.trim() === ''} onClick={() => { void paste() }}>保存密钥</button>
          </div>
          {locked ? <p className="ssyNote">环境变量 SHENGSUANYUN_API_KEY 已经提供密钥，这里不能再写一把。</p> : null}
        </div>
      ) : null}
    </section>
  )
}
