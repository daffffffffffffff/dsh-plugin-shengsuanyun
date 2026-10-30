import assert from 'node:assert/strict'
import test from 'node:test'
import { accountDisplayName } from '../src/account.ts'
import { connectionView, maskToken, providerNeedsDeclare, shouldSelectDefault, withRememberedModel } from '../src/flow.ts'
import { modelSeed } from '../src/constants.ts'

test('masks everything but the last four characters', () => {
  assert.equal(maskToken('sk-abcdef'), '····cdef')
  assert.equal(maskToken('ab'), '····')
})

test('does not rewrite a route that already exists', () => {
  assert.equal(providerNeedsDeclare({ providers: { shengsuanyun: { baseURL: 'https://beta.example' } } }), false)
  assert.equal(providerNeedsDeclare({ providers: { openai: {} } }), true)
  assert.equal(providerNeedsDeclare(undefined), true)
})

test('selects the desktop default only when asked and the account has it', () => {
  assert.equal(shouldSelectDefault(true, ['deepseek-v4-flash', 'other']), 'select')
  assert.equal(shouldSelectDefault(true, ['other']), 'choose')
  assert.equal(shouldSelectDefault(false, ['deepseek-v4-flash']), 'skip')
})

test('another default model does not open the picker', () => {
  assert.equal(connectionView({ configured: true, modelReady: false }), 'connected')
  assert.equal(connectionView({ configured: true, modelReady: false, modelId: 'deepseek-v4-flash' }), 'model-selection')
  assert.equal(connectionView({ configured: false, modelReady: false }), 'unconfigured')
})

test('appends a chosen model and leaves an existing catalog untouched', () => {
  const existing = [{ id: 'kept', contextWindow: 1 }]
  assert.equal(withRememberedModel(existing, 'kept', modelSeed('kept')), undefined)
  assert.deepEqual(withRememberedModel(existing, 'added', modelSeed('added')), [
    existing[0],
    modelSeed('added'),
  ])
})

test('reads the nickname from the account envelope', () => {
  assert.equal(accountDisplayName({ code: 0, data: { Nickname: '胜算云昵称' } }), '胜算云昵称')
})
