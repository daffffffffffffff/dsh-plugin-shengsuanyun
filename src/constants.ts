export const PROVIDER = 'shengsuanyun'
export const DISPLAY_NAME = '胜算云'
export const API_KEY_ENV = 'SHENGSUANYUN_API_KEY'
export const DEFAULT_MODEL = 'deepseek-v4-flash'
export const ROUTER_BASE_URL = 'https://router.shengsuanyun.com/api/v1'
export const ROUTER_MODELS_URL = `${ROUTER_BASE_URL}/models`
export const AUTH_PAGE_URL = 'https://router.shengsuanyun.com/auth'
export const ACCOUNT_KEYS_URL = 'https://api.shengsuanyun.com/auth/keys'
export const ACCOUNT_INFO_URL = 'https://api.shengsuanyun.com/user/info'
/** App channel the ShengSuanYun authorization page expects. */
export const AUTH_CHANNEL = 'CH_B51KXQ98'
export const LLM_SETTINGS = 'llm-pi-ai'
export const API_PREFIX = '/api/shengsuanyun'
export const MODEL_CONTEXT_WINDOW = 128_000
export const MODEL_MAX_TOKENS = 32_768
export const MAX_LISTED_MODELS = 100

export interface ProviderProfile {
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly api: 'openai-completions'
  readonly baseURL: string
  readonly models: readonly [ModelSeed]
}

export interface ModelSeed {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly input: readonly ['text']
}

export function modelSeed(id: string, name = id): ModelSeed {
  return {
    id,
    name,
    contextWindow: MODEL_CONTEXT_WINDOW,
    maxTokens: MODEL_MAX_TOKENS,
    input: ['text'],
  }
}

/** The route LoomLoom Desktop preconfigures for chat. */
export function defaultProviderProfile(): ProviderProfile {
  return {
    displayName: DISPLAY_NAME,
    apiKeyEnv: API_KEY_ENV,
    api: 'openai-completions',
    baseURL: ROUTER_BASE_URL,
    models: [modelSeed(DEFAULT_MODEL, 'DeepSeek V4 Flash')],
  }
}
