import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { SESSION_KEY } from '../auth/session'
import { parameterValues, validDecimal } from './api'
import type { FabricationStep, StepType } from './api'

const owner = '87da980d-d334-48ae-9a09-bdd68a1feaa8'
const sampleId = '5d8f6fc0-32d9-4828-acab-a0d18ba340ad'
const typeId = '06d1546b-65cf-4fe6-a35e-84164b90af14'
const numericId = '01751530-a733-4e3f-a72c-a8c08785d95a'
const textId = '8b717a1a-629e-4871-935b-7f4d60976772'
const booleanId = '3e1bf8ea-13a3-4595-a8da-1607250cdcbd'
const precise =
  '12345678901234567890123456789012345.123456789012345678901234567891'
const type: StepType = {
  id: typeId,
  code: 'DEPOT',
  name: 'Dépôt',
  description: 'Opération de dépôt',
  isActive: true,
  parameters: [
    {
      id: numericId,
      key: 'temperature',
      name: 'Température',
      dataType: 'NUMBER',
      unit: '°C',
      isRequired: true,
    },
    {
      id: textId,
      key: 'gas',
      name: 'Gaz',
      dataType: 'TEXT',
      unit: null,
      isRequired: false,
    },
    {
      id: booleanId,
      key: 'vacuum',
      name: 'Sous vide',
      dataType: 'BOOLEAN',
      unit: null,
      isRequired: true,
    },
  ],
}
const profile = {
  id: owner,
  name: 'Camille',
  email: 'camille@example.test',
  role: 'RESEARCHER', isActive: true,
  createdAt: '2026-10-29T08:00:00Z',
}
const sample = {
  id: sampleId,
  reference: 'K24-017',
  name: 'Silicium',
  description: null,
  creatorId: owner,
  status: 'ACTIVE',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  batchId: null,
  parentId: null,
  originStepId: null,
}
const legacy: FabricationStep = {
  id: 'legacy',
  operationName: 'Ancienne opération',
  performedAt: '2026-10-27T08:00:00Z',
  recordedAt: '2026-10-27T09:00:00Z',
  result: null,
  parameters: 'Puissance = 120 W',
  observations: 'Ancienne observation',
  recordedBy: { id: owner, name: 'Camille' },
  operator: null,
  stepType: null,
  parameterValues: [],
}
let history: FabricationStep[]
let post: ReturnType<typeof vi.fn<(body: unknown) => Promise<Response>>>
let fetcher: ReturnType<typeof vi.fn>
let role: string
let actor: string
let status: string
let types: StepType[]
let historyResponse: (() => Promise<Response>) | undefined
let catalogueResponse: (() => Promise<Response>) | undefined

