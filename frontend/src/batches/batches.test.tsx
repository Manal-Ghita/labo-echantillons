import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import type { Sample } from '../samples/api'

const profile = {
  id: 'owner',
  name: 'Karim Test',
  email: 'karim@example.test',
  role: 'RESEARCHER',
  isActive: true,
  createdAt: '2026-10-30T08:00:00Z',
}
const sample = (
  id: string,
  reference: string,
  creatorId = 'owner',
): Sample => ({
  id,
  reference,
  creatorId,
  name: 'Capteur souple',
  status: 'ACTIVE',
  batchId: 'batch',
  description: null,
  createdAt: profile.createdAt,
  updatedAt: profile.createdAt,
  parentId: null,
  originStepId: null,
})
const operation = {
  id: 'type',
  name: 'Recuit',
  code: 'RECUIT',
  isActive: true,
  description: null,
  parameters: [
    {
      id: 'temperature',
      key: 'temperature',
      name: 'Température',
      dataType: 'NUMBER',
      unit: '°C',
      isRequired: true,
    },
  ],
}
let batch: {
  id: string
  reference: string
  createdById: string
  createdBy: { id: string; name: string }
  createdAt: string
  samples: Sample[]
}
let available: Sample[]
let status: number
let role: string
let fetcher: ReturnType<typeof vi.fn>
let changes: { path: string; body: Record<string, unknown> }[]

