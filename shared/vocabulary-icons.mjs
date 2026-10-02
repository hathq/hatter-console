// Added by the Hatter downstream project, 2026.
// Purpose: render a closed semantic icon vocabulary without accepting executable UI.
const VOCABULARY_ICONS = Object.freeze(['generic', 'entity', 'identity', 'person',
  'people', 'organization', 'place', 'jurisdiction', 'language', 'biology', 'health', 'time',
  'event', 'state', 'action', 'reason', 'relation', 'evidence', 'source', 'resource', 'asset',
  'money', 'accounting', 'work', 'repository', 'software', 'communication', 'service',
  'credential', 'model', 'hat', 'layer', 'namespace', 'directory', 'file', 'decision', 'contract'])

const ICON_NAMES = Object.freeze({ generic: 'i-lucide-circle-dot', entity: 'i-lucide-box',
  identity: 'i-lucide-fingerprint', person: 'i-lucide-user-round', people: 'i-lucide-users',
  organization: 'i-lucide-building-2', place: 'i-lucide-map-pin', jurisdiction: 'i-lucide-landmark',
  language: 'i-lucide-languages', biology: 'i-lucide-dna', health: 'i-lucide-heart-pulse',
  time: 'i-lucide-clock-3', event: 'i-lucide-calendar-clock', state: 'i-lucide-activity',
  action: 'i-lucide-play', reason: 'i-lucide-message-circle-question-mark',
  relation: 'i-lucide-share-2', evidence: 'i-lucide-badge-check', source: 'i-lucide-database',
  resource: 'i-lucide-boxes', asset: 'i-lucide-landmark', money: 'i-lucide-wallet-cards',
  accounting: 'i-lucide-receipt-text', work: 'i-lucide-briefcase-business',
  repository: 'i-lucide-folder-git-2', software: 'i-lucide-code-xml',
  communication: 'i-lucide-messages-square', service: 'i-lucide-plug',
  credential: 'i-lucide-key-round', model: 'i-lucide-brain-circuit', hat: 'i-lucide-puzzle',
  layer: 'i-lucide-layers-3', namespace: 'i-lucide-folder-tree', directory: 'i-lucide-folder',
  file: 'i-lucide-file', decision: 'i-lucide-scale', contract: 'i-lucide-file-signature' })
const ICON_SET = new Set(VOCABULARY_ICONS)

export function isVocabularyIcon(value) {
  return typeof value === 'string' && ICON_SET.has(value)
}
export function resolveVocabularyIcon(value, fallback = 'generic') {
  return ICON_NAMES[isVocabularyIcon(value) ? value : fallback]
}
