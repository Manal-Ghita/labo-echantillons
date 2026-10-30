import { expect, test } from '@playwright/test'

const owner = '87da980d-d334-48ae-9a09-bdd68a1feaa8'
const sample = {
  id: 'sample-drawer',
  reference: 'K24-017',
  name: 'Silicium',
  creatorId: owner,
  status: 'ACTIVE',
  description: 'Échantillon de test simulé',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
}
const type = {
  id: 'pvd',
  code: 'DEPOT_PVD',
  name: 'Déposition PVD',
  isActive: true,
  description: null,
  parameters: [
    {
      id: 'thickness',
      key: 'thickness',
      name: 'Épaisseur (nm)',
      dataType: 'NUMBER',
      unit: 'nm',
      isRequired: true,
    },
    {
      id: 'vacuum',
      key: 'vacuum',
      name: 'Sous vide',
      dataType: 'BOOLEAN',
      unit: null,
      isRequired: false,
    },
    {
      id: 'material',
      key: 'material',
      name: 'Matériau',
      dataType: 'TEXT',
      unit: null,
      isRequired: false,
    },
  ],
}

for (const width of [1440, 1024, 768, 390]) {
  test(`panneau accessible avec 50 étapes à ${width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'Four explicit viewport sizes cover this scenario.',
    )
    await page.setViewportSize({ width, height: 900 })
    const cors = {
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    }
    await page.route('http://localhost:3000/**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: cors })
      expect(route.request().method()).toBe('GET')
      const path = new URL(route.request().url()).pathname
      let data: unknown
      if (path === '/auth/me')
        data = {
          id: owner,
          name: 'Alex',
          email: 'alex@example.test',
          role: 'RESEARCHER', isActive: true,
          createdAt: sample.createdAt,
        }
      else if (path === `/samples/${sample.id}`) data = sample
      else if (path === '/users/operators') data = [{ id: owner, name: 'Alex' }]
      else if (path === '/step-types') data = [type]
      else if (path === `/samples/${sample.id}/steps`)
        data = Array.from({ length: 50 }, (_, index) => ({
          id: `step-${index}`,
          operationName: 'Déposition PVD',
          performedAt: `2026-10-29T${String(8 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z`,
          recordedAt: sample.createdAt,
          result: index === 0 ? 'FAILURE' : 'SUCCESS',
          parameters: null,
          observations: 'Observation conservée',
          operator: null,
          recordedBy: { id: owner, name: 'Alex' },
          stepType: type,
          parameterValues: [],
          revision: 1,
        }))
      else throw new Error(`Unexpected API request: ${path}`)
      return route.fulfill({ headers: cors, json: data })
    })
    await page.addInitScript(() =>
      sessionStorage.setItem(
        'labo.session',
        JSON.stringify({
          token: 'mock-drawer-token',
          expiresAt: Date.now() + 3600000,
        }),
      ),
    )
    await page.goto(`/samples/${sample.id}`)
    await expect(page.locator('.step-history > li')).toHaveCount(50)
    const open = page.getByRole('button', { name: 'Enregistrer une étape' })
    expect((await open.boundingBox())!.y).toBeLessThan(400)
    await expect(open).toBeInViewport()
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading')).toHaveCount(1)
    await expect(dialog.locator('header h2')).toHaveText(
      'Enregistrer une étape',
    )
    await expect(page.getByLabel('Type d’opération *')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Fermer le panneau' }),
    ).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(
      page.getByRole('button', { name: 'Annuler la saisie' }),
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('button', { name: 'Fermer le panneau' }),
    ).toBeFocused()
    await page.getByLabel('Type d’opération *').selectOption('pvd')
    await expect(page.locator('#step-type option:checked')).toHaveText(
      'Déposition PVD',
    )
    const number = page.getByLabel('Épaisseur (nm) *', { exact: true })
    await number.fill('42,375')
    await expect(page.locator('.entry-unit')).toHaveText('nm')
    await page.getByLabel('Matériau').fill('Aluminium libre')
    await expect(page.getByLabel('Matériau')).toHaveAttribute('type', 'text')
    const numberBox = (await page
      .locator('.entry-unit-field')
      .first()
      .boundingBox())!
    const boolBox = (await page.getByLabel('Sous vide').boundingBox())!
    if (width > 480) expect(numberBox.y).toBeCloseTo(boolBox.y, 0)
    else expect(boolBox.y).toBeGreaterThan(numberBox.y)
    await page.getByRole('radio', { name: 'Réussie' }).check()
    await page
      .getByLabel('Observations', { exact: true })
      .fill('Valeurs conservées sans enregistrement')
    await page
      .getByLabel('Opérateur réel', { exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      page.getByRole('button', { name: 'Enregistrer l’étape', exact: true }),
    ).toBeInViewport()
    await page.locator('.step-drawer-body').evaluate((element) => {
      element.scrollTop = 0
    })
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width)
    if (width > 820) expect((await dialog.boundingBox())!.x).toBeGreaterThan(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    await page.screenshot({
      path: testInfo.outputPath(`step-drawer-${width}.png`),
    })
    await number.fill('1,2,3')
    await page
      .getByLabel('Opérateur réel', { exact: true })
      .scrollIntoViewIfNeeded()
    await page
      .getByRole('button', { name: 'Enregistrer l’étape', exact: true })
      .click()
    await expect(page.getByRole('alert')).toBeInViewport()
    await expect(number).toHaveAttribute('aria-invalid', 'true')
    await number.fill('42,375')
    // Escape must not silently discard a draft.
    page.once('dialog', async (confirmation) => {
      expect(confirmation.type()).toBe('confirm')
      await confirmation.dismiss()
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(number).toHaveValue('42,375')
    page.once('dialog', (confirmation) => confirmation.accept())
    await page.getByRole('button', { name: 'Annuler la saisie' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(open).toBeFocused()
    await page.goto('/samples/new')
    await page.getByLabel('Référence *').fill('K24-018')
    await page.getByLabel('Nom *').fill('Capteur PET')
    await page
      .getByLabel('Description (facultatif)')
      .fill('Formulaire simulé sans écriture en base.')
    const reference = (await page.locator('#reference').boundingBox())!
    const name = (await page.locator('#sample-name').boundingBox())!
    if (width > 640) expect(reference.y).toBeCloseTo(name.y, 0)
    else expect(name.y).toBeGreaterThan(reference.y)
    await page.screenshot({
      path: testInfo.outputPath(`sample-form-${width}.png`),
      fullPage: true,
    })
  })
}
