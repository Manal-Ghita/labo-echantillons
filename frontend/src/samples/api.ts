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
}

export type CreateSample = {
  reference: string
  name: string
  description?: string
}

export const listSamples = (api: ApiClient, q: string, signal: AbortSignal) =>
  api.request<Sample[]>(
    `/samples${q ? `?${new URLSearchParams({ q })}` : ''}`,
    { signal },
  )

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
