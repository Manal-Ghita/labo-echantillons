import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import type { Sample } from './api'

const profile = {
  id: 'owner',
  name: 'Karim Test',
  email: 'karim@example.test',
  role: 'RESEARCHER',
  isActive: true,
  createdAt: '2026-10-30T08:00:00Z',
}
let sample: Sample
let role: string, actor: string, failure: number
let calls: { path: string; method: string; body?: Record<string, unknown> }[]
const step = {
  id: 'origin',
  operationName: 'Découpe',
  performedAt: '2026-10-30T10:00:00Z',
  recordedAt: '2026-10-30T10:01:00Z',
  revision: 0,
  result: 'SUCCESS',
  recordedBy: { id: 'owner', name: 'Karim Test' },
  operator: null,
  parameters: null,
  observations: null,
  stepType: null,
  parameterValues: [],
}

beforeEach(() => {
  actor = 'owner'
  role = 'RESEARCHER'
  failure = 0
  calls = []
  sample = {
    id: 'parent',
    reference: 'K24-017',
    name: 'Capteur PET parent',
    description: 'Film souple',
    creatorId: 'owner',
    status: 'ACTIVE',
    batchId: 'lot',
    parentId: null,
    originStepId: null,
    createdAt: profile.createdAt,
    updatedAt: profile.createdAt,
    parent: null,
    children: [],
    originStep: null,
  }
  sessionStorage.setItem(
    'labo.session',
    JSON.stringify({ token: 'mock-lineage', expiresAt: Date.now() + 3600000 }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = new URL(url).pathname,
        method = options.method || 'GET'
      const body = options.body ? JSON.parse(options.body as string) : undefined
      calls.push({ path, method, body })
      if (path === '/auth/me')
        return Response.json({ ...profile, id: actor, role })
      if (path.endsWith('/split')) {
        if (failure)
          return Response.json(
            { message: 'Découpe refusée : aucun enfant créé.' },
            { status: failure },
          )
        sample.children = body.children.map(
          (c: { reference: string; name: string }, i: number) => ({
            id: `child-${i}`,
            reference: c.reference,
            name: c.name,
            status: 'ACTIVE',
          }),
        )
        return Response.json(sample.children, { status: 201 })
      }
      if (method === 'PATCH') {
        sample.status = body.status
        const { parent: _p, children: _c, originStep: _o, ...flat } = sample
        return Response.json(flat)
      }
      if (path.endsWith('/steps'))
        return Response.json(path === '/samples/parent/steps' ? [step] : [])
      if (path === '/samples/parent') return Response.json(sample)
      const child = sample.children?.find((c) => path === `/samples/${c.id}`)
      if (child)
        return Response.json({
          ...sample,
          ...child,
          parentId: sample.id,
          children: [],
          batchId: null,
          parent: {
            id: sample.id,
            reference: sample.reference,
            name: sample.name,
          },
        })
      throw Error(`Unexpected request ${path}`)
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
})
function open() {
  render(
    <MemoryRouter initialEntries={['/samples/parent']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
async function fill() {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', {
      name: 'Créer des échantillons enfants',
    }),
  )
  for (const [i, reference] of ['K24-018', 'K24-019'].entries()) {
    await user.type(
      screen.getByLabelText(`Référence de l’enfant ${i + 1} *`),
      reference,
    )
    await user.type(
      screen.getByLabelText(`Nom de l’enfant ${i + 1} *`),
      `Film ${i + 1}`,
    )
  }
  return user
}

it('crée deux enfants, actualise les liens et navigue vers un historique individuel vide', async () => {
  open()
  const user = await fill()
  await screen.findByRole('option', { name: /Découpe/ })
  await user.selectOptions(
    screen.getByLabelText('Étape d’origine (facultatif)'),
    'origin',
  )
  await user.click(screen.getByRole('button', { name: 'Créer les enfants' }))
  const link = await screen.findByRole('link', { name: 'K24-018 · Film 1' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(calls.find((c) => c.method === 'POST')).toEqual({
    path: '/samples/parent/split',
    method: 'POST',
    body: {
      originStepId: 'origin',
      children: [
        { reference: 'K24-018', name: 'Film 1' },
        { reference: 'K24-019', name: 'Film 2' },
      ],
    },
  })
  expect(sample.status).toBe('ACTIVE')
  expect(sample.batchId).toBe('lot')
  await user.click(link)
  expect(await screen.findByRole('heading', { name: 'Film 1' })).toBeVisible()
  expect(await screen.findByText('Aucune étape enregistrée.')).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'K24-017 · Capteur PET parent' }),
  ).toBeVisible()
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})
it('valide les champs et références dupliquées sans requête de création', async () => {
  open()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', {
      name: 'Créer des échantillons enfants',
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Créer les enfants' }))
  expect(screen.getByRole('alert')).toHaveTextContent('obligatoires')
  for (const i of [1, 2]) {
    await user.type(
      screen.getByLabelText(`Référence de l’enfant ${i} *`),
      ' K24-018 ',
    )
    await user.type(
      screen.getByLabelText(`Nom de l’enfant ${i} *`),
      `Film ${i}`,
    )
  }
  await user.click(screen.getByRole('button', { name: 'Créer les enfants' }))
  expect(screen.getByRole('alert')).toHaveTextContent('distinctes')
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Ajouter un enfant' }))
  expect(screen.getAllByRole('group', { name: /^Enfant/ })).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: 'Retirer l’enfant 3' }))
  expect(screen.getAllByRole('group', { name: /^Enfant/ })).toHaveLength(2)
})
it.each([403, 409])(
  'conserve la saisie après un refus %s sans afficher de succès',
  async (status) => {
    failure = status
    open()
    const user = await fill()
    await user.click(screen.getByRole('button', { name: 'Créer les enfants' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 403 ? 'droits nécessaires' : 'aucun enfant créé',
    )
    expect(screen.getByRole('alert')).toHaveFocus()
    expect(screen.getByLabelText('Référence de l’enfant 1 *')).toHaveValue(
      'K24-018',
    )
    expect(sample.children).toHaveLength(0)
  },
)
it('permet la consultation par autrui sans proposer de découpe', async () => {
  actor = 'reader'
  sample.parent = {
    id: 'grandparent',
    reference: 'K24-016',
    name: 'Film initial',
  }
  sample.parentId = 'grandparent'
  sample.originStep = step
  sample.children = [
    { id: 'child-0', reference: 'K24-018', name: 'Film 1', status: 'ACTIVE' },
  ]
  open()
  await screen.findByRole('heading', { name: sample.name })
  expect(
    screen.getByRole('link', { name: 'K24-016 · Film initial' }),
  ).toBeVisible()
  expect(screen.getByRole('link', { name: 'K24-018 · Film 1' })).toBeVisible()
  expect(screen.getByText(/Étape d’origine : Découpe/)).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Créer des échantillons enfants' }),
  ).not.toBeInTheDocument()
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
})
it('ADMIN peut ouvrir la découpe du parent d’autrui sans usurper son identité', async () => {
  actor = 'admin'
  role = 'ADMIN'
  open()
  await userEvent.setup().click(
    await screen.findByRole('button', {
      name: 'Créer des échantillons enfants',
    }),
  )
  expect(
    screen.getByText(/Vous serez propriétaire des nouveaux échantillons/),
  ).toBeVisible()
})
it('conserve les liens lors d’un changement de statut retournant un échantillon sans relations', async () => {
  sample.children = [
    { id: 'child-0', reference: 'K24-018', name: 'Film 1', status: 'ACTIVE' },
  ]
  open()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Abandonner l’échantillon' }),
  )
  await user.click(screen.getByRole('button', { name: 'Confirmer l’abandon' }))
  expect(
    await screen.findByText('Abandonné', { selector: '.status-tag' }),
  ).toBeVisible()
  expect(screen.getByRole('link', { name: 'K24-018 · Film 1' })).toBeVisible()
})
