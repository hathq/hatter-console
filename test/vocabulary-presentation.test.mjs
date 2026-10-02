import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveVocabularyIcon } from '../shared/vocabulary-icons.mjs'
import { vocabularyPresentation } from '../shared/vocabulary-presentation.mjs'

test('uses declarations before canonical, inherited, and kind defaults', () => {
  assert.deepEqual(vocabularyPresentation({ semanticIcon: 'contract',
    canonicalTerm: 'domain.software.repository', kind: 'resource' }),
  { semanticIcon: 'contract', iconSource: 'declared' })
  assert.deepEqual(vocabularyPresentation({ canonicalTerm: 'domain.software.repository',
    kind: 'resource' }), { semanticIcon: 'repository', iconSource: 'canonical' })
  assert.deepEqual(vocabularyPresentation({ inheritedIcon: 'directory', kind: 'namespace' }),
    { semanticIcon: 'directory', iconSource: 'inherited' })
  assert.deepEqual(vocabularyPresentation({ kind: 'event' }),
    { semanticIcon: 'event', iconSource: 'kind' })
})

test('rejects icon implementation injection and resolves only local names', () => {
  assert.throws(() => vocabularyPresentation({ semanticIcon: 'i-lucide-github' }),
    /hatter-console-semantic-icon-invalid/u)
  assert.equal(resolveVocabularyIcon('repository'), 'i-lucide-folder-git-2')
  assert.equal(resolveVocabularyIcon('i-lucide-github'), 'i-lucide-circle-dot')
})
