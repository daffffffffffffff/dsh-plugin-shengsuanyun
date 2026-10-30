import type { Context } from '@deepseek-ai/cordis';
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client';
export declare const inject: string[];
export declare function apply(ctx: Context & {
    readonly slots: SlotRegistry;
}): void;
