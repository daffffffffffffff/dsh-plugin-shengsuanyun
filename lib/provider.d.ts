import type { Context } from '@deepseek-ai/cordis';
/** Add the desktop route once. A route that is already there is not rewritten. */
export declare function ensureProvider(ctx: Context): Promise<void>;
/** Put a chosen chat model on the route without dropping models already listed. */
export declare function rememberModel(ctx: Context, modelId: string): Promise<void>;
export declare function selectDefaultModel(ctx: Context, modelId: string): Promise<void>;
export declare function currentProviderModel(ctx: Context): string | undefined;
