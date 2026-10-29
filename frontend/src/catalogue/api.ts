import type { ApiClient } from '../api/client'
import type { StepType } from '../fabrication/api'

export type ParameterInput = {
  key: string
  name: string
  dataType: 'NUMBER' | 'TEXT' | 'BOOLEAN'
  unit?: string
  isRequired: boolean
}
export type CreateStepType = {
  code: string
  name: string
  description?: string
  parameters: ParameterInput[]
}
export type UpdateStepType = {
  name: string
  description: string | null
  isActive: boolean
}

export const listCatalogue = (
  api: ApiClient,
  includeInactive: boolean,
  signal: AbortSignal,
) =>
  api.request<StepType[]>(
    `/step-types${includeInactive ? '?includeInactive=true' : ''}`,
    { signal },
  )
export const getCatalogueType = (
  api: ApiClient,
  id: string,
  signal: AbortSignal,
) => api.request<StepType>(`/step-types/${encodeURIComponent(id)}`, { signal })
export const createCatalogueType = (
  api: ApiClient,
  body: CreateStepType,
  signal: AbortSignal,
) => api.request<StepType>('/step-types', { method: 'POST', body, signal })
export const updateCatalogueType = (
  api: ApiClient,
  id: string,
  body: UpdateStepType,
  signal: AbortSignal,
) =>
  api.request<StepType>(`/step-types/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    signal,
  })

export function validateParameters(
  parameters: ParameterInput[],
): ParameterInput[] {
  const keys = new Set<string>()
  return parameters.map((parameter) => {
    const key = parameter.key.trim()
    const name = parameter.name.trim()
    const unit = parameter.unit?.trim()
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))
      throw new Error(
        'Chaque clé doit commencer par une lettre et contenir uniquement lettres, chiffres ou underscores.',
      )
    if (keys.has(key))
      throw new Error(
        'Les clés des paramètres doivent être uniques dans ce type.',
      )
    if (!name) throw new Error('Chaque paramètre doit avoir un nom.')
    if (!['NUMBER', 'TEXT', 'BOOLEAN'].includes(parameter.dataType))
      throw new Error('Type de paramètre invalide.')
    keys.add(key)
    return {
      key,
      name,
      dataType: parameter.dataType,
      isRequired: parameter.isRequired,
      ...(unit ? { unit } : {}),
    }
  })
}
