// Hatter downstream 2026: mechanical projection of the Graph owner's public control references.
export function commitRevision(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'commit,sequence'
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || (value.sequence === 0 ? value.commit !== null : !/^[a-f0-9]{64}$/.test(value.commit))) {
    throw new Error('hatter-console-control-reference-invalid')
  }
  return { sequence:value.sequence, commit:value.commit }
}
export function publicationIntent(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'expected_commit_revision,operation_id'
    || typeof value.operation_id !== 'string' || !value.operation_id.length || value.operation_id.length > 256
    || /[\s\x00-\x1f]/u.test(value.operation_id)) {
    throw new Error('hatter-console-control-reference-invalid')
  }
  return { operation_id:value.operation_id, expected_commit_revision:commitRevision(value.expected_commit_revision) }
}
// A user gesture is identified by its complete normalized form and exact observed base.
// Transport retries retain this same intent. No timestamp/random canonical identity.
export async function createPublicationIntent(kind, input, base) {
  const revision=commitRevision(base)
  const bytes=new TextEncoder().encode(JSON.stringify([kind,revision,input]))
  if (bytes.length > 1_048_576) throw new Error('hatter-console-control-reference-invalid')
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes)
  return publicationIntent({ operation_id:Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join(''),
    expected_commit_revision:revision })
}
