export type ShengsuanyunReason = 'authorization-cancelled' | 'authorization-timeout' | 'router-validation-failed' | 'no-chat-model' | 'credential-save-failed' | 'invalid-request';
export declare class ShengsuanyunError extends Error {
    readonly status: number;
    readonly reason: ShengsuanyunReason;
    constructor(status: number, message: string, reason: ShengsuanyunReason);
}
export declare function reasonOf(cause: unknown): ShengsuanyunReason;
