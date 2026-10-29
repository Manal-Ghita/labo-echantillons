import type { ApiClient } from '../api/client'

export type ParameterDefinition = {
  id: string
  key: string
  name: string
  dataType: 'NUMBER' | 'TEXT' | 'BOOLEAN'
  unit: string | null
  isRequired: boolean
}
export type StepType = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  parameters: ParameterDefinition[]
}
export type FabricationStep = {
  id: string
  operationName: string
  performedAt: string
  recordedAt: string
  result: 'SUCCESS' | 'FAILURE' | null
  parameters: string | null
  observations: string | null
  recordedBy: { id: string; name: string }
  operator: { id: string; name: string } | null
  stepType: Pick<StepType, 'id' | 'code' | 'name' | 'isActive'> | null
  parameterValues: {
    id: string
    definition: ParameterDefinition
    numericValue: string | null
    textValue: string | null
    booleanValue: boolean | null
  }[]
}
export type CreateStep = {
  stepTypeId: string
  performedAt: string
  result: 'SUCCESS' | 'FAILURE'
  observations?: string
  operatorId?: string
  parameterValues: { definitionId: string; value: string | boolean }[]
}
const stepsPath = (sampleId: string) =>
  `/samples/${encodeURIComponent(sampleId)}/steps`
export const getSteps = (
  api: ApiClient,
  sampleId: string,
  signal: AbortSignal,
) => api.request<FabricationStep[]>(stepsPath(sampleId), { signal })
export const getStepTypes = (api: ApiClient, signal: AbortSignal) =>
  api.request<StepType[]>('/step-types', { signal })
export const createStep = (
  api: ApiClient,
  sampleId: string,
  body: CreateStep,
  signal: AbortSignal,
) =>
  api.request<FabricationStep>(stepsPath(sampleId), {
    method: 'POST',
    body,
    signal,
  })

// Same textual capacity check as the backend; never convert a decimal to Number.
export function validDecimal(value: string) {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return false
  const [integer, fraction = ''] = value.replace(/^[+-]/, '').split('.')
  return (
    integer.replace(/^0+/, '').length <= 35 &&
    fraction.replace(/0+$/, '').length <= 30
  )
}

export function parameterValues(
  type: StepType,
  values: Record<string, string>,
): CreateStep['parameterValues'] {
  return type.parameters.flatMap((definition) => {
    const value = values[definition.id] ?? ''
    if (definition.dataType === 'TEXT' && definition.isRequired)
      return [{ definitionId: definition.id, value }]
    if (value === '') {
      if (definition.isRequired)
        throw new Error(`Le paramètre « ${definition.name} » est obligatoire.`)
      return []
    }
    if (definition.dataType === 'NUMBER' && !validDecimal(value))
      throw new Error(
        `Le paramètre « ${definition.name} » attend un décimal sans exposant (35 chiffres entiers et 30 décimales significatives maximum).`,
      )
    if (
      definition.dataType === 'BOOLEAN' &&
      value !== 'true' &&
      value !== 'false'
    )
      throw new Error(`Le paramètre « ${definition.name} » attend Oui ou Non.`)
    return [
      {
        definitionId: definition.id,
        value: definition.dataType === 'BOOLEAN' ? value === 'true' : value,
      },
    ]
  })
}
