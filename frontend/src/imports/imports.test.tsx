import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { MeasurementImports } from './MeasurementImports'
import { AuthContext, type AuthContextValue } from '../auth/context'
import { createApiClient } from '../api/client'

const type = {
  id: 'type',
  name: 'Recuit',
  isActive: true,
  parameters: [
    {
      id: 'temp',
      name: 'Température',
      dataType: 'NUMBER',
      unit: '°C',
      isRequired: true,
    },
    {
      id: 'material',
      name: 'Matériau',
      dataType: 'TEXT',
      unit: null,
      isRequired: false,
    },
  ],
}
const imported = {
  id: 'import',
  rowCount: 1,
  stepId: null,
  createdAt: '2026-10-31T10:00:00Z',
  sourceAttachment: { id: 'file', originalName: 'mesures.csv' },
  createdBy: { name: 'Karim Test' },
  stepType: { name: 'Recuit' },
}
let calls: { path: string; method: string; body: unknown }[],
  invalid: boolean,
  duplicate: boolean,
  commitError: number,
  imports: (typeof imported)[]
beforeEach(() => {
  calls = []
  invalid = false
  duplicate = false
  commitError = 0
  imports = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = new URL(url).pathname,
        method = options.method ?? 'GET',
        body =
          options.body instanceof FormData
            ? options.body
            : options.body
              ? JSON.parse(options.body as string)
              : undefined
      calls.push({ path, method, body })
      if (path === '/step-types') return Response.json([type])
      if (path === '/samples/sample/steps')
        return Response.json([
          {
            id: 'step',
            operationName: 'Recuit',
            performedAt: '2026-10-31T10:00:00Z',
            stepType: { id: 'type' },
          },
        ])
      if (path === '/samples/sample/files')
        return Response.json(
          method === 'POST'
            ? { id: 'file' }
            : [
                {
                  id: 'file',
                  originalName: 'mesures.csv',
                  mimeType: 'text/csv',
                },
              ],
        )
      if (path.endsWith('/inspect'))
        return Response.json({
          headers: ['Température (°C)', 'Matériau'],
          rowCount: 1,
        })
      if (path.endsWith('/preview'))
        return Response.json({
          rowCount: 1,
          validRowCount: invalid ? 0 : 1,
          errorCount: invalid ? 1 : 0,
          headers: ['Température (°C)', 'Matériau'],
          rows: [
            {
              row: 1,
              line: 2,
              cells: ['150.123456789012345678901234567890', 'PET'],
            },
          ],
          errors: invalid
            ? [
                {
                  row: 1,
                  line: 2,
                  column: 'Température (°C)',
                  message: 'Valeur numérique invalide.',
                },
              ]
            : [],
          duplicate,
          canConfirm: !invalid && !duplicate,
          previewToken: !invalid && !duplicate ? 'signed-preview' : null,
        })
      if (path === '/samples/sample/imports' && method === 'POST') {
        if (commitError)
          return Response.json(
            { message: 'Conflit : rechargez la prévisualisation.' },
            { status: commitError },
          )
        imports = [imported]
        return Response.json(imported, { status: 201 })
      }
      if (path === '/samples/sample/imports/import')
        return Response.json({
          ...imported,
          values: [
            {
              id: 'value',
              rowNumber: 1,
              numericValue: '150.12345678901234567890123456789',
              textValue: null,
              booleanValue: null,
              definition: { name: 'Température', unit: '°C' },
            },
          ],
        })
      if (path === '/samples/sample/imports') return Response.json(imports)
      throw Error('Unexpected request ' + path)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())
function setup(authorized = true) {
  const api = createApiClient({
    baseUrl: 'http://localhost:3000',
    initialToken: 'mock-token',
    onUnauthorized: vi.fn(),
  })
  render(
    <AuthContext.Provider
      value={
        { api, user: { id: 'owner', role: 'RESEARCHER' } } as AuthContextValue
      }
    >
      <MeasurementImports sampleId="sample" authorized={authorized} />
    </AuthContext.Provider>,
  )
  return userEvent.setup()
}
async function configured() {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Importer un CSV' }))
  await user.selectOptions(
    await screen.findByLabelText('Ou choisir un CSV déjà ajouté'),
    'file',
  )
  await user.click(screen.getByRole('button', { name: 'Lire les colonnes' }))
  await user.selectOptions(
    screen.getByLabelText('Type de paramètres du catalogue'),
    'type',
  )
  await user.selectOptions(
    await screen.findByLabelText('Température (°C)', { selector: 'select' }),
    'temp',
  )
  await user.selectOptions(
    screen.getByLabelText('Matériau', { selector: 'select' }),
    'material',
  )
  return user
}
it('loads metadata lazily, maps units and confirms only after preview and explicit consent', async () => {
  const user = await configured()
  expect(screen.getByLabelText('Unité source — Température (°C)')).toHaveValue(
    '°C',
  )
  const save = screen.getByRole('button', { name: 'Enregistrer les mesures' })
  expect(save).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: 'Prévisualiser et vérifier' }),
  )
  expect(
    await screen.findByText('150.123456789012345678901234567890'),
  ).toBeVisible()
  expect(save).toBeDisabled()
  const check = screen.getByRole('checkbox')
  await user.click(check)
  await user.click(save)
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(await screen.findByText('mesures.csv')).toBeInTheDocument()
  const sent = calls.find(
    (c) => c.method === 'POST' && c.path === '/samples/sample/imports',
  )!.body
  expect(sent).toEqual({
    attachmentId: 'file',
    stepTypeId: 'type',
    delimiter: ';',
    decimalSeparator: '.',
    mappings: [
      { column: 0, definitionId: 'temp', unit: '°C' },
      { column: 1, definitionId: 'material', unit: null },
    ],
    confirmed: true,
    previewToken: 'signed-preview',
  })
  await user.click(
    screen.getByRole('button', { name: 'Consulter les mesures' }),
  )
  expect(
    await screen.findByText('150,12345678901234567890123456789 °C'),
  ).toBeVisible()
})
it('clears confirmation after settings change and preserves optional step association', async () => {
  const user = await configured()
  await user.selectOptions(
    screen.getByLabelText('Association à une étape (facultatif)'),
    'step',
  )
  await user.selectOptions(
    screen.getByLabelText('Température (°C)', { selector: 'select' }),
    'temp',
  )
  await user.click(
    screen.getByRole('button', { name: 'Prévisualiser et vérifier' }),
  )
  await user.click(await screen.findByRole('checkbox'))
  await user.selectOptions(screen.getByLabelText('Séparateur décimal'), ',')
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Enregistrer les mesures' }),
  ).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: 'Prévisualiser et vérifier' }),
  )
  expect(
    calls.filter((c) => c.path.endsWith('/preview')).at(-1)!.body as {
      stepId: string
      decimalSeparator: string
    },
  ).toMatchObject({ stepId: 'step', decimalSeparator: ',' })
})
it.each(['invalid', 'duplicate'])(
  'does not allow confirmation for %s CSV',
  async (kind) => {
    const user = await configured()
    invalid = kind === 'invalid'
    duplicate = kind === 'duplicate'
    await user.click(
      screen.getByRole('button', { name: 'Prévisualiser et vérifier' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      invalid ? 'Ligne CSV 2' : 'déjà été importé',
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Enregistrer les mesures' }),
    ).toBeDisabled()
  },
)
it.each([400, 401, 403, 409, 500])(
  'keeps errors visible after failed confirmation %s',
  async (status) => {
    const user = await configured()
    await user.click(
      screen.getByRole('button', { name: 'Prévisualiser et vérifier' }),
    )
    await user.click(await screen.findByRole('checkbox'))
    commitError = status
    await user.click(
      screen.getByRole('button', { name: 'Enregistrer les mesures' }),
    )
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('dialog')).toBeVisible()
  },
)
it('permits all authenticated readers to consult imports without offering upload', async () => {
  imports = [imported]
  const user = setup(false)
  expect(calls).toHaveLength(0)
  expect(
    screen.queryByRole('button', { name: 'Importer un CSV' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Mesures importées' }))
  expect(await screen.findByText('mesures.csv')).toBeVisible()
})
it('uploads once via the existing private attachment API and reuses the source when changing delimiters', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: 'Importer un CSV' }))
  await user.upload(
    await screen.findByLabelText('Fichier CSV UTF-8'),
    new File(['temperature;material\n150;PET'], 'measure.csv', {
      type: 'text/csv',
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Lire les colonnes' }))
  await screen.findByRole('heading', { name: 'Correspondance des colonnes' })
  await user.selectOptions(screen.getByLabelText('Séparateur de colonnes'), ',')
  await user.click(screen.getByRole('button', { name: 'Lire les colonnes' }))
  expect(
    calls.filter((c) => c.path.endsWith('/files') && c.method === 'POST'),
  ).toHaveLength(1)
  expect(
    calls.find((c) => c.path.endsWith('/files') && c.method === 'POST')!.body,
  ).toBeInstanceOf(FormData)
})
it('confirms closing dirty input and returns focus to opener', async () => {
  const user = await configured()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  confirm.mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: 'Annuler' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Importer un CSV' })).toHaveFocus()
  confirm.mockRestore()
})
