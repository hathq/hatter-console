// Added by the Hatter downstream project, 2026.
// Purpose: expose bounded catalog-source settings without disclosing local paths.
import { assertSafeProjection } from './projection.mjs'

const TOKEN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u
const KEY = /^[0-9a-f]{64}$/u

export function projectCatalogSources(value) {
  const registry = value?.registry
  if (registry?.schema !== 'hatter://hat/catalog-source-registry/v1'
    || !Number.isSafeInteger(registry?.revision) || registry.revision < 0
    || !TOKEN.test(registry?.selectedSourceId)
    || !Array.isArray(registry?.sources) || registry.sources.length < 1
    || registry.sources.length > 16) invalid()
  const sources = registry.sources.map(source => {
    validateSource(source)
    return {
      sourceId: source.sourceId,
      label: source.label,
      kind: source.kind,
      logicalOrigin: source.logicalOrigin,
      signingKeyId: source.signingKeyId,
      publicKeyFingerprint: source.publicKeyHex.slice(0, 16),
      federationSigningKeyId: source.federationSigningKeyId ?? null,
      federationPublicKeyFingerprint: source.federationPublicKeyHex?.slice(0, 16) ?? null,
      placementAvailable: source.federationPublicKeyHex != null,
      locationSummary: source.kind === 'https' ? source.location : 'Local directory',
      selected: source.sourceId === registry.selectedSourceId
    }
  })
  if (!sources.some(source => source.selected)) invalid()
  return assertSafeProjection({ schema: 'hathq://hatter-console/catalog-sources/v1',
    revision: registry.revision, selectedSourceId: registry.selectedSourceId, sources })
}

export function catalogSourceWriteParameters(input) {
  const sourceId = token(input?.sourceId)
  const label = text(input?.label, 100)
  const kind = input?.kind
  if (!['https', 'local_directory'].includes(kind)) invalidInput()
  const location = locationValue(input?.location, kind)
  const logicalOrigin = httpsUrl(input?.logicalOrigin)
  const signingKeyId = text(input?.signingKeyId, 128)
  const publicKeyHex = typeof input?.publicKeyHex === 'string'
    && KEY.test(input.publicKeyHex) ? input.publicKeyHex : invalidInput()
  const federationSigningKeyId = optionalText(input?.federationSigningKeyId, 128)
  const federationPublicKeyHex = input?.federationPublicKeyHex == null ? null
    : KEY.test(input.federationPublicKeyHex) ? input.federationPublicKeyHex : invalidInput()
  if ((federationSigningKeyId == null) !== (federationPublicKeyHex == null)) invalidInput()
  const expectedRevision = revision(input?.expectedRevision)
  return { sourceId, label, kind, location, logicalOrigin, signingKeyId,
    publicKeyHex, federationSigningKeyId, federationPublicKeyHex,
    expectedRevision, select: input?.select === true }
}

export function catalogSourceSelectParameters(input) {
  return { sourceId: token(input?.sourceId), expectedRevision: revision(input?.expectedRevision) }
}

function validateSource(source) {
  if (source?.schema !== 'hatter://hat/catalog-source/v1') invalid()
  token(source.sourceId); text(source.label, 100); text(source.signingKeyId, 128)
  if (!KEY.test(source.publicKeyHex)) invalid()
  if ((source.federationSigningKeyId == null) !== (source.federationPublicKeyHex == null)) invalid()
  if (source.federationSigningKeyId != null) text(source.federationSigningKeyId, 128)
  if (source.federationPublicKeyHex != null && !KEY.test(source.federationPublicKeyHex)) invalid()
  if (!isHttpsUrl(source.logicalOrigin)) invalid()
  if (source.kind === 'https') {
    if (!isHttpsUrl(source.location)) invalid()
  } else if (source.kind !== 'local_directory'
    || typeof source.location !== 'string' || !source.location.startsWith('/')) invalid()
}
function locationValue(value, kind) {
  if (kind === 'https') return httpsUrl(value)
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('..')
    || /[\u0000-\u001f]/u.test(value) || value.length > 4096) invalidInput()
  return value
}
function httpsUrl(value) {
  if (!isHttpsUrl(value)) invalidInput()
  return value
}
function isHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && !!parsed.hostname
    && !parsed.username && !parsed.password && !parsed.search && !parsed.hash } catch { return false }
}
function token(value) { if (typeof value !== 'string' || !TOKEN.test(value)) invalidInput(); return value }
function text(value, max) { if (typeof value !== 'string' || value.trim() !== value
  || !value || value.length > max || /[\u0000-\u001f]/u.test(value)) invalidInput(); return value }
function optionalText(value, max) { return value == null ? null : text(value, max) }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) invalidInput(); return value }
function invalid() { throw new Error('hatter-console-catalog-source-projection-invalid') }
function invalidInput() { throw new Error('hatter-console-hat-input-invalid') }
