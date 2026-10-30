import type { ApiClient } from '../api/client'

export type Sample = {
  id: string
  reference: string
  name: string
  description: string | null
  creatorId: string
  createdAt: string
  updatedAt: string
  status: 'ACTIVE' | 'ABANDONED' | null
  batchId: string | null
  parentId: string | null
  originStepId: string | null
  parent?: { id: string; reference: string; name: string } | null
  children?: {
    id: string
    reference: string
    name: string
    status: Sample['status']
  }[]
  originStep?: { id: string; operationName: string; performedAt: string } | null
}

export type CreateSample = {
  reference: string
  name: string
  description?: string
}

export const listSamples = (
  api: ApiClient,
  q: string,
  signal: AbortSignal,
  numeric: Record<string, string> = {},
) => {
  const params = new URLSearchParams(q ? { q } : {})
  for (const [key, value] of Object.entries(numeric))
    if (value) params.set(key, value)
  return api.request<Sample[]>(`/samples${params.size ? `?${params}` : ''}`, {
    signal,
  })
}

export const getSample = (api: ApiClient, id: string, signal: AbortSignal) =>
  api.request<Sample>(`/samples/${encodeURIComponent(id)}`, { signal })

export const createSample = (
  api: ApiClient,
  body: CreateSample,
  signal: AbortSignal,
) => api.request<Sample>('/samples', { method: 'POST', body, signal })

export const sampleStatus = (status: Sample['status']) =>
  status === 'ACTIVE'
    ? 'Actif'
    : status === 'ABANDONED'
      ? 'Abandonné'
      : 'Non renseigné'

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
