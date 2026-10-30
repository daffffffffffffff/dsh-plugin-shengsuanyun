import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeUrl, credentialFromEnvelope } from '../src/auth.ts'

test('reads the api key from the nested exchange envelope', () => {
  assert.deepEqual(credentialFromEnvelope({
    code: 0,
    data: { data: { api_key: ' sk-test ', jwt_token: 'jwt' } },
  }), { apiKey: 'sk-test' })
})

test('falls back to a jwt when that is the only credential', () => {
  assert.deepEqual(credentialFromEnvelope({ code: '0', jwt_token: 'only-jwt' }), { apiKey: 'only-jwt' })
})

test('rejects an exchange that succeeded without a credential', () => {
  assert.equal(credentialFromEnvelope({ code: 0, data: {} }), undefined)
})

test('authorize url carries the loopback callback and the code challenge', () => {
  const url = new URL(authorizeUrl(
    'https://router.shengsuanyun.com/auth',
    'http://127.0.0.1:9/callback?state=abc',
    'abc',
    'verifier',
  ))
  assert.equal(url.searchParams.get('callback_url'), 'http://127.0.0.1:9/callback?state=abc')
  assert.equal(url.searchParams.get('state'), 'abc')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('from'), 'CH_B51KXQ98')
  assert.ok((url.searchParams.get('code_challenge') ?? '').length > 10)
})
