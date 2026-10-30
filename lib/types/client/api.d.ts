export interface ShengsuanyunStatus {
    readonly configured: boolean;
    readonly writable: boolean;
    readonly maskedToken?: string;
    readonly accountName?: string;
    readonly model: {
        readonly provider: 'shengsuanyun';
        readonly id?: string;
        readonly ready: boolean;
    };
    readonly chatModels?: readonly string[];
}
export type LoginState = 'pending' | 'verifying' | 'model-selection-required' | 'complete' | 'cancelled' | 'failed';
export interface LoginStart {
    readonly sessionId: string;
    readonly url: string;
}
export interface LoginStatus {
    readonly state: LoginState;
    readonly reason?: string;
    readonly models?: readonly string[];
}
export declare class ShengsuanyunClientError extends Error {
    readonly reason?: string | undefined;
    constructor(message: string, reason?: string | undefined);
}
export declare function readStatus(signal?: AbortSignal): Promise<ShengsuanyunStatus>;
export declare function startLogin(useAsDefault: boolean, signal?: AbortSignal): Promise<LoginStart>;
export declare function readLogin(sessionId: string, signal?: AbortSignal): Promise<LoginStatus>;
export declare function cancelLogin(sessionId: string): Promise<void>;
export declare function saveToken(token: string, useAsDefault: boolean): Promise<LoginStatus>;
export declare function chooseModel(model: string): Promise<void>;
export declare function logout(): Promise<void>;
export declare function reasonText(reason: string | undefined): string;
