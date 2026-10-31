import { test, expect } from '@playwright/test'
const profile = {
  id: 'owner',
  name: 'Karim Test',
  email: 'synthetic@example.test',
  role: 'RESEARCHER',
  isActive: true,
  createdAt: '2026-10-31T10:00:00Z',
}
const sample = {
  id: 'sample',
  reference: 'K24-017',
  name: 'Capteur PET',
  creatorId: 'owner',
  status: 'ACTIVE',
  description: null,
  parentId: null,
  originStepId: null,
  batchId: null,
  parent: null,
  children: [],
  originStep: null,
  createdAt: profile.createdAt,
  updatedAt: profile.createdAt,
}
const catalogue = {
  id: 'type',
  name: 'Recuit',
  code: 'RECUIT',
  isActive: true,
  parameters: [
    {
      id: 'temperature',
      name: 'Température',
      dataType: 'NUMBER',
      unit: '°C',
      isRequired: true,
      key: 'temperature',
    },
  ],
}
const imported = {
  id: 'import',
  rowCount: 1,
  stepId: null,
  createdAt: profile.createdAt,
  createdBy: { name: profile.name },
  stepType: { name: 'Recuit' },
  sourceAttachment: { id: 'file', originalName: 'mesures.csv' },
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
test('CSV wizard: source, mapping, precise preview, explicit confirmation, consultation and responsive keyboard panel', async ({
  page,
}) => {
  let confirmed = false,
    previews = 0,
    writes = 0,
    actor = 'owner',
    role = 'RESEARCHER'
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({ token: 'mock-csv', expiresAt: Date.now() + 3600000 }),
    ),
  )
  await page.route('http://localhost:3000/**', async (route) => {
    const r = route.request(),
      p = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    expect(r.headers().authorization).toBe('Bearer mock-csv')
    let body: unknown
    if (p === '/auth/me') body = { ...profile, id: actor, role }
    else if (p === '/samples/sample') body = sample
    else if (p === '/samples/sample/steps') body = []
    else if (p === '/step-types') body = [catalogue]
    else if (p === '/samples/sample/files') {
      if (r.method() === 'POST') {
        expect(r.postDataBuffer()?.toString()).toContain(
          '150.123456789012345678901234567890',
        )
        body = { id: 'file' }
      } else body = []
    } else if (p.endsWith('/imports/inspect'))
      body = { headers: ['Température (°C)'], rowCount: 1 }
    else if (p.endsWith('/imports/preview')) {
      previews++
      expect(r.postDataJSON().mappings).toEqual([
        { column: 0, definitionId: 'temperature', unit: '°C' },
      ])
      body = {
        rowCount: 1,
        validRowCount: 1,
        errorCount: 0,
        errors: [],
        headers: ['Température (°C)'],
        rows: [
          { row: 1, line: 2, cells: ['150.123456789012345678901234567890'] },
        ],
        duplicate: false,
        canConfirm: true,
        previewToken: 'signed-preview',
      }
    } else if (p === '/samples/sample/imports' && r.method() === 'POST') {
      writes++
      expect(r.postDataJSON()).toMatchObject({
        confirmed: true,
        previewToken: 'signed-preview',
      })
      confirmed = true
      body = imported
    } else if (p === '/samples/sample/imports')
      body = confirmed ? [imported] : []
    else if (p.endsWith('/imports/import'))
      body = {
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
      }
    else {
      await route.fulfill({ status: 404, headers: cors, json: { message: p } })
      return
    }
    await route.fulfill({
      status: r.method() === 'POST' ? 201 : 200,
      headers: cors,
      json: body,
    })
  })
  await page.goto('/samples/sample')
  await page.getByRole('button', { name: 'Importer un CSV' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Fichier CSV UTF-8')
    .setInputFiles({
      name: 'mesures.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Température (°C)\n150.123456789012345678901234567890\n',
      ),
    })
  await dialog.getByRole('button', { name: 'Lire les colonnes' }).click()
  await dialog
    .getByLabel('Type de paramètres du catalogue')
    .selectOption('type')
  await dialog
    .getByLabel('Température (°C)', { exact: true })
    .selectOption('temperature')
  await expect(
    dialog.getByLabel('Unité source — Température (°C)'),
  ).toHaveValue('°C')
  const save = dialog.getByRole('button', { name: 'Enregistrer les mesures' })
  await expect(save).toBeDisabled()
  await dialog
    .getByRole('button', { name: 'Prévisualiser et vérifier' })
    .click()
  await expect(
    dialog.getByText('150.123456789012345678901234567890', { exact: true }),
  ).toBeVisible()
  await expect(save).toBeDisabled()
  expect(writes).toBe(0)
  await dialog.getByRole('checkbox').check()
  await save.dblclick()
  await expect(dialog).not.toBeVisible()
  expect(writes).toBe(1)
  expect(previews).toBe(1)
  await page.getByRole('button', { name: 'Consulter les mesures' }).click()
  await expect(
    page.getByText('150,12345678901234567890123456789 °C'),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Importer un CSV' }).click()
  await dialog
    .getByLabel('Fichier CSV UTF-8')
    .setInputFiles({
      name: 'mesures.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('t\n150'),
    })
  page.once('dialog', (d) => d.dismiss())
  await dialog.getByRole('button', { name: 'Fermer le panneau' }).click()
  await expect(dialog).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Importer un CSV' }),
  ).toBeFocused()
  actor = 'other'
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Importer un CSV' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Mesures importées' }).click()
  await expect(page.getByText('mesures.csv', { exact: true })).toBeVisible()
  role = 'ADMIN'
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Importer un CSV' }),
  ).toBeVisible()
})
