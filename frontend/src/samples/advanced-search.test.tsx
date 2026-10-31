import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { advancedQueryError, readNumericFilters } from './advanced-query'

const temperature = 'e16a7c0b-c2c6-449d-910f-6e2dccf7c814'
const duration = '1aa3deee-837d-4101-af94-abcb73c7bf11'
const batch = '3deeffc4-a338-416b-af8d-a3c1cfe0e838'
const operation = '762849cc-220e-4e4f-b4af-2e1593697d0e'
const profile = {
  id: 'owner',
  name: 'Karim Test',
  email: 'karim@example.test',
  role: 'RESEARCHER',
  isActive: true,
  createdAt: '2026-10-30T08:00:00Z',
}
const sample = {
  id: 'sample',
  reference: 'K24-017',
  name: 'Capteur PET',
  creatorId: profile.id,
  createdAt: profile.createdAt,
  updatedAt: profile.createdAt,
  status: 'ACTIVE',
  batchId: batch,
  parentId: null,
  originStepId: null,
  description: null,
}
const definitions = [
  {
    id: temperature,
    key: 'temperature',
    name: 'Température',
    dataType: 'NUMBER',
    unit: '°C',
    isRequired: true,
    stepType: { code: 'RECUIT', name: 'Recuit', isActive: true },
  },
  {
    id: duration,
    key: 'duration',
    name: 'Durée',
    dataType: 'NUMBER',
    unit: 'min',
    isRequired: true,
    stepType: { code: 'RECUIT', name: 'Recuit', isActive: true },
  },
]
let queries: URL[]
let paths: string[]
beforeEach(() => {
  queries = []
  paths = []
  sessionStorage.setItem(
    'labo.session',
    JSON.stringify({ token: 'mock-advanced', expiresAt: Date.now() + 3600000 }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string, options: RequestInit = {}) => {
      expect(options.method ?? 'GET').toBe('GET')
      const url = new URL(raw)
      paths.push(url.pathname)
      if (url.pathname === '/auth/me') return Response.json(profile)
      if (url.pathname === '/samples/numeric-parameters')
        return Response.json(definitions)
      if (url.pathname === '/batches')
        return Response.json([{ id: batch, reference: 'LOT-PET' }])
      if (url.pathname === '/samples/search-operation-types')
        return Response.json([
          { id: operation, name: 'Recuit', code: 'RECUIT', isActive: true },
        ])
      if (url.pathname === '/samples') {
        queries.push(url)
        return Response.json([sample])
      }
      throw Error(`Unexpected request ${url.pathname}`)
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})
function open(query = '') {
  render(
    <MemoryRouter initialEntries={['/samples' + query]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}
async function advanced() {
  const user = userEvent.setup()
  await screen.findByRole('link', { name: sample.name })
  await user.click(screen.getByRole('button', { name: 'Filtres' }))
  await user.click(screen.getByRole('button', { name: 'Ajouter des critères' }))
  await screen.findByRole('option', { name: 'LOT-PET' })
  return user
}

it('combine les critères, préserve les chaînes décimales et relance une soumission identique après fermeture', async () => {
  open()
  const user = await advanced()
  await user.type(screen.getByLabelText('Référence ou nom'), 'PET')
  await user.selectOptions(
    screen.getByLabelText('Statut', { exact: true }),
    'ACTIVE',
  )
  await user.selectOptions(screen.getByLabelText('Lot', { exact: true }), batch)
  await user.selectOptions(
    screen.getByLabelText('Type d’opération recherché'),
    operation,
  )
  await user.selectOptions(
    screen.getByLabelText('Portée du type et des paramètres'),
    'SAME_STEP',
  )
  await user.click(
    screen.getByRole('button', { name: 'Ajouter un critère numérique' }),
  )
  await user.selectOptions(
    screen.getByLabelText('Paramètre du critère 1'),
    temperature,
  )
  await user.selectOptions(
    screen.getByLabelText('Comparaison du critère 1'),
    'exact',
  )
  const precise = '150.000000000000000000000000000001'
  await user.type(screen.getByLabelText('Valeur exacte du critère 1'), precise)
  await user.click(
    screen.getByRole('button', { name: 'Ajouter un critère numérique' }),
  )
  await user.selectOptions(
    screen.getByLabelText('Paramètre du critère 2'),
    duration,
  )
  await user.type(screen.getByLabelText('Minimum du critère 2'), '10')
  await user.type(screen.getByLabelText('Maximum du critère 2'), '20')
  await user.click(screen.getByRole('button', { name: /^Rechercher$/ }))
  await screen.findByRole('link', { name: sample.name })
  const latest = queries.at(-1)!.searchParams
  expect(latest.get('q')).toBe('PET')
  expect(latest.get('status')).toBe('ACTIVE')
  expect(latest.get('batchId')).toBe(batch)
  expect(latest.get('stepTypeId')).toBe(operation)
  expect(latest.get('matchMode')).toBe('SAME_STEP')
  expect(JSON.parse(latest.get('numericFilters')!)).toEqual([
    { parameterDefinitionId: temperature, eq: precise },
    { parameterDefinitionId: duration, min: '10', max: '20' },
  ])
  await user.click(screen.getByRole('button', { name: 'Filtres' }))
  const before = queries.length
  await user.click(screen.getByRole('button', { name: /^Rechercher$/ }))
  await screen.findByRole('link', { name: sample.name })
  expect(queries).toHaveLength(before + 1)
  expect(queries.at(-1)!.search).toBe('?' + latest.toString())
  await user.click(screen.getByRole('button', { name: 'Filtres' }))
  expect(screen.getByLabelText('Valeur exacte du critère 1')).toHaveValue(
    precise,
  )
})
it('restaure les critères depuis une URL et conserve la distinction de portée', async () => {
  const filters = [
    { parameterDefinitionId: temperature, eq: '120' },
    { parameterDefinitionId: temperature, eq: '150' },
  ]
  open(
    '?' +
      new URLSearchParams({
        matchMode: 'ANY_STEP',
        numericFilters: JSON.stringify(filters),
      }),
  )
  await screen.findByLabelText('Valeur exacte du critère 2')
  expect(screen.getByLabelText('Portée du type et des paramètres')).toHaveValue(
    'ANY_STEP',
  )
  expect(screen.getByLabelText('Valeur exacte du critère 1')).toHaveValue('120')
  const user = userEvent.setup()
  await user.selectOptions(
    screen.getByLabelText('Portée du type et des paramètres'),
    'SAME_STEP',
  )
  await user.click(screen.getByRole('button', { name: /^Rechercher$/ }))
  await screen.findByRole('link', { name: sample.name })
  expect(queries.at(-1)!.searchParams.get('matchMode')).toBe('SAME_STEP')
  expect(
    JSON.parse(queries.at(-1)!.searchParams.get('numericFilters')!),
  ).toEqual(filters)
})
it('borne le nombre de filtres, permet leur retrait et évite les requêtes par critère', async () => {
  open()
  const user = await advanced()
  const count = paths.length
  for (let i = 0; i < 10; i++)
    await user.click(
      screen.getByRole('button', { name: 'Ajouter un critère numérique' }),
    )
  expect(
    screen.getByRole('button', { name: 'Ajouter un critère numérique' }),
  ).toBeDisabled()
  expect(paths).toHaveLength(count)
  await user.click(
    screen.getByRole('button', { name: 'Retirer le critère numérique 5' }),
  )
  expect(
    screen.getAllByRole('group', { name: /^Critère numérique/ }),
  ).toHaveLength(9)
  expect(
    screen.getByRole('button', { name: 'Ajouter un critère numérique' }),
  ).toBeEnabled()
})
it('valide un critère incomplet ou un nombre JSON imprécis sans effectuer la recherche', async () => {
  open()
  const user = await advanced()
  await user.click(
    screen.getByRole('button', { name: 'Ajouter un critère numérique' }),
  )
  const before = queries.length
  await user.click(screen.getByRole('button', { name: /^Rechercher$/ }))
  expect(screen.getByRole('alert')).toHaveTextContent('Choisissez un paramètre')
  await user.selectOptions(
    screen.getByLabelText('Paramètre du critère 1'),
    temperature,
  )
  await user.type(screen.getByLabelText('Minimum du critère 1'), '1e2')
  await user.click(screen.getByRole('button', { name: /^Rechercher$/ }))
  expect(screen.getByRole('alert')).toHaveTextContent('sans exposant')
  expect(queries).toHaveLength(before)
})
it('un JSON d’URL invalide ne fait pas planter la page et peut être remplacé', async () => {
  open('?numericFilters=broken')
  expect(
    await screen.findByText(/Les critères de cette URL sont invalides/),
  ).toBeVisible()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'Ajouter un critère numérique' }),
  )
  await user.selectOptions(
    screen.getByLabelText('Paramètre du critère 1'),
    temperature,
  )
  await user.type(screen.getByLabelText('Minimum du critère 1'), '150')
  await user.click(screen.getByRole('button', { name: /^Rechercher$/ }))
  await screen.findByRole('link', { name: sample.name })
  expect(
    JSON.parse(queries.at(-1)!.searchParams.get('numericFilters')!),
  ).toEqual([{ parameterDefinitionId: temperature, min: '150' }])
})
it.each([
  'broken',
  '{}',
  'null',
  '[null]',
  JSON.stringify([{ parameterDefinitionId: temperature, eq: 150 }]),
])('refuse une structure numérique mal formée (%s)', (raw) => {
  expect(readNumericFilters(raw)).toBeNull()
  expect(
    advancedQueryError(new URLSearchParams({ numericFilters: raw })),
  ).toContain('invalides')
})
it('le plafond inclut le paramètre simple et interdit le mélange exact/intervalle', () => {
  expect(
    advancedQueryError(
      new URLSearchParams({
        parameterDefinitionId: temperature,
        numericFilters: JSON.stringify(
          Array.from({ length: 10 }, () => ({
            parameterDefinitionId: duration,
            eq: '20',
          })),
        ),
      }),
    ),
  ).toContain('10 critères')
  expect(
    advancedQueryError(
      new URLSearchParams({
        numericFilters: JSON.stringify([
          { parameterDefinitionId: temperature, eq: '150', min: '120' },
        ]),
      }),
    ),
  ).toContain('valeur exacte ou un intervalle')
})