function open() {
  render(
    <MemoryRouter initialEntries={[`/samples/${sampleId}`]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
async function openForm() {
  open()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Enregistrer une étape' }),
  )
  await screen.findByLabelText('Type d’opération *')
}
async function fillForm(result = 'SUCCESS') {
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('Type d’opération *'), typeId)
  await user.clear(screen.getByLabelText('Date de réalisation *'))
  await user.type(
    screen.getByLabelText('Date de réalisation *'),
    '2026-10-29T10:30:00',
  )
  await user.click(
    screen.getByRole('radio', {
      name: result === 'SUCCESS' ? 'Réussie' : 'Échouée',
    }),
  )
  await user.click(screen.getByLabelText('Température (°C) *'))
  await user.paste(precise)
  await user.type(screen.getByLabelText('Gaz'), 'Argon')
  await user.selectOptions(screen.getByLabelText('Sous vide *'), 'false')
  return user
}
beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'fabrication-test-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  role = 'RESEARCHER'
  actor = owner
  status = 'ACTIVE'
  types = [type]
  history = []
  historyResponse = undefined
  catalogueResponse = undefined
  post = vi.fn(async (input: unknown) => {
    const body = input as {
      result: 'SUCCESS' | 'FAILURE'
      performedAt: string
      observations?: string
      operatorId?: string
      parameterValues: { definitionId: string; value: string | boolean }[]
    }
    const created: FabricationStep = {
      ...legacy,
      id: 'new',
      operationName: 'Dépôt',
      parameters: null,
      observations: body.observations ?? null,
      result: body.result,
      performedAt: body.performedAt,
      stepType: type,
      operator: body.operatorId
        ? { id: body.operatorId, name: 'Opérateur réel' }
        : null,
      parameterValues: body.parameterValues.map((value, index) => ({
        id: String(index),
        definition: type.parameters.find(
          (item) => item.id === value.definitionId,
        )!,
        numericValue:
          typeof value.value === 'string' && value.definitionId === numericId
            ? value.value
            : null,
        textValue:
          value.definitionId === textId ? (value.value as string) : null,
        booleanValue: typeof value.value === 'boolean' ? value.value : null,
      })),
    }
    history.push(created)
    return Response.json(created, { status: 201 })
  })
  fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/auth/me'))
      return Response.json({ ...profile, id: actor, role })
    if (url.endsWith('/users/operators'))
      return Response.json([
        { id: actor, name: profile.name },
        { id: '8b717a1a-629e-4871-935b-7f4d60976772', name: 'Alex' },
      ])
    if (url.endsWith('/step-types'))
      return catalogueResponse ? catalogueResponse() : Response.json(types)
    if (url.endsWith('/steps'))
      return options.method === 'POST'
        ? post(JSON.parse(options.body as string))
        : historyResponse
          ? historyResponse()
          : Response.json(history)
    if (url.endsWith(`/samples/${sampleId}`))
      return Response.json({ ...sample, status })
    throw new Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

describe('Historique et enregistrement de fabrication', () => {
  it('propose ADMIN comme opérateur courant sans le confondre avec le propriétaire ni envoyer un auteur client', async () => {
    role = 'ADMIN'
    actor = '3e1bf8ea-13a3-4595-a8da-1607250cdcbd'
    await openForm()
    const user = await fillForm('SUCCESS')
    expect(screen.getByLabelText('Opérateur réel')).toHaveValue(actor)
    expect(actor).not.toBe(sample.creatorId)
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    await screen.findByText('Étape enregistrée.')
    const body = post.mock.calls[0][0] as Record<string, unknown>
    expect(body.operatorId).toBe(actor)
    expect(body).not.toHaveProperty('recordedById')
    expect(body).not.toHaveProperty('creatorId')
  })
  it('préremplit la date locale à l’ouverture et affiche le contexte réel', async () => {
    const before = Date.now()
    await openForm()
    const date = screen.getByLabelText(
      'Date de réalisation *',
    ) as HTMLInputElement
    const localInstant = new Date(date.value).getTime()
    expect(localInstant).toBeGreaterThanOrEqual(before - 1000)
    expect(localInstant).toBeLessThanOrEqual(Date.now())
    expect(screen.getByText('K24-017 · Silicium')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    ).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Réussie' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Échouée' })).not.toBeChecked()
  })
  it('affiche les erreurs sous les champs sans appel API, puis conserve les validations exactes des paramètres', async () => {
    await openForm()
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    expect(screen.getByLabelText('Type d’opération *')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(
      screen.getByLabelText('Type d’opération *'),
    ).toHaveAccessibleDescription('Choisissez un type d’opération.')
    expect(
      screen.getByRole('group', { name: 'Résultat *' }),
    ).toHaveAccessibleDescription('Choisissez un résultat.')
    expect(post).not.toHaveBeenCalled()
    await user.selectOptions(
      screen.getByLabelText('Type d’opération *'),
      typeId,
    )
    await user.click(screen.getByRole('radio', { name: 'Échouée' }))
    await user.clear(screen.getByLabelText('Date de réalisation *'))
    await user.type(screen.getByLabelText('Température (°C) *'), '1,2,5')
    await user.type(
      screen.getByLabelText('Rechercher un opérateur par nom'),
      'not-a-person',
    )
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    expect(screen.getByLabelText('Date de réalisation *')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText('Température (°C) *')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText('Sous vide *')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText('Opérateur réel')).toHaveValue(actor)
    expect(post).not.toHaveBeenCalled()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/users'))).toBe(
      false,
    )
  })
  it.each(['Température (°C) *', 'Sous vide *'])(
    'bloque un paramètre obligatoire absent : %s',
    async (label) => {
      await openForm()
      const user = await fillForm()
      if (label === 'Sous vide *')
        await user.selectOptions(screen.getByLabelText(label), '')
      else await user.clear(screen.getByLabelText(label))
      expect(screen.getByLabelText(label)).toBeInvalid()
      await user.click(
        screen.getByRole('button', { name: 'Enregistrer l’étape' }),
      )
      expect(post).not.toHaveBeenCalled()
    },
  )
  it('évite les doubles enregistrements pendant une requête', async () => {
    let finish!: (response: Response) => void
    post.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    await openForm()
    const user = await fillForm()
    await user.dblClick(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    expect(post).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Enregistrement…' }),
    ).toBeDisabled()
    finish(Response.json({ ...legacy, id: 'created' }, { status: 201 }))
    await screen.findByText('Étape enregistrée.')
    await waitFor(() =>
      expect(screen.getByText('Aucune étape enregistrée.')).toBeVisible(),
    )
  })
  it('conserve la saisie après une erreur réseau POST', async () => {
    post.mockRejectedValueOnce(new TypeError('Network failed'))
    await openForm()
    const user = await fillForm()
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre',
    )
    expect(screen.getByLabelText('Température (°C) *')).toHaveValue(precise)
  })
  it('affiche les anciennes étapes et les paramètres structurés dans l’ordre API', async () => {
    history = [
      legacy,
      {
        ...legacy,
        id: 'second',
        operationName: 'Dépôt répété',
        performedAt: '2026-10-28T08:00:00Z',
        result: 'FAILURE',
        stepType: type,
        operator: { id: 'operator', name: 'Alex' },
        parameterValues: [
          {
            id: 'n',
            definition: type.parameters[0],
            numericValue: precise,
            textValue: null,
            booleanValue: null,
          },
          {
            id: 'b',
            definition: type.parameters[2],
            numericValue: null,
            textValue: null,
            booleanValue: false,
          },
        ],
      },
    ]
    actor = 'other-researcher'
    open()
    await screen.findByRole('heading', { name: 'Dépôt répété' })
    const items = screen.getByRole('list').querySelectorAll('li')
    expect(items[0]).toHaveTextContent('Ancienne opération')
    expect(items[1]).toHaveTextContent('Dépôt répété')
    await userEvent.click(
      screen.getAllByRole('button', {
        name: /Afficher les détails de l’étape/,
      })[1],
    )
    expect(screen.getAllByText('Puissance = 120 W')).toHaveLength(3)
    expect(screen.getByText(precise.replace('.', ',') + ' °C')).toBeVisible()
    expect(screen.getByText('Non', { exact: true })).toBeVisible()
    expect(screen.getByText('Alex')).toBeVisible()
    expect(screen.getByText('Échouée')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Enregistrer une étape' }),
    ).not.toBeInTheDocument()
  })
  it.each([
    ['RESEARCHER', owner, 'ACTIVE', true],
    ['ADMIN', 'other-admin', 'ACTIVE', true],
    ['RESEARCHER', 'other', 'ACTIVE', false],
    ['ADMIN', 'other', 'ABANDONED', false],
    ['RESEARCHER', owner, 'ABANDONED', false],
    ['RESEARCHER', owner, null, true],
  ])(
    'contrôle la visibilité pour %s / %s / %s',
    async (nextRole, nextActor, nextStatus, allowed) => {
      role = nextRole
      actor = nextActor
      status = nextStatus as string
      open()
      await screen.findByText('Aucune étape enregistrée.')
      expect(
        !!screen.queryByRole('button', { name: 'Enregistrer une étape' }),
      ).toBe(allowed)
      expect(
        fetcher.mock.calls.some(([url]) => String(url).endsWith('/step-types')),
      ).toBe(false)
    },
  )
  it.each(['SUCCESS', 'FAILURE'])(
    'enregistre %s, conserve les décimaux et actualise l’historique',
    async (result) => {
      await openForm()
      const user = await fillForm(result)
      await user.type(
        screen.getByLabelText('Observations'),
        'Essai de fabrication',
      )
      await user.selectOptions(screen.getByLabelText('Opérateur réel'), owner)
      await user.click(
        screen.getByRole('button', { name: 'Enregistrer l’étape' }),
      )
      expect(await screen.findByText('Étape enregistrée.')).toBeVisible()
      expect(
        await screen.findByRole('heading', { name: 'Dépôt' }),
      ).toBeVisible()
      await userEvent.click(
        screen
          .getAllByRole('button', { name: /Afficher les détails de l’étape/ })
          .at(-1)!,
      )
      expect(screen.getByText(precise.replace('.', ',') + ' °C')).toBeVisible()
      expect(screen.getByText('Argon')).toBeVisible()
      expect(
        screen.getByText('Opérateur réel', { selector: 'dd' }),
      ).toBeVisible()
      expect(post).toHaveBeenCalledTimes(1)
      const body = post.mock.calls[0][0] as Record<string, unknown>
      expect(body.result).toBe(result)
      expect(body.performedAt).toBe(
        new Date('2026-10-29T10:30:00').toISOString(),
      )
      expect(body.parameterValues).toEqual([
        { definitionId: numericId, value: precise },
        { definitionId: textId, value: 'Argon' },
        { definitionId: booleanId, value: false },
      ])
      expect(body).not.toHaveProperty('recordedById')
      expect(body).not.toHaveProperty('parameters')
      expect(
        fetcher.mock.calls.filter(
          ([url, options]) =>
            String(url).endsWith('/steps') && options.method !== 'POST',
        ),
      ).toHaveLength(2)
    },
  )
  it('génère les types, unités et champs obligatoires', async () => {
    await openForm()
    await userEvent.selectOptions(
      screen.getByLabelText('Type d’opération *'),
      typeId,
    )
    expect(screen.getByLabelText('Température (°C) *')).toHaveAttribute(
      'type',
      'text',
    )
    expect(screen.getByLabelText('Température (°C) *')).toBeRequired()
    expect(screen.getByLabelText('Gaz')).not.toBeRequired()
    expect(screen.getByLabelText('Sous vide *')).toBeRequired()
    await userEvent.click(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    expect(post).not.toHaveBeenCalled()
  })
  it('refuse un décimal invalide et conserve la saisie', async () => {
    await openForm()
    const user = await fillForm()
    await user.clear(screen.getByLabelText('Température (°C) *'))
    await user.type(screen.getByLabelText('Température (°C) *'), '1e-6')
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('sans exposant')
    expect(post).not.toHaveBeenCalled()
  })
  it('conserve les paramètres au retour au type initial', async () => {
    types = [
      type,
      { ...type, id: 'other-type', name: 'Nettoyage', parameters: [] },
    ]
    await openForm()
    const user = await fillForm()
    await user.selectOptions(
      screen.getByLabelText('Type d’opération *'),
      'other-type',
    )
    expect(
      screen.queryByLabelText('Température (°C) *'),
    ).not.toBeInTheDocument()
    await user.selectOptions(
      screen.getByLabelText('Type d’opération *'),
      typeId,
    )
    expect(screen.getByLabelText('Température (°C) *')).toHaveValue(precise)
  })
  it('ne propose aucun type inactif et gère un catalogue vide', async () => {
    types = [{ ...type, isActive: false }]
    open()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Enregistrer une étape' }),
    )
    expect(
      await screen.findByText(/Aucun type d’opération actif/),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Enregistrer l’étape' }),
    ).not.toBeInTheDocument()
  })
  it.each([400, 403, 404, 409])(
    'affiche une erreur POST %s sans perdre la saisie',
    async (code) => {
      post.mockResolvedValue(
        Response.json(
          {
            message:
              code === 400
                ? ['Opérateur inconnu.']
                : 'Ce type d’étape est désactivé.',
          },
          { status: code },
        ),
      )
      await openForm()
      const user = await fillForm()
      await user.click(
        screen.getByRole('button', { name: 'Enregistrer l’étape' }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        code === 403
          ? 'droits'
          : code === 400
            ? 'Opérateur inconnu'
            : 'désactivé',
      )
      expect(screen.getByLabelText('Température (°C) *')).toHaveValue(precise)
      expect(screen.queryByText('Étape enregistrée.')).not.toBeInTheDocument()
    },
  )
  it('ferme la session en cas de 401 sur l’historique', async () => {
    historyResponse = async () => Response.json({}, { status: 401 })
    open()
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeVisible()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('permet de réessayer l’historique après une panne réseau', async () => {
    historyResponse = async () => {
      throw new TypeError('Network failed')
    }
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre',
    )
    historyResponse = undefined
    await userEvent.click(
      screen.getByRole('button', { name: 'Réessayer l’historique' }),
    )
    expect(await screen.findByText('Aucune étape enregistrée.')).toBeVisible()
  })
  it('permet de réessayer le catalogue après une erreur', async () => {
    catalogueResponse = async () => Response.json({}, { status: 403 })
    open()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Enregistrer une étape' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('droits')
    catalogueResponse = undefined
    await userEvent.click(
      screen.getByRole('button', { name: 'Réessayer le catalogue' }),
    )
    expect(await screen.findByLabelText('Type d’opération *')).toBeVisible()
  })
  it('normalise la virgule sans perte de précision avant le POST', async () => {
    await openForm()
    const user = await fillForm()
    await user.clear(screen.getByLabelText('Température (°C) *'))
    await user.click(screen.getByLabelText('Température (°C) *'))
    await user.paste(precise.replace('.', ','))
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer l’étape' }),
    )
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][0]).toMatchObject({
      parameterValues: expect.arrayContaining([
        { definitionId: numericId, value: precise },
      ]),
    })
  })
  it('demande confirmation avant de perdre une saisie et conserve les champs si refus', async () => {
    await openForm()
    const user = await fillForm()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'Annuler la saisie' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Température (°C) *')).toHaveValue(precise)
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Enregistrer une étape' }),
    ).toHaveFocus()
    expect(post).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
  it('annule une saisie sans appel POST', async () => {
    await openForm()
    await userEvent.click(
      screen.getByRole('button', { name: 'Annuler la saisie' }),
    )
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('Validation textuelle des paramètres', () => {
  it.each([
    '1e3',
    'NaN',
    'Infinity',
    '1,2',
    '.5',
    '1.',
    '9'.repeat(36),
    '0.' + '1'.repeat(31),
  ])('refuse %s', (value) => expect(validDecimal(value)).toBe(false))
  it.each([
    precise,
    '-0.125',
    '+0001.00',
    '0.' + '0'.repeat(50),
    '1.2' + '0'.repeat(40),
  ])('accepte sans conversion %s', (value) =>
    expect(validDecimal(value)).toBe(true),
  )
  it('distingue faux, absence et texte vide accepté par le backend', () => {
    expect(() => parameterValues(type, { [numericId]: '1' })).toThrow(
      'obligatoire',
    )
    expect(
      parameterValues(type, { [numericId]: '1', [booleanId]: 'false' }),
    ).toEqual([
      { definitionId: numericId, value: '1' },
      { definitionId: booleanId, value: false },
    ])
    expect(
      parameterValues(
        { ...type, parameters: [{ ...type.parameters[1], isRequired: true }] },
        {},
      ),
    ).toEqual([{ definitionId: textId, value: '' }])
  })
})
