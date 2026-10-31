import { validDecimal } from '../fabrication/api'

export const advancedKeys = [
  'status',
  'batchId',
  'stepTypeId',
  'matchMode',
  'numericFilters',
] as const
export type NumericFilter = {
  parameterDefinitionId: string
  eq?: string
  min?: string
  max?: string
}
export type AdvancedQuery = Record<(typeof advancedKeys)[number], string>

export function readNumericFilters(raw: string): NumericFilter[] | null {
  if (!raw) return []
  if (raw.length > 4000) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !Array.isArray(parsed) ||
      parsed.length > 10 ||
      parsed.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          typeof item.parameterDefinitionId !== 'string' ||
          Object.entries(item).some(
            ([key, value]) =>
              !['parameterDefinitionId', 'eq', 'min', 'max'].includes(key) ||
              typeof value !== 'string',
          ),
      )
    )
      return null
    return parsed as NumericFilter[]
  } catch {
    return null
  }
}

export function advancedQueryError(params: URLSearchParams) {
  const rows = readNumericFilters(params.get('numericFilters') ?? '')
  if (!rows)
    return 'Les critères numériques enregistrés sont invalides. Retirez-les ou modifiez-les.'
  if (rows.length + (params.get('parameterDefinitionId') ? 1 : 0) > 10)
    return 'Au maximum 10 critères numériques, paramètre simple inclus.'
  for (const [i, row] of rows.entries()) {
    if (!row.parameterDefinitionId)
      return `Choisissez un paramètre pour le critère ${i + 1}.`
    if (
      row.eq !== undefined &&
      (row.min !== undefined || row.max !== undefined)
    )
      return `Le critère ${i + 1} doit utiliser une valeur exacte ou un intervalle.`
    const values = [row.eq, row.min, row.max].filter(
      (v): v is string => v !== undefined,
    )
    if (!values.length)
      return `Indiquez une valeur ou une borne pour le critère ${i + 1}.`
    if (values.some((v) => !validDecimal(v)))
      return `Le critère ${i + 1} attend un décimal avec un point, sans exposant, compatible avec 35 chiffres entiers et 30 décimales significatives.`
  }
  return ''
}
