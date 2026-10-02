// Modified by the Hatter downstream project, 2026.
// Purpose: project only Hatter-verified source-pinned candidates and signed categories.
import { assertSafeProjection } from './projection.mjs'

const TOKEN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u
const DIGEST = /^[0-9a-f]{64}$/u

export function projectHatDiscovery(value) {
  const catalog = value?.catalog
  if (catalog?.schema !== 'hatter://hat/catalog-projection/v1'
    || !httpsUrl(catalog?.source) || !TOKEN.test(catalog?.sourceId)
    || typeof catalog?.sourceLabel !== 'string' || !catalog.sourceLabel.trim()
    || catalog.sourceLabel.length > 100
    || !['https', 'local_directory'].includes(catalog?.sourceKind)
    || typeof catalog?.artifactAcquisitionAvailable !== 'boolean'
    || !DIGEST.test(catalog?.catalogDigestSha256)
    || !Array.isArray(catalog?.candidates) || catalog.candidates.length > 128
    || !Array.isArray(catalog?.categories) || catalog.categories.length > 32) invalid()
  const genres = catalog.categories.map(category => ({
    handle: handle('category', category.id), categoryId: token(category.id),
    termId: term(category.termId), label: text(category.name, 100),
    summary: text(category.summary, 300),
    installedHatCount: count(category.installedHatCount),
    availableHatCount: catalog.candidates.filter(item => item.categoryId === category.id).length
  }))
  const genreById = new Map(genres.map(item => [item.categoryId, item]))
  const candidates = catalog.candidates.map(item => {
    const genre = genreById.get(item.categoryId)
    if (!genre || !['official', 'source-pinned'].includes(item.assurance)) invalid()
    return {
      handle: handle('candidate', item.repositoryId),
      repositoryId: token(item.repositoryId), packageId: packageId(item.packageId),
      version: version(item.version), packageSha256: digest(item.packageSha256),
      name: text(item.name, 100), summary: text(item.summary, 300),
      genreHandle: genre.handle, genreLabel: genre.label,
      assurance: choice(item.assurance, ['official', 'source-pinned']),
      residenceScopes: residenceScopes(item.residenceScopes),
      availability: item.installed === true ? 'installed'
        : catalog.artifactAcquisitionAvailable ? 'installable' : 'unavailable',
      updateState: item.installed === true ? 'current'
        : catalog.artifactAcquisitionAvailable ? 'not-installed' : 'blocked'
    }
  })
  return assertSafeProjection({
    schema: 'hathq://hatter-console/hat-discovery/v1', status: 'available', reason: null,
    candidateSource: 'signed-catalog', sourceId: catalog.sourceId,
    sourceLabel: catalog.sourceLabel, sourceKind: catalog.sourceKind,
    logicalOrigin: catalog.source,
    genreSource: 'hat-information-coordinate.data_domain_term_id',
    artifactAcquisitionAvailable: catalog.artifactAcquisitionAvailable,
    catalogDigestSha256: catalog.catalogDigestSha256, candidates, genres
  })
}

export function unavailableHatDiscovery() {
  return Object.freeze({ schema: 'hathq://hatter-console/hat-discovery/v1',
    status: 'unavailable', reason: 'hatter-console-official-hat-catalog-unavailable',
    candidateSource: 'signed-catalog', sourceId: null, sourceLabel: null,
    sourceKind: null, logicalOrigin: null,
    genreSource: 'hat-information-coordinate.data_domain_term_id',
    artifactAcquisitionAvailable: false,
    catalogDigestSha256: null, candidates: Object.freeze([]), genres: Object.freeze([]) })
}

function handle(kind, value) { return `${kind}-${token(value)}-v1` }
function token(value) { if (typeof value !== 'string' || !TOKEN.test(value)) invalid(); return value }
function digest(value) { if (typeof value !== 'string' || !DIGEST.test(value)) invalid(); return value }
function packageId(value) { if (typeof value !== 'string' || !/^hat\/[a-z0-9-]+$/u.test(value)) invalid(); return value }
function term(value) { if (typeof value !== 'string' || !/^hathq:\/\/vocabulary\/data-domain\/[a-z0-9-]+\/v[1-9][0-9]*$/u.test(value)) invalid(); return value }
function version(value) { if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(value)) invalid(); return value }
function text(value, max) { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) invalid(); return value }
function choice(value, values) { if (!values.includes(value)) invalid(); return value }
function count(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0 || number > 128) invalid(); return number }
function residenceScopes(value) {
  if (!Array.isArray(value) || value.length > 64) invalid()
  const result = value.map(item => {
    if (typeof item !== 'string' || !/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/u.test(item)) invalid()
    return item
  })
  if (new Set(result).size !== result.length) invalid()
  return result
}
function httpsUrl(value) { try { const parsed = new URL(value); return parsed.protocol === 'https:'
  && !parsed.username && !parsed.password && !parsed.search && !parsed.hash } catch { return false } }
function invalid() { throw new Error('hatter-console-catalog-projection-invalid') }
