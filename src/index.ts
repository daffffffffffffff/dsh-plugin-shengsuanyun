import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { ShengsuanyunLogin } from './login.js'
import { mountMarket } from './market/index.js'
import { ensureProvider } from './provider.js'
import { registerRoutes } from './routes.js'

export const name = 'shengsuanyun'
export const inject = ['webServer', 'credentials', 'agentDefaultModel', 'settings']

export function apply(ctx: Context): void {
  const login = new ShengsuanyunLogin(ctx)
  ctx.effect(() => {
    void ensureProvider(ctx).catch((error: unknown) => {
      ctx.logger.error('shengsuanyun: provider route was not declared')
      ctx.logger.error(error)
    })
    const disposeRoutes = registerRoutes(ctx, login)
    return async () => {
      disposeRoutes()
      await login.dispose()
    }
  }, 'shengsuanyun: configuration')
  // The market waits for the desktop services. An older dsh keeps the login page
  // and leaves this fiber pending instead of failing the whole plugin.
  ctx.inject(['tools', 'systemPrompt', 'authorization'], (marketCtx: Context) => {
    mountMarket(marketCtx)
  })
}