beforeEach(() => {
  role = 'RESEARCHER'
  status = 0
  changes = []
  batch = {
    id: 'batch',
    reference: 'LOT-PET',
    createdById: 'owner',
    createdBy: { id: 'owner', name: profile.name },
    createdAt: profile.createdAt,
    samples: [sample('first', 'K24-017'), sample('second', 'K24-018')],
  }
  available = [
    sample('free', 'K24-019'),
    sample('foreign', 'K24-020', 'other'),
  ].map((s) => ({ ...s, batchId: null }))
  sessionStorage.setItem(
    'labo.session',
    JSON.stringify({
      token: 'mock-batch-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  fetcher = vi.fn(async (url: string, options: RequestInit = {}) => {
    const path = new URL(url).pathname
    if (path === '/auth/me') return Response.json({ ...profile, role })
    if (options.method === 'POST') {
      const body = JSON.parse(options.body as string)
      changes.push({ path, body })
      if (status)
        return Response.json(
          {
            message:
              status === 409
                ? 'Conflit : aucune étape enregistrée.'
                : 'Accès refusé.',
          },
          { status },
        )
      if (path.endsWith('/samples')) {
        const attached = available.filter((s) => body.sampleIds.includes(s.id))
        batch.samples.push(
          ...attached.map((s) => ({ ...s, batchId: batch.id })),
        )
        available = available.filter((s) => !body.sampleIds.includes(s.id))
      }
      return Response.json(
        path === '/batches' ? { ...batch, reference: body.reference } : [],
        { status: 201 },
      )
    }
    if (path === '/batches')
      return Response.json([
        { ...batch, _count: { samples: batch.samples.length } },
      ])
    if (path === '/batches/batch') return Response.json(batch)
    if (path === '/samples')
      return Response.json([...batch.samples, ...available])
    if (path === '/step-types') return Response.json([operation])
    if (path === '/users/operators')
      return Response.json([
        { id: 'owner', name: profile.name },
        { id: 'julien', name: 'Julien' },
      ])
    throw Error(`Unexpected ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})
function open(path = '/batches/batch') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
async function openGroup() {
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'LOT-PET' })
  await user.click(
    screen.getByRole('checkbox', { name: 'Sélectionner K24-017' }),
  )
  await user.click(
    screen.getByRole('checkbox', { name: 'Sélectionner K24-018' }),
  )
  await user.click(
    screen.getByRole('button', { name: 'Enregistrer une opération groupée' }),
  )
  await screen.findByRole('option', { name: 'Recuit' })
  await user.selectOptions(screen.getByLabelText('Type d’opération *'), 'type')
  await user.type(
    screen.getByLabelText('Température (°C) *'),
    '150,12345678901234567890123456789',
  )
  await user.click(screen.getByRole('radio', { name: 'Réussie' }))
  return user
}

it('crée un lot avec sa référence uniquement et navigue vers ses membres', async () => {
  open('/batches')
  const user = userEvent.setup()
  await screen.findByRole('link', { name: 'LOT-PET' })
  await user.click(screen.getByRole('button', { name: 'Créer un lot' }))
  await user.type(screen.getByLabelText('Référence du lot *'), 'LOT-PET')
  await user.click(screen.getByRole('button', { name: 'Enregistrer le lot' }))
  expect(await screen.findByRole('heading', { name: 'LOT-PET' })).toBeVisible()
  expect(changes).toEqual([
    { path: '/batches', body: { reference: 'LOT-PET' } },
  ])
})
it('associe seulement les échantillons autorisés sans lot, puis actualise', async () => {
  open()
  const user = userEvent.setup()
  const attach = await screen.findByRole('region', {
    name: 'Associer des échantillons',
  })
  expect(within(attach).queryByText(/K24-020/)).not.toBeInTheDocument()
  await user.click(within(attach).getByRole('checkbox', { name: /K24-019/ }))
  await user.click(screen.getByRole('button', { name: 'Associer au lot' }))
  expect(
    await screen.findByRole('checkbox', { name: 'Sélectionner K24-019' }),
  ).toBeVisible()
  expect(changes[0]).toEqual({
    path: '/batches/batch/samples',
    body: { sampleIds: ['free'] },
  })
})
it('enregistre des résultats distincts avec un décimal exact et un auteur déterminé par le serveur', async () => {
  open()
  const user = await openGroup()
  await user.selectOptions(
    screen.getByLabelText('Résultat pour K24-018'),
    'FAILURE',
  )
  await user.selectOptions(
    screen.getByLabelText('Opérateur réel', { exact: true }),
    'julien',
  )
  await user.click(
    screen.getByRole('button', { name: 'Enregistrer pour la sélection' }),
  )
  expect(
    await screen.findByText(
      'Opérations enregistrées pour tous les échantillons sélectionnés.',
    ),
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(changes[0]).toMatchObject({
    path: '/batches/batch/steps',
    body: {
      samples: [
        { sampleId: 'first', result: 'SUCCESS' },
        { sampleId: 'second', result: 'FAILURE' },
      ],
      operation: {
        operatorId: 'julien',
        parameterValues: [
          {
            definitionId: 'temperature',
            value: '150.12345678901234567890123456789',
          },
        ],
      },
    },
  })
  expect(changes[0].body).not.toHaveProperty('recordedById')
})
it.each([403, 409])(
  'garde la saisie et affiche le refus %s sans succès trompeur',
  async (code) => {
    open()
    const user = await openGroup()
    status = code
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer pour la sélection' }),
    )
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(
      screen.getByRole('dialog', { name: 'Opération groupée' }),
    ).toBeVisible()
    expect(screen.getByLabelText('Température (°C) *')).toHaveValue(
      '150,12345678901234567890123456789',
    )
  },
)
it('un autre chercheur consulte mais ne peut associer ni saisir sur les membres d’autrui', async () => {
  batch.createdById = 'other'
  batch.samples.forEach((s) => {
    s.creatorId = 'other'
  })
  open()
  await screen.findByRole('heading', { name: 'LOT-PET' })
  expect(
    screen.getByRole('button', { name: 'Enregistrer une opération groupée' }),
  ).toBeDisabled()
  expect(
    screen.getByRole('checkbox', { name: 'Sélectionner K24-017' }),
  ).toBeDisabled()
  expect(
    screen.queryByRole('heading', { name: 'Associer des échantillons' }),
  ).not.toBeInTheDocument()
})
it('ADMIN peut sélectionner les échantillons d’autrui mais pas un échantillon abandonné', async () => {
  role = 'ADMIN'
  batch.createdById = 'other'
  batch.samples[0].creatorId = 'other'
  batch.samples[1].status = 'ABANDONED'
  open()
  await screen.findByRole('heading', { name: 'LOT-PET' })
  expect(
    screen.getByRole('checkbox', { name: 'Sélectionner K24-017' }),
  ).toBeEnabled()
  expect(
    screen.getByRole('checkbox', { name: 'Sélectionner K24-018' }),
  ).toBeDisabled()
  expect(
    screen.getByRole('heading', { name: 'Associer des échantillons' }),
  ).toBeVisible()
})
it('confirme la perte de saisie et remet le focus sur le bouton d’ouverture', async () => {
  open()
  const user = await openGroup()
  const confirm = vi
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true)
  await user.keyboard('{Escape}')
  // jsdom does not implement native dialog cancel: dispatch the native event.
  const dialog = screen.getByRole('dialog')
  dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))
  expect(confirm).toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Annuler la saisie' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  confirm.mockRestore()
})
