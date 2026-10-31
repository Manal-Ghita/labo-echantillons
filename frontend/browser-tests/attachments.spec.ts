import { test, expect } from '@playwright/test'

const profile = {
  id: 'owner',
  name: 'Karim Test',
  email: 'karim@example.test',
  role: 'RESEARCHER',
  isActive: true,
  createdAt: '2026-10-31T10:00:00Z',
}
const sample = {
  id: 'sample',
  reference: 'K24-017',
  name: 'Capteur sur film PET',
  creatorId: 'owner',
  status: 'ACTIVE',
  description: 'Synthetic browser data',
  parentId: null,
  originStepId: null,
  batchId: null,
  parent: null,
  children: [],
  originStep: null,
  createdAt: profile.createdAt,
  updatedAt: profile.createdAt,
}
const step = {
  id: 'step',
  sampleId: 'sample',
  operationName: 'Recuit',
  performedAt: profile.createdAt,
  recordedAt: profile.createdAt,
  recordedBy: { id: 'owner', name: 'Karim Test' },
  operator: null,
  parameters: '150 °C',
  observations: null,
  result: 'SUCCESS',
  revision: 0,
  parameterValues: [],
  stepType: null,
}
const file = {
  id: 'file',
  originalName: 'mesures.csv',
  mimeType: 'text/csv',
  size: 35,
  createdAt: profile.createdAt,
  createdBy: { id: 'owner', name: 'Karim Test' },
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

test('sample and step attachments: upload, authenticated download, errors, responsive layout and consultation rights', async ({
  page,
}) => {
  let failure = false,
    role = 'RESEARCHER',
    actor = 'owner'
  let sampleFiles: (typeof file)[] = [],
    stepFiles: (typeof file)[] = [],
    writes = 0
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({ token: 'mock-files', expiresAt: Date.now() + 3600000 }),
    ),
  )
  await page.route('http://localhost:3000/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    expect(req.headers().authorization).toBe('Bearer mock-files')
    let body: unknown
    if (path === '/auth/me') body = { ...profile, id: actor, role }
    else if (path === '/samples/sample') body = sample
    else if (path === '/samples/sample/steps') body = [step]
    else if (path.endsWith('/files')) {
      if (req.method() === 'POST') {
        writes++
        expect(req.postDataBuffer()?.toString()).toContain(
          '150.123456789012345678901234567890',
        )
        expect(req.headers()['content-type']).toContain(
          'multipart/form-data; boundary=',
        )
        if (failure) {
          await route.fulfill({
            status: 415,
            headers: cors,
            json: { message: 'Format refusé' },
          })
          return
        }
        if (path.includes('/steps/')) stepFiles = [file]
        else sampleFiles = [file]
        await route.fulfill({ status: 201, headers: cors, json: file })
        return
      }
      body = path.includes('/steps/') ? stepFiles : sampleFiles
    } else if (path === '/files/file/download') {
      await route.fulfill({
        status: 200,
        headers: {
          ...cors,
          'content-disposition': 'attachment; filename="mesures.csv"',
        },
        contentType: 'text/csv',
        body: 'time,value\n0,150.123456789012345678901234567890\n',
      })
      return
    } else {
      await route.fulfill({
        status: 404,
        headers: cors,
        json: { message: path },
      })
      return
    }
    await route.fulfill({ status: 200, headers: cors, json: body })
  })
  await page.goto('/samples/sample')
  await page
    .getByRole('button', { name: 'Photos et fichiers', exact: true })
    .first()
    .click()
  await expect(page.getByText('Aucun fichier associé.')).toBeVisible()
  const input = page.getByLabel('Ajouter un fichier')
  const payload = {
    name: 'mesures.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('time,value\n0,150.123456789012345678901234567890\n'),
  }
  await input.setInputFiles(payload)
  failure = true
  await page
    .getByRole('button', { name: 'Ajouter le fichier', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Format de fichier refusé',
  )
  failure = false
  await page
    .getByRole('button', { name: 'Ajouter le fichier', exact: true })
    .click()
  await expect(page.getByText('mesures.csv', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('mesures.csv')
  await page
    .getByRole('button', { name: 'Afficher les détails de l’étape 1' })
    .click()
  const timeline = page.locator('.timeline-step')
  await timeline
    .getByRole('button', { name: 'Photos et fichiers', exact: true })
    .click()
  await timeline.getByLabel('Ajouter un fichier').setInputFiles(payload)
  await timeline
    .getByRole('button', { name: 'Ajouter le fichier', exact: true })
    .click()
  await expect(timeline.getByText('mesures.csv', { exact: true })).toBeVisible()
  expect(writes).toBe(3)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  actor = 'other'
  await page.reload()
  await page
    .getByRole('button', { name: 'Photos et fichiers', exact: true })
    .first()
    .click()
  await expect(page.getByRole('button', { name: 'Télécharger' })).toBeVisible()
  await expect(page.getByLabel('Ajouter un fichier')).toHaveCount(0)
  role = 'ADMIN'
  await page.reload()
  await page
    .getByRole('button', { name: 'Photos et fichiers', exact: true })
    .first()
    .click()
  await expect(page.getByLabel('Ajouter un fichier')).toBeVisible()
  await page.getByRole('button', { name: 'Masquer les fichiers' }).focus()
  await page.keyboard.press('Enter')
  await expect(
    page
      .getByRole('button', { name: 'Photos et fichiers', exact: true })
      .first(),
  ).toBeFocused()
})
