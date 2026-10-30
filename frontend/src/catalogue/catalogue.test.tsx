import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { SESSION_KEY } from '../auth/session'
import type { StepType } from '../fabrication/api'
import { validateParameters } from './api'

const id = '06d1546b-65cf-4fe6-a35e-84164b90af14'
const operation: StepType = {
  id,
  code: 'DEPOT',
  name: 'Dépôt',
  description: 'Dépôt de référence',
  isActive: true,
  parameters: [
    {
      id: 'number',
      key: 'temperature',
      name: 'Température',
      dataType: 'NUMBER',
      unit: '°C',
      isRequired: true,
    },
    {
      id: 'text',
      key: 'gaz',
      name: 'Gaz',
      dataType: 'TEXT',
      unit: null,
      isRequired: false,
    },
    {
      id: 'bool',
      key: 'vide',
      name: 'Sous vide',
      dataType: 'BOOLEAN',
      unit: null,
      isRequired: true,
    },
  ],
}
let role: 'ADMIN' | 'RESEARCHER'
let type: StepType
let business: ReturnType<
  typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>
>
function open(path = '/step-types') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  role = 'ADMIN'
  type = structuredClone(operation)
  sessionStorage.clear()
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'catalogue-test-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  business = vi.fn(async (url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body as string)
      type = {
        id,
        isActive: true,
        description: null,
        ...body,
        parameters: body.parameters.map((p: object, i: number) => ({
          ...p,
          id: `created-${i}`,
        })),
      }
      return Response.json(type, { status: 201 })
    }
    if (options.method === 'PATCH') {
      type = { ...type, ...JSON.parse(options.body as string) }
      return Response.json(type)
    }
    return Response.json(url.endsWith(id) ? type : [type])
  })
  vi.stubGlobal('fetch', (url: string, options: RequestInit) =>
    url.endsWith('/auth/me')
      ? Promise.resolve(
          Response.json({
            id: 'admin',
            name: 'Camille',
            email: 'camille@example.test',
            role,
            isActive: true,
            createdAt: '2026-10-29T08:00:00Z',
          }),
        )
      : business(url, options),
  )
})
afterEach(() => vi.unstubAllGlobals())
async function fillIdentity() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Code *'), ' DEPOT ')
  await user.type(screen.getByLabelText('Nom *'), ' Dépôt ')
  return user
}
async function addParameter(
  user: ReturnType<typeof userEvent.setup>,
  key: string,
  name: string,
  dataType = 'NUMBER',
) {
  await user.click(screen.getByRole('button', { name: 'Ajouter un paramètre' }))
  const fieldset = screen.getAllByRole('group').at(-1)!
  await user.type(within(fieldset).getByLabelText('Clé *'), key)
  await user.type(within(fieldset).getByLabelText('Nom du paramètre *'), name)
  await user.selectOptions(
    within(fieldset).getByLabelText('Type de valeur *'),
    dataType,
  )
  return within(fieldset)
}

