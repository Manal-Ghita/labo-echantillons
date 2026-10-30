import type { ParameterDefinition, StepType } from './api'

// Normalize only the entry UI. API validation and correction/search contracts stay unchanged.
export function normalizedEntryValues(
  type: StepType,
  values: Record<string, string>,
) {
  const normalized = { ...values }
  for (const definition of type.parameters)
    if (
      definition.dataType === 'NUMBER' &&
      normalized[definition.id] !== undefined
    )
      normalized[definition.id] = normalized[definition.id].replace(',', '.')
  return normalized
}

export function entryLabel(definition: ParameterDefinition) {
  let name = definition.name.trim()
  const suffix = definition.unit ? `(${definition.unit})` : ''
  while (suffix && name.endsWith(suffix))
    name = name.slice(0, -suffix.length).trimEnd()
  return `${name}${suffix ? ` ${suffix}` : ''}${definition.isRequired ? ' *' : ''}`
}
