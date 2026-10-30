import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ShengsuanyunSettings } from './SettingsSection.js'
import { installStyles } from './styles.js'

export const inject = ['slots']

export function apply(ctx: Context & { readonly slots: SlotRegistry }): void {
  ctx.effect(() => installStyles(), 'shengsuanyun: styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'shengsuanyun',
    order: 25,
    label: '胜算云',
  }, ShengsuanyunSettings))
}
