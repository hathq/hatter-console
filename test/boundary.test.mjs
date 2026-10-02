import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessRequestBoundary,
  parseOwnerOrigin,
  securityHeaders
} from '@crowsi/browser-security/boundary'

test('accepts only exact loopback and WebAuthn localhost origins', () => {
  assert.equal(parseOwnerOrigin('http://127.0.0.1:4204').host, '127.0.0.1:4204')
  assert.equal(parseOwnerOrigin('http://localhost:4204').host, 'localhost:4204')
  assert.equal(parseOwnerOrigin('http://[::1]:4204').host, '[::1]:4204')
  for (const value of [
    'http://localhost', 'http://0.0.0.0:4204',
    'https://example.invalid', 'http://127.0.0.1:4204/path'
  ]) assert.throws(() => parseOwnerOrigin(value), /origin-invalid/)
})

test('accepts same-port loopback aliases but keeps mutation origin exact', () => {
  const owner = parseOwnerOrigin('http://127.0.0.1:4204')
  assert.equal(assessRequestBoundary(owner, {
    method: 'POST', host: owner.host, origin: owner.origin, fetchSite: 'same-origin'
  }), null)
  assert.equal(assessRequestBoundary(owner, {
    method: 'POST', host: owner.host, origin: null, fetchSite: null
  }), 'crowsi-browser-security-origin-required')
  assert.equal(assessRequestBoundary(owner, {
    method: 'GET', host: 'localhost:4204', origin: null, fetchSite: null
  }), null)
  assert.equal(assessRequestBoundary(owner, {
    method: 'GET', host: '[::1]:4204', origin: null, fetchSite: null
  }), null)
  assert.equal(assessRequestBoundary(owner, {
    method: 'POST', host: 'localhost:4204', origin: owner.origin, fetchSite: 'same-origin'
  }), null)
  assert.equal(assessRequestBoundary(owner, {
    method: 'POST', host: 'localhost:4204', origin: 'http://localhost:4204',
    fetchSite: 'same-origin'
  }), 'crowsi-browser-security-origin-rejected')
  for (const host of [
    'localhost:4205', 'example.invalid:4204', 'localhost',
    'localhost:04204', 'user@localhost:4204', 'localhost:4204,example.invalid'
  ]) assert.equal(assessRequestBoundary(owner, {
    method: 'GET', host, origin: null, fetchSite: null
  }), 'crowsi-browser-security-host-rejected')
})

test('sets a closed CSP and never emits CORS headers', () => {
  const headers = securityHeaders()
  assert.match(headers['content-security-policy'], /connect-src 'self'/)
  assert.equal(headers['x-frame-options'], 'DENY')
  assert.equal('access-control-allow-origin' in headers, false)
})

test('rejects every cross-site request because device flow has no callback', () => {
  const owner = parseOwnerOrigin('http://127.0.0.1:4204')
  assert.equal(assessRequestBoundary(owner, { method: 'GET', host: owner.host,
    origin: null, fetchSite: 'cross-site', path: '/api/connections/github' }),
  'crowsi-browser-security-fetch-site-rejected')
})
