import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { parameterValues, type StepType } from './fabrication/api'
import { listSamples } from './samples/api'
import type { ApiClient } from './api/client'

const annealing: StepType = {
  id: '58eda0a8-09df-4f1a-a845-5bf49fc76684',
  code: 'RECUIT', name: 'Recuit', description: null, isActive: true,
  parameters: [
    { id: 'temperature', key: 'temperature', name: 'Température', dataType: 'NUMBER', unit: '°C', isRequired: true },
    { id: 'duration', key: 'duration', name: 'Durée', dataType: 'NUMBER', unit: 'min', isRequired: true },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

it.each(['120', '150'])('un recuit accepte %s °C et une durée sous forme de chaînes exactes', (temperature) => {
  expect(parameterValues(annealing, { temperature, duration: '12.5' })).toEqual([
    { definitionId: 'temperature', value: temperature },
    { definitionId: 'duration', value: '12.5' },
  ])
})

it.each([['150', '150'], ['120', '150']])('transmet les bornes de recuit %s–%s sans conversion numérique', async (min, max) => {
  const request = vi.fn().mockResolvedValue([])
  await listSamples({ request } as unknown as ApiClient, '', new AbortController().signal, {
    parameterDefinitionId: '58eda0a8-09df-4f1a-a845-5bf49fc76685', min, max,
  })
  const url = new URL(request.mock.calls[0][0], 'http://localhost')
  expect(url.searchParams.get('min')).toBe(min)
  expect(url.searchParams.get('max')).toBe(max)
  expect(url.searchParams.get('parameterDefinitionId')).toBe('58eda0a8-09df-4f1a-a845-5bf49fc76685')
})

it('affiche deux recuits distincts à 14 h 30 puis 15 h 15 et garde les corrections accessibles', async () => {
  const sampleId = '87da980d-d334-48ae-9a09-bdd68a1feaa8'
  const profile = { id: 'reader', name: 'Lecteur', email: 'reader@example.test', role: 'RESEARCHER', isActive: true, createdAt: '2026-10-30T08:00:00Z' }
  const steps = [
    { id: 'first', performedAt: '2026-10-30T14:30:00+01:00', result: 'FAILURE', revision: 1, value: '120' },
    { id: 'second', performedAt: '2026-10-30T15:15:00+01:00', result: 'SUCCESS', revision: 0, value: '150' },
  ].map((step) => ({
    ...step, operationName: 'Recuit', recordedAt: '2026-10-30T17:00:00+01:00',
    recordedBy: { id: 'author', name: 'Auteur distinct' },
    operator: { id: 'julien', name: 'Julien' }, observations: 'Film souple', parameters: null,
    stepType: annealing,
    parameterValues: [{ id: `${step.id}-value`, definition: annealing.parameters[0], numericValue: step.value, textValue: null, booleanValue: null }],
  }))
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) return Response.json(profile)
    if (url.endsWith('/steps')) return Response.json(steps)
    return Response.json({ id: sampleId, reference: 'K24-017', name: 'Capteur imprimé sur film PET', description: null, creatorId: 'owner', status: 'ACTIVE', createdAt: profile.createdAt, updatedAt: profile.createdAt })
  })
  vi.stubGlobal('fetch', fetcher)
  sessionStorage.setItem('labo.session', JSON.stringify({ token: 'mock-audit-token', expiresAt: Date.now() + 600000 }))
  render(<MemoryRouter initialEntries={[`/samples/${sampleId}`]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
  await screen.findByRole('button', { name: 'Afficher les détails de l’étape 2' })
  const items = screen.getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items.map((item) => item.querySelector('time')?.dateTime)).toEqual(steps.map((step) => step.performedAt))
  expect(within(items[0]).getByText('Échouée')).toBeVisible()
  expect(within(items[1]).getByText('Réussie')).toBeVisible()
  expect(items[0].querySelector('.timeline-summary')).toHaveTextContent('120 °C')
  expect(items[1].querySelector('.timeline-summary')).toHaveTextContent('150 °C')
  await userEvent.setup().click(within(items[0]).getByRole('button', { name: 'Afficher les détails de l’étape 1' }))
  expect(within(items[0]).getByRole('button', { name: 'Afficher les corrections (1 correction)' })).toBeVisible()
  expect(within(items[0]).getByText('Julien')).toBeVisible()
  expect(within(items[0]).getByText('Auteur distinct')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Enregistrer une étape' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Abandonner l’échantillon' })).not.toBeInTheDocument()
  expect(screen.getByText('Nom non disponible')).toBeVisible()
  expect(fetcher).toHaveBeenCalledTimes(3)
})
