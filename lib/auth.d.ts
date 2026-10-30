export interface BrowserCredential {
    readonly apiKey: string;
}
interface ExchangeEnvelope {
    readonly code?: unknown;
    readonly data?: unknown;
    readonly jwt_token?: unknown;
}
/** Pull the shared API key out of the authorization exchange body. */
export declare function credentialFromEnvelope(payload: ExchangeEnvelope): BrowserCredential | undefined;
export declare function authorizeUrl(authPageUrl: string, callbackUrl: string, state: string, verifier: string): string;
export interface BrowserAuthorization {
    readonly url: string;
    readonly result: Promise<BrowserCredential>;
}
/** One loopback login. The verifier stays in this process. */
export declare function beginBrowserAuthorization(signal: AbortSignal): Promise<BrowserAuthorization>;
export {};
