import { expect, test } from '@playwright/test'

const profile = {
  id: 'owner',
  name: 'Karim Test',
  email: 'karim@example.test',
  role: 'RESEARCHER',
  isActive: true,
  createdAt: '2026-10-30T08:00:00Z',
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}
const samples = [1, 2].map((i) => ({
  id: `sample-${i}`,
  reference: `K24-01${i}`,
  name: 'Capteur PET',
  creatorId: profile.id,
  status: 'ACTIVE',
  batchId: null as string | null,
  createdAt: profile.createdAt,
  updatedAt: profile.createdAt,
  description: null,
  parentId: null,
  originStepId: null,
}))
const type = {
  id: 'type',
  code: 'RECUIT',
  name: 'Recuit',
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

test('lot, association et saisie groupée indépendante, avec erreur atomique et panneau accessible', async ({
  page,
}, testInfo) => {
  const members = structuredClone(samples)
  let created = false,
    fail = true,
    writes = 0
  await page.route('http://localhost:3000/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    const batch = {
      id: 'batch',
      reference: 'LOT-PET',
      createdById: profile.id,
      createdBy: { id: profile.id, name: profile.name },
      createdAt: profile.createdAt,
      samples: members.filter((s) => s.batchId === 'batch'),
    }
    if (path === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (path === '/samples')
      return route.fulfill({ headers: cors, json: members })
    if (path === '/step-types')
      return route.fulfill({ headers: cors, json: [type] })
    if (path === '/users/operators')
      return route.fulfill({
        headers: cors,
        json: [
          { id: profile.id, name: profile.name },
          { id: 'julien', name: 'Julien' },
        ],
      })
    if (path === '/batches' && req.method() === 'POST') {
      expect(req.postDataJSON()).toEqual({ reference: 'LOT-PET' })
      created = true
      return route.fulfill({ status: 201, headers: cors, json: batch })
    }
    if (path === '/batches')
      return route.fulfill({
        headers: cors,
        json: created
          ? [{ ...batch, _count: { samples: batch.samples.length } }]
          : [],
      })
    if (path === '/batches/batch')
      return route.fulfill({ headers: cors, json: batch })
    if (path === '/batches/batch/samples') {
      expect(req.postDataJSON()).toEqual({
        sampleIds: ['sample-1', 'sample-2'],
      })
      members.forEach((s) => {
        s.batchId = 'batch'
      })
      return route.fulfill({
        status: 201,
        headers: cors,
        json: { attached: 2 },
      })
    }
    if (path === '/batches/batch/steps') {
      const body = req.postDataJSON()
      expect(body.samples).toEqual([
        { sampleId: 'sample-1', result: 'SUCCESS' },
        { sampleId: 'sample-2', result: 'FAILURE' },
      ])
      expect(body.operation.parameterValues).toEqual([
        {
          definitionId: 'temperature',
          value: '150.12345678901234567890123456789',
        },
      ])
      expect(body.operation.operatorId).toBe('julien')
      expect(body.operation).not.toHaveProperty('recordedById')
      if (fail)
        return route.fulfill({
          status: 409,
          headers: cors,
          json: { message: 'Lot modifié : aucune étape enregistrée.' },
        })
      writes += 2
      return route.fulfill({ status: 201, headers: cors, json: [] })
    }
    throw Error(`Unexpected request ${path}`)
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'mock-batch-session',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/batches')
  await expect(page.getByText('Aucun lot enregistré.')).toBeVisible()
  await page.getByRole('button', { name: 'Créer un lot' }).click()
  await page.getByLabel('Référence du lot *').fill('LOT-PET')
  await page.getByRole('button', { name: 'Enregistrer le lot' }).click()
  await expect(page.getByRole('heading', { name: 'LOT-PET' })).toBeVisible()
  for (const s of members)
    await page
      .getByRole('checkbox', { name: `${s.reference} · ${s.name}` })
      .check()
  await page.getByRole('button', { name: 'Associer au lot' }).click()
  for (const s of members)
    await page
      .getByRole('checkbox', { name: `Sélectionner ${s.reference}` })
      .check()
  const open = page.getByRole('button', {
    name: 'Enregistrer une opération groupée',
  })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Opération groupée' })
  await expect(
    page.getByRole('button', { name: 'Fermer le panneau' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(open).toBeFocused()
  await open.click()
  await page.getByLabel('Type d’opération *').selectOption('type')
  await page
    .getByLabel('Température (°C) *')
    .fill('150,12345678901234567890123456789')
  await page.getByRole('radio', { name: 'Réussie', exact: true }).check()
  await page.getByLabel('Résultat pour K24-012').selectOption('FAILURE')
  await page
    .getByLabel('Opérateur réel', { exact: true })
    .selectOption('julien')
  page.once('dialog', (d) => d.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page
    .getByRole('button', { name: 'Enregistrer pour la sélection' })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'aucune étape enregistrée',
  )
  expect(writes).toBe(0)
  await expect(page.getByLabel('Température (°C) *')).toHaveValue(
    '150,12345678901234567890123456789',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
  await page.screenshot({ path: testInfo.outputPath('batch-group-panel.png') })
  fail = false
  await page
    .getByRole('button', { name: 'Enregistrer pour la sélection' })
    .click()
  await expect(
    page.getByText(
      'Opérations enregistrées pour tous les échantillons sélectionnés.',
    ),
  ).toBeVisible()
  expect(writes).toBe(2)
  await expect(dialog).toHaveCount(0)
})

test('autre chercheur : consultation du lot sans action sur les échantillons d’autrui', async ({
  page,
}) => {
  await page.route('http://localhost:3000/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(route.request().method()).toBe('GET')
    if (path === '/auth/me')
      return route.fulfill({ headers: cors, json: { ...profile, id: 'other' } })
    if (path === '/samples')
      return route.fulfill({ headers: cors, json: samples })
    return route.fulfill({
      headers: cors,
      json: {
        id: 'batch',
        reference: 'LOT-PET',
        createdById: profile.id,
        createdBy: profile,
        createdAt: profile.createdAt,
        samples,
      },
    })
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({ token: 'mock-other', expiresAt: Date.now() + 3600000 }),
    ),
  )
  await page.goto('/batches/batch')
  await expect(page.getByRole('heading', { name: 'LOT-PET' })).toBeVisible()
  await expect(page.getByRole('checkbox').first()).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Enregistrer une opération groupée' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Associer au lot' }),
  ).toHaveCount(0)
})
