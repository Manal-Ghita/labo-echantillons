import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import type { FabricationStep, ParameterDefinition } from './api'

const sampleId = '87da980d-d334-48ae-9a09-bdd68a1feaa8'
const profile = {
  id: 'owner',
  name: 'Personne connectée',
  email: 'timeline@example.test',
  role: 'RESEARCHER', isActive: true,
  createdAt: '2026-10-20T08:00:00Z',
}
const sample = {
  id: sampleId,
  reference: 'TIMELINE-001',
  name: 'Wafer de validation',
  description: 'Description directement sous le titre',
  creatorId: 'owner',
  status: 'ACTIVE',
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  batchId: null,
  parentId: null,
  originStepId: null,
}
const definitions: ParameterDefinition[] = [
  {
    id: 'material',
    key: 'material',
    name: 'Matériau',
    dataType: 'TEXT',
    unit: null,
    isRequired: false,
  },
  {
    id: 'thickness',
    key: 'thickness',
    name: 'Épaisseur',
    dataType: 'NUMBER',
    unit: 'nm',
    isRequired: true,
  },
  {
    id: 'vacuum',
    key: 'vacuum',
    name: 'Sous vide',
    dataType: 'BOOLEAN',
    unit: null,
    isRequired: false,
  },
]
const steps: FabricationStep[] = Array.from({ length: 10 }, (_, index) => ({
  id: `step-${index}`,
  revision: index === 0 ? 1 : index === 1 ? 2 : 0,
  operationName: index < 2 ? 'Déposition PVD' : `Opération ${index + 1}`,
  performedAt: `2026-10-${20 + index}T08:00:00Z`,
  recordedAt: `2026-10-${20 + index}T09:00:00Z`,
  result: index === 0 ? 'FAILURE' : 'SUCCESS',
  parameters: index === 0 ? 'Réglages historiques conservés' : null,
  observations: `Observation complète ${index + 1}`,
  recordedBy: { id: 'recorder', name: 'Auteur réel' },
  operator:
    index === 0 ? { id: 'operator', name: 'Opérateur réel renseigné' } : null,
  stepType: {
    id: 'type',
    code: 'DEPOT_PVD',
    name: 'Déposition PVD',
    isActive: true,
  },
  parameterValues: definitions.map((definition, n) => ({
    id: `${index}-${n}`,
    definition,
    numericValue: n === 1 ? (index === 0 ? '37.5' : '42.375') : null,
    textValue: n === 0 ? 'Aluminium' : null,
    booleanValue: n === 2 ? false : null,
  })),
}))
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  sessionStorage.setItem(
    'labo.session',
    JSON.stringify({
      token: 'timeline-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) return Response.json(profile)
    if (url.endsWith('/steps')) return Response.json(steps)
    if (url.endsWith('/corrections'))
      return Response.json([
        {
          id: 'correction',
          revision: 1,
          reason: 'Motif réel conservé',
          correctedAt: steps[0].recordedAt,
          correctedBy: steps[0].recordedBy,
          beforeSnapshot: steps[0],
          afterSnapshot: steps[0],
        },
      ])
    return Response.json(sample)
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})
function open() {
  render(
    <MemoryRouter initialEntries={[`/samples/${sampleId}`]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

it('conserve dix réalisations, dont un échec puis une reprise, sans requêtes par étape', async () => {
  const original = structuredClone(steps)
  open()
  const user = userEvent.setup()
  await screen.findByRole('button', {
    name: 'Afficher les détails de l’étape 10',
  })
  expect(screen.getAllByRole('listitem')).toHaveLength(10)
  expect(screen.getAllByText(sample.reference)).toHaveLength(1)
  expect(screen.getAllByText('Actif')).toHaveLength(1)
  expect(screen.queryByText(sampleId)).not.toBeInTheDocument()
  expect(screen.getByText('Nom non disponible (vous)')).toBeVisible()
  const items = screen.getAllByRole('listitem')
  expect(within(items[0]).getByText('Échouée')).toBeVisible()
  expect(within(items[1]).getByText('Réussie')).toBeVisible()
  expect(items.map((item) => item.querySelector('time')?.dateTime)).toEqual(
    steps.map((step) => step.performedAt),
  )
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(
    screen.queryByRole('button', { name: /Corriger l’étape/ }),
  ).not.toBeInTheDocument()
  await user.click(
    within(items[0]).getByRole('button', { name: /Afficher les détails/ }),
  )
  expect(within(items[0]).getByText('37,5 nm', { exact: true })).toBeVisible()
  expect(within(items[0]).getByText('Non', { exact: true })).toBeVisible()
  expect(within(items[0]).getByText('Observation complète 1')).toBeVisible()
  expect(
    within(items[0])
      .getAllByText('Réglages historiques conservés')
      .some((el) => el.closest('.timeline-details')),
  ).toBe(true)
  expect(within(items[0]).getByText('Auteur réel')).toBeVisible()
  expect(within(items[0]).getByText('Opérateur réel renseigné')).toBeVisible()
  expect(within(items[0]).getByText(/Enregistrement/)).toBeVisible()
  await user.click(
    within(items[0]).getByRole('button', {
      name: 'Afficher les corrections (1 correction)',
    }),
  )
  expect(await screen.findByText('Motif : Motif réel conservé')).toBeVisible()
  expect(
    fetcher.mock.calls.filter(([url]) => url.endsWith('/corrections')),
  ).toHaveLength(1)
  await user.click(
    within(items[1]).getByRole('button', { name: /Afficher les détails/ }),
  )
  expect(
    within(items[1]).getByRole('button', {
      name: 'Afficher les corrections (2 corrections)',
    }),
  ).toBeVisible()
  expect(within(items[1]).queryByText('Opérateur réel')).not.toBeInTheDocument()
  await user.click(
    within(items[2]).getByRole('button', { name: /Afficher les détails/ }),
  )
  expect(
    within(items[2]).queryByRole('button', { name: /corrections/ }),
  ).not.toBeInTheDocument()
  await user.click(
    within(items[0]).getByRole('button', { name: /Masquer les détails/ }),
  )
  expect(within(items[0]).getByText('Observation complète 1')).not.toBeVisible()
  expect(steps).toEqual(original)
})
