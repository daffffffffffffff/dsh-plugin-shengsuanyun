import { DEFAULT_MODEL, MAX_LISTED_MODELS, PROVIDER, type ModelSeed } from './constants.js'

export type ConnectionView = 'unconfigured' | 'model-selection' | 'connected'
export type DefaultModelDecision = 'select' | 'choose' | 'skip'

export function maskToken(token: string): string {
  const normalized = token.trim()
  return normalized.length < 4 ? '····' : `····${normalized.slice(-4)}`
}

/**
 * Whether startup should write the ShengSuanYun route.
 * An existing route is left alone, including a hand-edited base URL.
 */
export function providerNeedsDeclare(section: unknown): boolean {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return true
  const providers = (section as { providers?: unknown }).providers
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return true
  return (providers as Record<string, unknown>)[PROVIDER] === undefined
}

export function shouldSelectDefault(useAsDefault: boolean, modelIds: readonly string[]): DefaultModelDecision {
  if (!useAsDefault) return 'skip'
  return modelIds.includes(DEFAULT_MODEL) ? 'select' : 'choose'
}

/**
 * `id` is set only when the current default already sits on ShengSuanYun.
 * Another provider's default must not trap the page on a model picker.
 */
export function connectionView(status: {
  readonly configured: boolean
  readonly modelReady: boolean
  readonly modelId?: string
}): ConnectionView {
  if (!status.configured) return 'unconfigured'
  if (status.modelReady || status.modelId === undefined) return 'connected'
  return 'model-selection'
}

export function capModelIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids.map(id => id.trim()).filter(id => id !== ''))]
  unique.sort((left, right) => {
    if (left === DEFAULT_MODEL) return -1
    if (right === DEFAULT_MODEL) return 1
    return left.localeCompare(right)
  })
  return unique.slice(0, MAX_LISTED_MODELS)
}

/** Append one chosen model. `undefined` means the catalog already has it. */
export function withRememberedModel<T extends { readonly id: string }>(
  existing: readonly T[] | undefined,
  modelId: string,
  seed: ModelSeed,
): readonly (T | ModelSeed)[] | undefined {
  const models = existing ?? []
  if (models.some(model => model.id === modelId)) return undefined
  return [...models, seed]
}
