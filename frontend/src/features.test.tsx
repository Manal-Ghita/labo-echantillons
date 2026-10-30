import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { SESSION_KEY } from './auth/session'

const owner = '87da980d-d334-48ae-9a09-bdd68a1feaa8'
const sampleId = '5d8f6fc0-32d9-4828-acab-a0d18ba340ad'
const numberId = '01751530-a733-4e3f-a72c-a8c08785d95a'
const profile = {
  id: owner,
  name: 'Camille',
  email: 'camille@example.test',
  role: 'ADMIN',
  createdAt: '2026-10-29T08:00:00Z',
  isActive: true,
}
const definition = {
  id: numberId,
  key: 'temperature',
  name: 'Température',
  dataType: 'NUMBER',
  unit: '°C',
  isRequired: true,
}
const type = {
  id: '06d1546b-65cf-4fe6-a35e-84164b90af14',
  name: 'Dépôt',
  code: 'DEPOT',
  isActive: true,
  description: null,
  parameters: [definition],
}
const original = {
  id: sampleId,
  name: 'Film souple',
  reference: 'K24-017',
  creatorId: owner,
  status: 'ACTIVE',
  description: null,
  createdAt: '2026-10-29T08:00:00Z',
  isActive: true,
  updatedAt: '2026-10-29T08:00:00Z',
  batchId: null,
  parentId: null,
  originStepId: null,
}
const originalStep = {
  id: '9d8f6fc0-32d9-4828-acab-a0d18ba340ad',
  revision: 0,
  operationName: 'Dépôt',
  performedAt: '2026-10-29T08:00:00Z',
  recordedAt: '2026-10-29T08:00:00Z',
  parameters: 'Ancien cahier',
  observations: 'Initiales',
  result: 'SUCCESS',
  recordedBy: { id: owner, name: 'Camille' },
  operator: null,
  stepType: type,
  parameterValues: [
    {
      id: 'v',
      definition,
      numericValue: '1.123456789012345678901234567891',
      textValue: null,
      booleanValue: null,
    },
  ],
}
let actor: typeof profile
let sample: typeof original
let step: typeof originalStep
let fetcher: ReturnType<
  typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>
