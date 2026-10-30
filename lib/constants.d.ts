export declare const PROVIDER = "shengsuanyun";
export declare const DISPLAY_NAME = "\u80DC\u7B97\u4E91";
export declare const API_KEY_ENV = "SHENGSUANYUN_API_KEY";
export declare const DEFAULT_MODEL = "deepseek-v4-flash";
export declare const ROUTER_BASE_URL = "https://router.shengsuanyun.com/api/v1";
export declare const ROUTER_MODELS_URL = "https://router.shengsuanyun.com/api/v1/models";
export declare const AUTH_PAGE_URL = "https://router.shengsuanyun.com/auth";
export declare const ACCOUNT_KEYS_URL = "https://api.shengsuanyun.com/auth/keys";
export declare const ACCOUNT_INFO_URL = "https://api.shengsuanyun.com/user/info";
/** App channel the ShengSuanYun authorization page expects. */
export declare const AUTH_CHANNEL = "CH_B51KXQ98";
export declare const LLM_SETTINGS = "llm-pi-ai";
export declare const API_PREFIX = "/api/shengsuanyun";
export declare const MODEL_CONTEXT_WINDOW = 128000;
export declare const MODEL_MAX_TOKENS = 32768;
export declare const MAX_LISTED_MODELS = 100;
export interface ProviderProfile {
    readonly displayName: string;
    readonly apiKeyEnv: string;
    readonly api: 'openai-completions';
    readonly baseURL: string;
    readonly models: readonly [ModelSeed];
}
export interface ModelSeed {
    readonly id: string;
    readonly name: string;
    readonly contextWindow: number;
    readonly maxTokens: number;
    readonly input: readonly ['text'];
}
export declare function modelSeed(id: string, name?: string): ModelSeed;
/** The route LoomLoom Desktop preconfigures for chat. */
export declare function defaultProviderProfile(): ProviderProfile;
