import { type ModelSeed } from './constants.js';
export type ConnectionView = 'unconfigured' | 'model-selection' | 'connected';
export type DefaultModelDecision = 'select' | 'choose' | 'skip';
export declare function maskToken(token: string): string;
/**
 * Whether startup should write the ShengSuanYun route.
 * An existing route is left alone, including a hand-edited base URL.
 */
export declare function providerNeedsDeclare(section: unknown): boolean;
export declare function shouldSelectDefault(useAsDefault: boolean, modelIds: readonly string[]): DefaultModelDecision;
/**
 * `id` is set only when the current default already sits on ShengSuanYun.
 * Another provider's default must not trap the page on a model picker.
 */
export declare function connectionView(status: {
    readonly configured: boolean;
    readonly modelReady: boolean;
    readonly modelId?: string;
}): ConnectionView;
export declare function capModelIds(ids: readonly string[]): string[];
/** Append one chosen model. `undefined` means the catalog already has it. */
export declare function withRememberedModel<T extends {
    readonly id: string;
}>(existing: readonly T[] | undefined, modelId: string, seed: ModelSeed): readonly (T | ModelSeed)[] | undefined;
