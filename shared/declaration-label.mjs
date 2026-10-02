// Hatter: locale selection only; labels never define identity, meaning or permissions.
/** @param {Record<string, string>} labels @param {string} locale */
export function declarationLabel(labels, locale = 'en') {
  const label = labels[locale] ?? labels[locale.split('-')[0]] ?? labels.en
  if (typeof label !== 'string' || !label.trim()) throw new Error('hatter-console-semantic-label-missing')
  return label
}
