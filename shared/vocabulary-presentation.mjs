// Added by the Hatter downstream project, 2026.
// Purpose: map verified vocabulary structure to closed semantic presentation tokens.
import { isVocabularyIcon } from './vocabulary-icons.mjs'

const CANONICAL = [
  ['domain.software.version-control.git', 'repository'],
  ['domain.systems-engineering.version-control', 'repository'],
  ['domain.systems-engineering', 'software'],
  ['world.digital-service', 'service'],
  ['world.person.profile.language', 'language'],
  ['world.person.profile.residence', 'place'],
  ['world.person.profile.jurisdiction', 'jurisdiction'],
  ['world.person.profile.health', 'health'], ['world.person.profile.biology', 'biology'],
  ['world.person.profile.identity', 'identity'], ['world.person.profile.position', 'people'],
  ['world.person.profile', 'person'],
  ['world.person.identity', 'identity'], ['world.person.biology', 'biology'],
  ['world.person.relationship', 'people'], ['domain.software.repository', 'repository'],
  ['jurisdiction.jp.accounting', 'accounting'], ['jurisdiction.jp.tax', 'money'],
  ['jurisdiction.jp.legal', 'jurisdiction'], ['jurisdiction.jp.social-system', 'jurisdiction'],
  ['core.identifier', 'identity'], ['core.relation', 'relation'], ['core.assertion', 'evidence'],
  ['core.event', 'event'], ['core.state', 'state'], ['core.evidence', 'evidence'],
  ['core.source', 'source'], ['core.time', 'time'], ['core.space', 'place'],
  ['world.person', 'person'], ['world.organization', 'organization'], ['world.place', 'place'],
  ['world.resource', 'resource'], ['world.asset', 'asset'], ['domain.finance', 'money'],
  ['domain.accounting', 'accounting'], ['domain.work', 'work'],
  ['domain.communication', 'communication'], ['domain.software', 'software'],
  ['domain.health', 'health'], ['jurisdiction', 'jurisdiction'], ['core.entity', 'entity'],
  ['core.type', 'entity'], ['core.quantity', 'generic'], ['core.unit', 'generic']
].sort((left, right) => right[0].length - left[0].length)

const KIND = { entity: 'entity', concept: 'entity', resource: 'resource', action: 'action',
  event: 'event', state: 'state', reason: 'reason', relation: 'relation', layer: 'layer',
  namespace: 'namespace' }

export function vocabularyPresentation({ semanticIcon, canonicalTerm, kind, inheritedIcon } = {}) {
  if (semanticIcon !== undefined && semanticIcon !== null) {
    if (!isVocabularyIcon(semanticIcon)) invalid()
    return { semanticIcon, iconSource: 'declared' }
  }
  if (typeof canonicalTerm === 'string') {
    const match = CANONICAL.find(([prefix]) => canonicalTerm === prefix
      || canonicalTerm.startsWith(`${prefix}.`))
    if (match) return { semanticIcon: match[1], iconSource: 'canonical' }
  }
  if (isVocabularyIcon(inheritedIcon)) {
    return { semanticIcon: inheritedIcon, iconSource: 'inherited' }
  }
  return { semanticIcon: KIND[kind] ?? 'generic', iconSource: 'kind' }
}

function invalid() { throw new Error('hatter-console-semantic-icon-invalid') }
