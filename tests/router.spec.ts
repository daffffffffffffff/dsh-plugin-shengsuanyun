import assert from 'node:assert/strict'
import test from 'node:test'
import { routerModelIds } from '../src/router.ts'
import { ShengsuanyunError } from '../src/errors.ts'

test('keeps chat models and drops models that say they are not chat', () => {
  assert.deepEqual(routerModelIds({
    data: [
      { id: 'image-only', supported_generation_methods: ['images'] },
      { id: ' deepseek-v4-flash ' },
      { id: 'chat-ready', capabilities: ['chat-completions'] },
    ],
  }), ['deepseek-v4-flash', 'chat-ready'])
})

test('rejects an empty catalog', () => {
  assert.throws(() => routerModelIds({ data: [] }), (error: unknown) =>
    error instanceof ShengsuanyunError && error.reason === 'no-chat-model')
})

test('rejects a payload without a model list', () => {
  assert.throws(() => routerModelIds({ models: [] }), (error: unknown) =>
    error instanceof ShengsuanyunError && error.reason === 'router-validation-failed')
})