>
let mutationError: number | undefined
function open(path = '/users') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  actor = { ...profile }
  sample = { ...original }
  step = structuredClone(originalStep)
  mutationError = undefined
  sessionStorage.clear()
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: 'extended-test-token',
      expiresAt: Date.now() + 3600000,
    }),
  )
  fetcher = vi.fn(async (url, options) => {
    if (url.endsWith('/auth/me')) return Response.json(actor)
    if (mutationError && ['POST', 'PATCH'].includes(options.method ?? ''))
      return Response.json(
        { message: 'Conflit de données.' },
        { status: mutationError },
      )
    if (url.endsWith('/users'))
      return Response.json(
        options.method === 'POST'
          ? { ...profile, role: 'RESEARCHER' }
          : [profile],
        { status: options.method === 'POST' ? 201 : 200 },
      )
    if (url.endsWith('/step-types')) return Response.json([type])
    if (url.endsWith('/samples/numeric-parameters'))
      return Response.json([{ ...definition, stepType: type }])
    if (url.endsWith('/status')) {
      sample = { ...sample, ...JSON.parse(options.body as string) }
      return Response.json(sample)
    }
    if (url.endsWith('/corrections')) {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body as string)
        step = {
          ...step,
          revision: 1,
          observations: body.observations,
          parameterValues: [
            {
              ...step.parameterValues[0],
              numericValue: body.parameterValues[0].value,
            },
          ],
        }
        return Response.json(step, { status: 201 })
      }
      return Response.json([
        {
          id: 'audit',
          revision: 1,
          reason: 'Erreur de transcription',
          correctedAt: originalStep.recordedAt,
          correctedBy: { id: owner, name: 'Camille' },
          beforeSnapshot: originalStep,
          afterSnapshot: step,
        },
      ])
    }
    if (url.endsWith('/steps')) return Response.json([step])
    if (url.endsWith(sampleId)) return Response.json(sample)
    return Response.json([sample])
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())
async function fillAccount() {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Ajouter un chercheur' }),
  )
  await user.type(
    await screen.findByLabelText('Nom complet *'),
    'Nouveau chercheur',
  )
  await user.type(screen.getByLabelText('Adresse e-mail *'), 'new@example.test')
  await user.type(
    screen.getByLabelText('Mot de passe initial *'),
    'test-password-42',
  )
  return user
}
describe('Comptes RESEARCHER', () => {
  it('crée un chercheur sans champ rôle et efface les mots de passe', async () => {
    open()
    const user = await fillAccount()
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(await screen.findByText('Compte chercheur créé.')).toBeVisible()
    const call = fetcher.mock.calls.find(
      ([, options]) => options.method === 'POST',
    )!
    expect(JSON.parse(call[1].body as string)).toEqual({
      name: 'Nouveau chercheur',
      email: 'new@example.test',
      password: 'test-password-42',
    })
    expect(
      screen.queryByLabelText('Mot de passe initial *'),
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Ajouter un chercheur' }),
    )
    expect(screen.getByLabelText('Mot de passe initial *')).toHaveValue('')
  })
  it('interdit la page et le lien à RESEARCHER', async () => {
    actor.role = 'RESEARCHER'
    open()
    expect(
      await screen.findByRole('heading', { name: 'Accès non autorisé' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Comptes' }),
    ).not.toBeInTheDocument()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/users'))).toBe(
      false,
    )
  })
  it('refuse un mot de passe dépassant 72 octets UTF-8', async () => {
    open()
    const user = await fillAccount()
    await user.clear(screen.getByLabelText('Mot de passe initial *'))
    await user.type(
      screen.getByLabelText('Mot de passe initial *'),
      'é'.repeat(37),
    )
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vérifiez')
    expect(
      screen.getByLabelText('Mot de passe initial *'),
    ).toHaveAccessibleDescription(/72 octets UTF-8/)
    expect(
      fetcher.mock.calls.some(([, options]) => options.method === 'POST'),
    ).toBe(false)
  })
  it.each([400, 403, 409])(
    'affiche %i et efface le mot de passe après refus',
    async (status) => {
      mutationError = status
      open()
      const user = await fillAccount()
      await user.click(screen.getByRole('button', { name: 'Créer le compte' }))
      expect(await screen.findByRole('alert')).toBeVisible()
      expect(screen.getByLabelText('Adresse e-mail *')).toHaveValue(
        'new@example.test',
      )
      expect(screen.getByLabelText('Mot de passe initial *')).toHaveValue('')
    },
  )
})
describe('Recherche et état', () => {
  it('referme les filtres sans perdre les critères, unités ni combinaison textuelle', async () => {
    open('/samples?q=Silicium')
    const user = userEvent.setup()
    const toggle = await screen.findByRole('button', { name: 'Filtres' })
    await user.click(toggle)
    const group = await screen.findByRole('group', {
      name: 'Paramètre numérique',
    })
    await user.selectOptions(screen.getByLabelText('Paramètre'), definition.id)
    expect(
      within(group).getByLabelText('Valeur minimale'),
    ).toHaveAccessibleDescription(/°C/)
    await user.type(screen.getByLabelText('Valeur minimale'), '10.125')
    await user.type(screen.getByLabelText('Valeur maximale'), '45')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(group).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([url]) => {
          const params = new URL(url).searchParams
          return (
            params.get('q') === 'Silicium' &&
            params.get('min') === '10.125' &&
            params.get('max') === '45' &&
            params.get('parameterDefinitionId') === definition.id
          )
        }),
      ).toBe(true),
    )
    await user.click(toggle)
    expect(screen.getByLabelText('Valeur minimale')).toHaveValue('10.125')
    expect(screen.getByLabelText('Valeur maximale')).toHaveValue('45')
  })
  it('retrouve TEST-WAFER-001 après correction PVD en relançant les mêmes bornes 40–45', async () => {
    actor.role = 'RESEARCHER'
    const definitionId = 'e1492d7d-060d-4750-8a7c-65cba9051930'
    const pvd = { ...type, code: 'DEPOT_PVD', name: 'Déposition PVD' }
    const thickness = {
      ...definition,
      id: definitionId,
      key: 'epaisseur_nm',
      name: 'Épaisseur',
      unit: 'nm',
      stepType: pvd,
    }
    const wafer = {
      ...original,
      reference: 'TEST-WAFER-001',
      name: 'Wafer silicium — essai PVD',
    }
    let steps: { result: string; numericValue: string; revision: number }[] = []
    fetcher.mockImplementation(async (url, options) => {
      if (url.endsWith('/auth/me')) return Response.json(actor)
      if (url.endsWith('/samples/numeric-parameters'))
        return Response.json([thickness])
      const params = new URL(url).searchParams
      expect(options.method ?? 'GET').toBe('GET')
      expect(params.get('parameterDefinitionId')).toBe(definitionId)
      expect(params.get('min')).toBe('40')
      expect(params.get('max')).toBe('45')
      const matches = steps.some(
        (step) =>
          Number(step.numericValue) >= 40 && Number(step.numericValue) <= 45,
      )
      return Response.json(matches ? [wafer] : [])
    })
    open(`/samples?parameterDefinitionId=${definitionId}&min=40&max=45`)
    await screen.findByRole('heading', { name: 'Aucun résultat' })
    await screen.findByRole('option', {
      name: 'DEPOT_PVD — Déposition PVD / Épaisseur (nm)',
    })
    // Changes made in another tab must be visible when this list is resubmitted.
    steps = [
      { result: 'SUCCESS', numericValue: '42.125', revision: 0 },
      { result: 'FAILURE', numericValue: '37.5', revision: 0 },
    ]
    steps[0] = { result: 'SUCCESS', numericValue: '42.375', revision: 1 }
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    expect(await screen.findByRole('link', { name: wafer.name })).toBeVisible()
    expect(
      fetcher.mock.calls.filter(
        ([url]) => new URL(url).pathname === '/samples',
      ),
    ).toHaveLength(2)
    expect(screen.getByLabelText('Valeur minimale')).toHaveValue('40')
    expect(screen.getByLabelText('Valeur maximale')).toHaveValue('45')
  })
  it('affiche les paramètres archivés déjà utilisés', async () => {
    const originalFetch = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, options) =>
      url.endsWith('/samples/numeric-parameters')
        ? Promise.resolve(
            Response.json([
              { ...definition, stepType: { ...type, isActive: false } },
            ]),
          )
        : originalFetch(url, options),
    )
    open(`/samples?parameterDefinitionId=${numberId}&min=0`)
    expect(
      await screen.findByRole('option', {
        name: 'DEPOT — Dépôt (archivé) / Température (°C)',
      }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Paramètre')).toHaveValue(numberId)
  })
  it('conserve la définition de l’URL après le chargement asynchrone du catalogue', async () => {
    open(`/samples?parameterDefinitionId=${numberId}&min=42.125&max=42.125`)
    await screen.findByRole('option', {
      name: 'DEPOT — Dépôt / Température (°C)',
    })
    expect(screen.getByLabelText('Paramètre')).toHaveValue(numberId)
    await userEvent.clear(screen.getByLabelText('Valeur minimale'))
    await userEvent.type(screen.getByLabelText('Valeur minimale'), '42.126')
    await userEvent.clear(screen.getByLabelText('Valeur maximale'))
    await userEvent.type(screen.getByLabelText('Valeur maximale'), '42.126')
    await userEvent.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) =>
            url.includes(`parameterDefinitionId=${numberId}`) &&
            url.includes('min=42.126') &&
            url.includes('max=42.126'),
        ),
      ).toBe(true),
    )
  })
  it('transmet les bornes précises sous forme de chaînes dans l’URL', async () => {
    open('/samples')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Filtres' }))
    await user.selectOptions(screen.getByLabelText('Paramètre'), numberId)
    await user.type(
      screen.getByLabelText('Valeur minimale'),
      '0.123456789012345678901234567891',
    )
    await user.type(screen.getByLabelText('Valeur maximale'), '1')
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) =>
            url.includes('min=0.123456789012345678901234567891') &&
            url.includes('max=1') &&
            url.includes(numberId),
        ),
      ).toBe(true),
    )
    await user.click(
      screen.getByRole('button', { name: 'Effacer la recherche' }),
    )
    expect(screen.getByLabelText('Valeur minimale')).toHaveValue('')
  })
  it('abandonne puis réactive avec confirmation et conserve l’historique', async () => {
    open(`/samples/${sampleId}`)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Abandonner l’échantillon' }),
    )
    expect(
      fetcher.mock.calls.some(([, options]) => options.method === 'PATCH'),
    ).toBe(false)
    await user.click(
      screen.getByRole('button', { name: 'Confirmer l’abandon' }),
    )
    await screen.findByRole('button', { name: 'Réactiver l’échantillon' })
    expect(
      screen.queryByRole('button', { name: 'Enregistrer une étape' }),
    ).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Dépôt' })).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Réactiver l’échantillon' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirmer la réactivation' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Enregistrer une étape' }),
    ).toBeVisible()
    expect(
      fetcher.mock.calls
        .filter(([, options]) => options.method === 'PATCH')
        .map(([, options]) => JSON.parse(options.body as string)),
    ).toEqual([{ status: 'ABANDONED' }, { status: 'ACTIVE' }])
  })
  it('n’offre aucun changement d’état à un autre chercheur', async () => {
    actor = { ...profile, id: 'another', role: 'RESEARCHER' }
    open(`/samples/${sampleId}`)
    await screen.findByRole('heading', { name: 'Film souple' })
    expect(
      screen.queryByRole('button', { name: 'Abandonner l’échantillon' }),
    ).not.toBeInTheDocument()
  })
  it('garde le statut après un conflit', async () => {
    mutationError = 409
    open(`/samples/${sampleId}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Abandonner l’échantillon' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmer l’abandon' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Conflit')
    expect(screen.getAllByText('Actif')).toHaveLength(1)
  })
})
describe('Corrections visibles', () => {
  async function expand() {
    await userEvent.click(
      await screen.findByRole('button', {
        name: /Afficher les détails de l’étape 1/,
      }),
    )
  }
  it('corrige sans changer l’auteur, actualise et affiche avant/après', async () => {
    open(`/samples/${sampleId}`)
    await expand()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Corriger l’étape' }),
    )
    await user.type(
      screen.getByLabelText('Motif de correction *'),
      'Erreur de transcription',
    )
    await user.clear(screen.getByLabelText('Température (°C) *'))
    await user.type(screen.getByLabelText('Température (°C) *'), '42.125')
    await user.click(
      screen.getByRole('button', { name: 'Confirmer la correction' }),
    )
    expect(await screen.findByText('42,125 °C')).toBeVisible()
    const call = fetcher.mock.calls.find(
      ([url, options]) =>
        url.endsWith('/corrections') && options.method === 'POST',
    )!
    const body = JSON.parse(call[1].body as string)
    expect(body.expectedRevision).toBe(0)
    expect(body.reason).toBe('Erreur de transcription')
    expect(body).not.toHaveProperty('correctedById')
    await user.click(
      screen.getByRole('button', { name: /Afficher les corrections/ }),
    )
    const journal = await screen.findByRole('region', {
      name: 'Journal des corrections',
    })
    expect(
      within(journal).getByText('Motif : Erreur de transcription'),
    ).toBeVisible()
    await user.click(
      within(journal).getByText('Voir les valeurs avant et après'),
    )
    expect(
      within(journal).getByText('1,123456789012345678901234567891 °C'),
    ).toBeVisible()
    expect(within(journal).getByText('42,125 °C')).toBeVisible()
  })
  it('autorise la consultation du journal pour un autre chercheur', async () => {
    actor = { ...profile, id: 'other', role: 'RESEARCHER' }
    step = { ...step, revision: 1 }
    open(`/samples/${sampleId}`)
    await expand()
    await userEvent.click(
      await screen.findByRole('button', { name: /Afficher les corrections/ }),
    )
    expect(
      await screen.findByRole('region', { name: 'Journal des corrections' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Corriger l’étape' }),
    ).not.toBeInTheDocument()
  })
  it('conserve une saisie en conflit de révision', async () => {
    mutationError = 409
    open(`/samples/${sampleId}`)
    await expand()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Corriger l’étape' }),
    )
    await userEvent.type(
      screen.getByLabelText('Motif de correction *'),
      'Erreur de transcription',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmer la correction' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Conflit')
    expect(screen.getByLabelText('Motif de correction *')).toHaveValue(
      'Erreur de transcription',
    )
  })
})
