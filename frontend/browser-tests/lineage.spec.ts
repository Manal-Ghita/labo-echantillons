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
const parent = {
  id: 'parent',
  reference: 'K24-017',
  name: 'Capteur PET parent',
  description: 'Film souple',
  creatorId: 'owner',
  status: 'ACTIVE',
  createdAt: profile.createdAt,
  updatedAt: profile.createdAt,
  parentId: null,
  originStepId: null,
  batchId: 'lot',
  parent: null,
  originStep: null,
}
const step = {
  id: 'origin',
  operationName: 'Découpe',
  performedAt: '2026-10-30T10:00:00Z',
  recordedAt: '2026-10-30T10:01:00Z',
  revision: 0,
  result: 'SUCCESS',
  recordedBy: { id: 'owner', name: profile.name },
  operator: null,
  parameters: null,
  observations: 'Historique du parent',
  stepType: null,
  parameterValues: [],
}

test('découpe, panneau clavier/mobile et liens parent-enfants, sans copie d’historique', async ({
  page,
}, testInfo) => {
  let children: {
    id: string
    reference: string
    name: string
    status: string
  }[] = []
  let fail = true,
    writes = 0
  await page.route('http://localhost:3000/**', (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    if (path === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (path === '/samples/parent/split') {
      expect(req.method()).toBe('POST')
      const body = req.postDataJSON()
      expect(body).toEqual({
        originStepId: 'origin',
        children: [
          { reference: 'K24-018', name: 'Film gauche' },
          { reference: 'K24-019', name: 'Film droit' },
        ],
      })
      if (fail)
        return route.fulfill({
          status: 409,
          headers: cors,
          json: { message: 'Conflit : aucun enfant créé.' },
        })
      children = body.children.map(
        (child: { reference: string; name: string }, i: number) => ({
          ...child,
          id: `child-${i}`,
          status: 'ACTIVE',
        }),
      )
      writes += 2
      return route.fulfill({ status: 201, headers: cors, json: children })
    }
    expect(req.method()).toBe('GET')
    if (path.endsWith('/steps'))
      return route.fulfill({
        headers: cors,
        json: path === '/samples/parent/steps' ? [step] : [],
      })
    if (path === '/samples/parent')
      return route.fulfill({ headers: cors, json: { ...parent, children } })
    const child = children.find((c) => path === `/samples/${c.id}`)
    if (child)
      return route.fulfill({
        headers: cors,
        json: {
          ...parent,
          ...child,
          batchId: null,
          parentId: parent.id,
          children: [],
          parent: {
            id: parent.id,
            reference: parent.reference,
            name: parent.name,
          },
          originStepId: step.id,
          originStep: step,
        },
      })
    throw Error(`Unexpected request ${path}`)
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'mock-lineage',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/samples/parent')
  const open = page.getByRole('button', {
    name: 'Créer des échantillons enfants',
    exact: true,
  })
  await open.click()
  const dialog = page.getByRole('dialog', {
    name: 'Créer des échantillons enfants',
  })
  await expect(
    page.getByRole('button', { name: 'Fermer le panneau' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(open).toBeFocused()
  await open.click()
  await page
    .getByRole('button', { name: 'Créer les enfants', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('obligatoires')
  expect(writes).toBe(0)
  for (const [i, name] of ['Film gauche', 'Film droit'].entries()) {
    await page
      .getByLabel(`Référence de l’enfant ${i + 1} *`)
      .fill(`K24-01${i + 8}`)
    await page.getByLabel(`Nom de l’enfant ${i + 1} *`).fill(name)
  }
  await page.getByLabel('Étape d’origine (facultatif)').selectOption('origin')
  page.once('dialog', (d) => d.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page
    .getByRole('button', { name: 'Créer les enfants', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText('aucun enfant créé')
  await expect(page.getByRole('alert')).toBeInViewport()
  expect(writes).toBe(0)
  await expect(page.getByLabel('Référence de l’enfant 1 *')).toHaveValue(
    'K24-018',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
  await page.screenshot({ path: testInfo.outputPath('split-panel.png') })
  fail = false
  await page
    .getByRole('button', { name: 'Créer les enfants', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'K24-018 · Film gauche' }),
  ).toBeVisible()
  expect(writes).toBe(2)
  await expect(page.locator('.step-history > li')).toHaveCount(1)
  await page.getByRole('link', { name: 'K24-018 · Film gauche' }).click()
  await expect(
    page.getByRole('heading', { name: 'Film gauche', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Aucune étape enregistrée.')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'K24-017 · Capteur PET parent' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'K24-017 · Capteur PET parent' }).click()
  await expect(page.locator('.step-history > li')).toHaveCount(1)
  await expect(page.locator('.page-heading .status-tag').first()).toHaveText(
    'Actif',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
  await page.screenshot({
    path: testInfo.outputPath('sample-lineage.png'),
    fullPage: true,
  })
})

test('autre chercheur consulte la filiation mais ne dispose pas de la découpe', async ({
  page,
}) => {
  await page.route('http://localhost:3000/**', (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(req.method()).toBe('GET')
    if (path === '/auth/me')
      return route.fulfill({
        headers: cors,
        json: { ...profile, id: 'reader' },
      })
    if (path.endsWith('/steps'))
      return route.fulfill({ headers: cors, json: [step] })
    return route.fulfill({
      headers: cors,
      json: {
        ...parent,
        children: [
          {
            id: 'child',
            reference: 'K24-018',
            name: 'Film gauche',
            status: 'ACTIVE',
          },
        ],
      },
    })
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'mock-lineage-reader',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/samples/parent')
  await expect(
    page.getByRole('link', { name: 'K24-018 · Film gauche' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Créer des échantillons enfants' }),
  ).toHaveCount(0)
})
