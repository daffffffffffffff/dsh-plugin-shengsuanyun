import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { LLM_SETTINGS, PROVIDER, defaultProviderProfile, modelSeed } from './constants.js'
import { providerNeedsDeclare, withRememberedModel } from './flow.js'

const LLM_NS = settingsNamespace(LLM_SETTINGS)

interface StoredSection {
  readonly providers?: Readonly<Record<string, { readonly models?: readonly { readonly id: string }[] }>>
}

function modelsOf(section: unknown): readonly { readonly id: string }[] | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  const models = (section as StoredSection).providers?.[PROVIDER]?.models
  if (!Array.isArray(models)) return undefined
  return models.filter((item): item is { readonly id: string } =>
    typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string')
}

/** Add the desktop route once. A route that is already there is not rewritten. */
export async function ensureProvider(ctx: Context): Promise<void> {
  const current = ctx.settings.get(LLM_NS)
  if (current === undefined) {
    ctx.logger.warn('shengsuanyun: llm-pi-ai settings are not registered, so the provider route was not added')
    return
  }
  if (!providerNeedsDeclare(current)) return
  await ctx.settings.update(LLM_NS, { providers: { [PROVIDER]: defaultProviderProfile() } })
  ctx.logger.info('shengsuanyun: declared provider route shengsuanyun')
}

/** Put a chosen chat model on the route without dropping models already listed. */
export async function rememberModel(ctx: Context, modelId: string): Promise<void> {
  const next = withRememberedModel(modelsOf(ctx.settings.get(LLM_NS)), modelId, modelSeed(modelId))
  if (next === undefined) return
  await ctx.settings.update(LLM_NS, { providers: { [PROVIDER]: { models: next } } })
}

export async function selectDefaultModel(ctx: Context, modelId: string): Promise<void> {
  await rememberModel(ctx, modelId)
  await ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: modelId })
}

export function currentProviderModel(ctx: Context): string | undefined {
  const selection = ctx.agentDefaultModel.currentSelection()
  return selection.provider === PROVIDER ? selection.model : undefined
}
