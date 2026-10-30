/** Display name from the account payload. Anything else stays on the host. */
export declare function accountDisplayName(payload: unknown): string | undefined;
/** Best-effort nickname. A failure leaves the connection usable. */
export declare function readAccountName(token: string, signal: AbortSignal): Promise<string | undefined>;
