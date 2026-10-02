// Hatter: independent display examples; locale must never change canonical identity.
import assert from 'node:assert/strict'
import test from 'node:test'
import { declarationLabel } from '../shared/declaration-label.mjs'
test('declared labels support locale variants and English fallback without guessing', () => {
  const labels = { en: 'Identity', ja: '基本情報', fr: 'Identité', 'fr-CA': 'Identité locale' }
  const before = structuredClone(labels)
  for (const [locale, expected] of [['ja-JP', '基本情報'], ['fr-CA', 'Identité locale'],
    ['fr-FR', 'Identité'], ['ar', 'Identity'], ['en-US', 'Identity']]) {
    assert.equal(declarationLabel(labels, locale), expected)
  }
  assert.deepEqual(labels, before)
  assert.throws(() => declarationLabel({ ja: '基本情報' }, 'ar'), /semantic-label-missing/u)
})
