import type { Context } from '@deepseek-ai/cordis';
import { PROVIDER } from './constants.js';
import { type ShengsuanyunReason } from './errors.js';
export type LoginState = 'pending' | 'verifying' | 'model-selection-required' | 'complete' | 'cancelled' | 'failed';
export interface LoginStart {
    readonly sessionId: string;
    readonly url: string;
}
export interface LoginStatus {
    readonly state: LoginState;
    readonly reason?: ShengsuanyunReason;
    readonly models?: readonly string[];
}
export interface CredentialSnapshot {
    readonly configured: boolean;
    readonly writable: boolean;
    readonly maskedToken?: string;
    readonly accountName?: string;
    readonly model: {
        readonly provider: typeof PROVIDER;
        readonly id?: string;
        readonly ready: boolean;
    };
    readonly chatModels?: readonly string[];
}
export declare class ShengsuanyunLogin {
    #private;
    private readonly ctx;
    constructor(ctx: Context);
    start(useAsDefault: boolean): Promise<LoginStart>;
    status(sessionId: string): LoginStatus | undefined;
    cancel(sessionId: string): Promise<void>;
    saveToken(token: string, useAsDefault: boolean, signal: AbortSignal): Promise<LoginStatus>;
    chooseModel(modelId: string, signal: AbortSignal): Promise<void>;
    logout(): Promise<void>;
    snapshot(signal: AbortSignal): Promise<CredentialSnapshot>;
    dispose(): Promise<void>;
}