describe('Catalogue réel simulé au niveau HTTP uniquement', () => {
  it('permet à RESEARCHER de consulter les définitions sans commandes ADMIN', async () => {
    role = 'RESEARCHER'
    open()
    await userEvent.click(await screen.findByRole('link', { name: 'Dépôt' }))
    expect(
      await screen.findByRole('heading', { name: 'Paramètres' }),
    ).toBeVisible()
    expect(screen.getByText('°C')).toBeVisible()
    expect(screen.getByText('NUMBER')).toBeVisible()
    expect(screen.getByText('TEXT')).toBeVisible()
    expect(screen.getByText('BOOLEAN')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Modifier le type' }),
    ).not.toBeInTheDocument()
    expect(business.mock.calls[0][0]).toBe('http://localhost:3000/step-types')
    expect(
      (business.mock.calls[0][1].headers as Headers).get('Authorization'),
    ).toBe('Bearer catalogue-test-token')
  })
  it('réserve la création et les types inactifs à ADMIN', async () => {
    role = 'RESEARCHER'
    open()
    await screen.findByRole('link', { name: 'Dépôt' })
    expect(
      screen.queryByText('Inclure les types inactifs'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Créer un type d’opération' }),
    ).not.toBeInTheDocument()
  })
  it('interdit l’accès direct au formulaire pour RESEARCHER', async () => {
    role = 'RESEARCHER'
    open('/step-types/new')
    expect(
      await screen.findByRole('heading', { name: 'Accès non autorisé' }),
    ).toBeVisible()
    expect(business).not.toHaveBeenCalled()
  })
  it('envoie includeInactive=true uniquement sur choix ADMIN', async () => {
    open()
    await userEvent.click(
      await screen.findByLabelText('Inclure les types inactifs'),
    )
    await waitFor(() =>
      expect(business).toHaveBeenCalledWith(
        'http://localhost:3000/step-types?includeInactive=true',
        expect.anything(),
      ),
    )
    await userEvent.click(screen.getByLabelText('Inclure les types inactifs'))
    await waitFor(() =>
      expect(business.mock.calls.at(-1)?.[0]).toBe(
        'http://localhost:3000/step-types',
      ),
    )
  })
  it('affiche un catalogue vide', async () => {
    business.mockResolvedValue(Response.json([]))
    open()
    expect(
      await screen.findByRole('heading', {
        name: 'Aucun type d’opération actif',
      }),
    ).toBeVisible()
  })
  it('crée un type sans paramètre puis ouvre le détail', async () => {
    open()
    await userEvent.click(
      await screen.findByRole('link', { name: 'Créer un type d’opération' }),
    )
    const user = await fillIdentity()
    await user.click(screen.getByRole('button', { name: 'Créer le type' }))
    expect(await screen.findByRole('heading', { name: 'Dépôt' })).toBeVisible()
    const call = business.mock.calls.find(
      ([, options]) => options.method === 'POST',
    )!
    expect(JSON.parse(call[1].body as string)).toEqual({
      code: 'DEPOT',
      name: 'Dépôt',
      parameters: [],
    })
  })
  it('crée les trois types de paramètres, leurs unités et leurs obligations', async () => {
    open('/step-types/new')
    const user = await fillIdentity()
    const number = await addParameter(user, 'temperature', 'Température')
    await user.type(number.getByLabelText('Unité'), ' °C ')
    await user.click(number.getByLabelText('Paramètre obligatoire'))
    await addParameter(user, 'gaz', 'Gaz', 'TEXT')
    await addParameter(user, 'vide', 'Sous vide', 'BOOLEAN')
    await user.click(screen.getByRole('button', { name: 'Créer le type' }))
    await screen.findByRole('heading', { name: 'Dépôt' })
    const call = business.mock.calls.find(
      ([, options]) => options.method === 'POST',
    )!
    expect(JSON.parse(call[1].body as string).parameters).toEqual([
      {
        key: 'temperature',
        name: 'Température',
        dataType: 'NUMBER',
        unit: '°C',
        isRequired: true,
      },
      { key: 'gaz', name: 'Gaz', dataType: 'TEXT', isRequired: false },
      {
        key: 'vide',
        name: 'Sous vide',
        dataType: 'BOOLEAN',
        isRequired: false,
      },
    ])
  })
  it('refuse les clés dupliquées et conserve le formulaire', async () => {
    open('/step-types/new')
    const user = await fillIdentity()
    await addParameter(user, 'temperature', 'Première')
    await addParameter(user, 'temperature', 'Seconde')
    await user.click(screen.getByRole('button', { name: 'Créer le type' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('uniques')
    expect(business).not.toHaveBeenCalled()
  })
  it('retire seulement un brouillon de paramètre avant création', async () => {
    open('/step-types/new')
    const user = await fillIdentity()
    await addParameter(user, 'a', 'Premier')
    await addParameter(user, 'b', 'Second')
    await user.click(
      screen.getByRole('button', { name: 'Retirer le paramètre 1' }),
    )
    expect(screen.getByLabelText('Clé *')).toHaveValue('b')
    await user.click(screen.getByRole('button', { name: 'Créer le type' }))
    await screen.findByRole('heading', { name: 'Dépôt' })
    const call = business.mock.calls.find(
      ([, options]) => options.method === 'POST',
    )!
    expect(JSON.parse(call[1].body as string).parameters).toHaveLength(1)
  })
  it('modifie les descriptions et désactive sans changer code ou définitions', async () => {
    open(`/step-types/${id}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Modifier le type' }),
    )
    expect(screen.getByLabelText('Code *')).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Ajouter un paramètre' }),
    ).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Nom *'))
    await userEvent.type(screen.getByLabelText('Nom *'), 'Dépôt révisé')
    await userEvent.clear(screen.getByLabelText('Description'))
    await userEvent.click(screen.getByLabelText('Type actif'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Enregistrer les modifications' }),
    )
    expect(
      await screen.findByText('Type d’opération mis à jour.'),
    ).toBeVisible()
    expect(screen.getByText('Inactif')).toBeVisible()
    const call = business.mock.calls.find(
      ([, options]) => options.method === 'PATCH',
    )!
    expect(JSON.parse(call[1].body as string)).toEqual({
      name: 'Dépôt révisé',
      description: null,
      isActive: false,
    })
    expect(type.parameters).toEqual(operation.parameters)
  })
  it('réactive un type inactif', async () => {
    type.isActive = false
    open(`/step-types/${id}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Modifier le type' }),
    )
    await userEvent.click(screen.getByLabelText('Type actif'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Enregistrer les modifications' }),
    )
    expect(
      await screen.findByText('Type d’opération mis à jour.'),
    ).toBeVisible()
    expect(screen.getByText('Actif')).toBeVisible()
  })
  it.each([400, 403, 409])(
    'affiche une erreur de création %i sans perdre les champs',
    async (status) => {
      business.mockResolvedValue(
        Response.json(
          {
            message:
              status === 400 ? ['Clé invalide.'] : 'Ce code existe déjà.',
          },
          { status },
        ),
      )
      open('/step-types/new')
      const user = await fillIdentity()
      await user.click(screen.getByRole('button', { name: 'Créer le type' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        status === 403
          ? 'droits'
          : status === 400
            ? 'Clé invalide'
            : 'existe déjà',
      )
      expect(screen.getByLabelText('Code *')).toHaveValue(' DEPOT ')
      expect(
        screen.getByRole('button', { name: 'Créer le type' }),
      ).toBeEnabled()
    },
  )
  it('ferme une session refusée sur le catalogue', async () => {
    business.mockResolvedValue(Response.json({}, { status: 401 }))
    open()
    expect(
      await screen.findByRole('heading', { name: 'Connexion' }),
    ).toBeVisible()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it('affiche un type inexistant', async () => {
    business.mockResolvedValue(
      Response.json({ message: 'Type d’étape introuvable.' }, { status: 404 }),
    )
    open(`/step-types/${id}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('introuvable')
  })
  it('propose de réessayer après une erreur réseau', async () => {
    business.mockRejectedValueOnce(new TypeError('Network failed'))
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('link', { name: 'Dépôt' })).toBeVisible()
  })
  it('valide les champs non vides et la forme des clés', async () => {
    open('/step-types/new')
    const user = await fillIdentity()
    const field = await addParameter(user, '1bad', 'Paramètre')
    expect(field.getByLabelText('Clé *')).toBeInvalid()
    await user.click(screen.getByRole('button', { name: 'Créer le type' }))
    expect(business).not.toHaveBeenCalled()
  })
})

describe('Validation conforme aux définitions backend', () => {
  it.each(['1bad', 'with-dash', 'avec espace', '_prefix'])(
    'refuse la clé %s',
    (key) => {
      expect(() =>
        validateParameters([
          { key, name: 'Nom', dataType: 'NUMBER', isRequired: false },
        ]),
      ).toThrow('Chaque clé')
    },
  )
  it('normalise les espaces et conserve la casse des clés', () => {
    expect(
      validateParameters([
        {
          key: ' Abc_2 ',
          name: ' Nom ',
          dataType: 'TEXT',
          isRequired: false,
          unit: '  ',
        },
      ]),
    ).toEqual([
      { key: 'Abc_2', name: 'Nom', dataType: 'TEXT', isRequired: false },
    ])
  })
})
