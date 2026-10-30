/** Chat model ids from a ShengSuanYun router `/models` payload. */
export declare function routerModelIds(payload: unknown): readonly string[];
/** Host-only check that this key can list chat models. The key never leaves this function. */
export declare function listChatModels(token: string, signal: AbortSignal): Promise<readonly string[]>;
