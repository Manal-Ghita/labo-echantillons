import { expect, test } from '@playwright/test'

const temperature = 'e16a7c0b-c2c6-449d-910f-6e2dccf7c814',
  duration = '1aa3deee-837d-4101-af94-abcb73c7bf11'
const batchId = '3deeffc4-a338-416b-af8d-a3c1cfe0e838',
  typeId = '762849cc-220e-4e4f-b4af-2e1593697d0e'
const profile = {
  id: 'researcher',
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
  creatorId: 'owner',
  status: 'ACTIVE',
  batchId,
  description: null,
  parentId: null,
  originStepId: null,
  createdAt: profile.createdAt,
  updatedAt: profile.createdAt,
}
const definitions = [
  {
    id: temperature,
    name: 'Température',
    key: 'temperature',
    dataType: 'NUMBER',
    unit: '°C',
    isRequired: true,
    stepType: { code: 'RECUIT', name: 'Recuit', isActive: true },
  },
  {
    id: duration,
    name: 'Durée',
    key: 'duration',
    dataType: 'NUMBER',
    unit: 'min',
    isRequired: true,
    stepType: { code: 'RECUIT', name: 'Recuit', isActive: true },
  },
]
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'mock-advanced',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
})

test('recherche ET, précision, portée, URL et nouvelle soumission après fermeture sur desktop/mobile', async ({
  page,
}, testInfo) => {
  const queries: URL[] = []
  await page.route('http://localhost:3000/**', (route) => {
    const req = route.request(),
      url = new URL(req.url())
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(req.method()).toBe('GET')
    if (url.pathname === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (url.pathname === '/samples/numeric-parameters')
      return route.fulfill({ headers: cors, json: definitions })
    if (url.pathname === '/batches')
      return route.fulfill({
        headers: cors,
        json: [{ id: batchId, reference: 'LOT-PET' }],
      })
    if (url.pathname === '/samples/search-operation-types')
      return route.fulfill({
        headers: cors,
        json: [{ id: typeId, name: 'Recuit', code: 'RECUIT', isActive: true }],
      })
    expect(url.pathname).toBe('/samples')
    queries.push(url)
    return route.fulfill({
      headers: cors,
      json: url.searchParams.get('matchMode') === 'SAME_STEP' ? [] : [sample],
    })
  })
  await page.goto('/samples')
  await page.getByRole('button', { name: 'Filtres', exact: true }).click()
  await page
    .getByRole('button', { name: 'Ajouter des critères', exact: true })
    .click()
  await page.getByLabel('Référence ou nom').fill('PET')
  await page.getByLabel('Statut', { exact: true }).selectOption('ACTIVE')
  await page.getByLabel('Lot', { exact: true }).selectOption(batchId)
  await page.getByLabel('Type d’opération recherché').selectOption(typeId)
  await page
    .getByLabel('Portée du type et des paramètres')
    .selectOption('SAME_STEP')
  await page
    .getByRole('button', { name: 'Ajouter un critère numérique', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  await page
    .getByLabel('Paramètre du critère 1', { exact: true })
    .selectOption(temperature)
  await page.getByLabel('Comparaison du critère 1').selectOption('exact')
  const precise = '150.000000000000000000000000000001'
  await page.getByLabel('Valeur exacte du critère 1').fill(precise)
  await page
    .getByRole('button', { name: 'Ajouter un critère numérique', exact: true })
    .click()
  await page
    .getByLabel('Paramètre du critère 2', { exact: true })
    .selectOption(duration)
  await page.getByLabel('Minimum du critère 2').fill('20')
  await page.getByLabel('Maximum du critère 2').fill('20')
  await expect(
    page.locator('.advanced-row').first().getByText('°C', { exact: true }),
  ).toBeVisible()
  const inputBox = (await page
    .getByLabel('Valeur exacte du critère 1')
    .boundingBox())!
  const unitBox = (await page
    .locator('.advanced-row')
    .first()
    .getByText('°C', { exact: true })
    .boundingBox())!
  expect(unitBox.x).toBeGreaterThan(inputBox.x)
  expect(unitBox.x + unitBox.width).toBeLessThan(inputBox.x + inputBox.width)
  expect(unitBox.y).toBeGreaterThanOrEqual(inputBox.y)
  expect(unitBox.y + unitBox.height).toBeLessThanOrEqual(
    inputBox.y + inputBox.height,
  )
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Aucun résultat', exact: true }),
  ).toBeVisible()
  const current = new URL(page.url()).searchParams
  expect(current.get('q')).toBe('PET')
  expect(current.get('status')).toBe('ACTIVE')
  expect(current.get('batchId')).toBe(batchId)
  expect(current.get('stepTypeId')).toBe(typeId)
  expect(JSON.parse(current.get('numericFilters')!)).toEqual([
    { parameterDefinitionId: temperature, eq: precise },
    { parameterDefinitionId: duration, min: '20', max: '20' },
  ])
  await page
    .getByLabel('Portée du type et des paramètres')
    .selectOption('ANY_STEP')
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect(
    page.getByRole('rowheader', { name: sample.reference }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Filtres', exact: true }).click()
  const before = queries.length
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect.poll(() => queries.length).toBe(before + 1)
  await page.getByRole('button', { name: 'Filtres', exact: true }).click()
  await expect(page.getByLabel('Valeur exacte du critère 1')).toHaveValue(
    precise,
  )
  await page
    .getByRole('button', { name: 'Retirer le critère numérique 2' })
    .click()
  await expect(page.locator('.advanced-row')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
  await page.screenshot({
    path: testInfo.outputPath('advanced-search.png'),
    fullPage: true,
  })
  await page.reload()
  await expect(page.locator('.advanced-row')).toHaveCount(2)
  await expect(page.getByLabel('Portée du type et des paramètres')).toHaveValue(
    'ANY_STEP',
  )
})

test('validation, plafond de critères et chargement borné des métadonnées', async ({
  page,
}) => {
  let searches = 0,
    definitionsCalls = 0
  await page.route('http://localhost:3000/**', (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(req.method()).toBe('GET')
    if (path === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (path === '/samples/numeric-parameters') {
      definitionsCalls++
      return route.fulfill({ headers: cors, json: definitions })
    }
    if (path === '/batches' || path === '/samples/search-operation-types')
      return route.fulfill({ headers: cors, json: [] })
    expect(path).toBe('/samples')
    searches++
    return route.fulfill({ headers: cors, json: [sample] })
  })
  await page.goto('/samples')
  await page.getByRole('button', { name: 'Filtres', exact: true }).click()
  await page
    .getByRole('button', { name: 'Ajouter des critères', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Ajouter un critère numérique', exact: true })
    .click()
  await page
    .getByLabel('Paramètre du critère 1', { exact: true })
    .selectOption(temperature)
  await page.getByLabel('Minimum du critère 1').fill('1e2')
  const before = searches
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('sans exposant')
  expect(searches).toBe(before)
  const calls = definitionsCalls
  for (let i = 1; i < 10; i++)
    await page
      .getByRole('button', {
        name: 'Ajouter un critère numérique',
        exact: true,
      })
      .click()
  await expect(
    page.getByRole('button', {
      name: 'Ajouter un critère numérique',
      exact: true,
    }),
  ).toBeDisabled()
  expect(definitionsCalls).toBe(calls)
  await page
    .getByRole('button', { name: 'Retirer le critère numérique 5' })
    .click()
  await expect(page.locator('.advanced-row')).toHaveCount(9)
  await expect(
    page.getByRole('button', {
      name: 'Ajouter un critère numérique',
      exact: true,
    }),
  ).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
})
