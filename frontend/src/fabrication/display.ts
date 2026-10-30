// Presentation only: keep every decimal digit without conversion to Number.
export function numericDisplay(value: string | null, unit?: string | null) {
  if (value === null) return 'Non renseigné'
  return `${value.replace('.', ',')}${unit ? `\u00a0${unit}` : ''}`
}

export function resultDisplay(value: 'SUCCESS' | 'FAILURE' | null | undefined) {
  return value === 'SUCCESS'
    ? 'Réussie'
    : value === 'FAILURE'
      ? 'Échouée'
      : 'Résultat non renseigné'
}
