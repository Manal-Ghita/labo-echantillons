import { expect, test } from '@playwright/test'

const profile = {
  id: 'browser-owner',
  name: 'Camille Test',
  email: 'camille@example.test',
  role: 'RESEARCHER', isActive: true,
  createdAt: '2026-10-29T08:00:00Z',
}
const sample = {
  id: '87da980d-d334-48ae-9a09-bdd68a1feaa8',
  reference: 'K24-017',
  name: 'Silicium',
  description: 'Un dépôt de référence\nDeuxième ligne',
  creatorId: profile.id,
  status: 'ACTIVE',
  createdAt: '2026-10-29T08:00:00Z',
  updatedAt: '2026-10-29T09:00:00Z',
  batchId: null,
  parentId: null,
  originStepId: null,
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
}

test('liste, recherche, création et détail accessibles sur desktop et mobile', async ({
  page,
}, testInfo) => {
  let created = false
  let searched = false
  let numericRequests = 0
  const numericDefinition = '11111111-1111-4111-8111-111111111111'
  await page.route('http://localhost:3000/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(request.headers().authorization).toBe('Bearer browser-sample-token')
    const url = new URL(request.url())
    if (url.pathname === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (url.pathname === '/samples/numeric-parameters')
      return route.fulfill({
        headers: cors,
        json: [
          {
            id: numericDefinition,
            key: 'thickness',
            name: 'Épaisseur',
            unit: 'nm',
            dataType: 'NUMBER',
            isRequired: true,
            stepType: {
              code: 'DEPOT_PVD',
              name: 'Déposition PVD',
              isActive: true,
            },
          },
        ],
      })
    if (url.pathname === '/samples' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({
        reference: 'K24-018',
        name: 'Nouveau silicium',
        description: 'Création depuis React',
      })
      created = true
      return route.fulfill({
        status: 201,
        headers: cors,
        json: { ...sample, reference: 'K24-018', name: 'Nouveau silicium' },
      })
    }
    if (url.pathname === '/samples') {
      if (url.searchParams.has('parameterDefinitionId')) {
        expect(url.searchParams.get('parameterDefinitionId')).toBe(
          numericDefinition,
        )
        expect(url.searchParams.get('min')).toBe('40.125')
        expect(url.searchParams.get('max')).toBe('45')
        numericRequests++
      }
      if (url.searchParams.has('q')) {
        expect(url.searchParams.get('q')).toBe('K24-017')
        searched = true
      }
      return route.fulfill({ headers: cors, json: [sample] })
    }
    if (url.pathname === `/samples/${sample.id}/steps`)
      return route.fulfill({ headers: cors, json: [] })
    if (url.pathname === `/samples/${sample.id}`)
      return route.fulfill({
        headers: cors,
        json: created
          ? { ...sample, reference: 'K24-018', name: 'Nouveau silicium' }
          : sample,
      })
    throw new Error('Unexpected API request')
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'browser-sample-token',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/samples')
  await expect(
    page.getByRole('link', { name: 'Silicium', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'LIMS Salle Blanche' }),
  ).toBeVisible()
  const logo = page.locator('.app-logo')
  await expect
    .poll(() =>
      logo.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true)
  await expect(page.getByText('Personnel de recherche')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toHaveCount(0)
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'K24-017' })).toBeVisible()
  await expect(page.getByText('1 échantillon', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Filtres', exact: true }),
  ).toBeVisible()
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => document.documentElement.clientWidth),
  )
  await page.screenshot({
    path: testInfo.outputPath('sample-table.png'),
    fullPage: true,
  })
  // The explicit details action stays available on narrow screens.
  await expect(
    page.getByRole('link', { name: 'Voir les détails de K24-017' }),
  ).toBeInViewport()
  const primary = page.getByRole('link', { name: 'Créer un échantillon' })
  await expect(primary).toHaveCSS('background-color', 'rgb(21, 87, 117)')
  await expect(primary).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(page.locator(':root')).toHaveCSS(
    'background-color',
    'rgb(244, 248, 251)',
  )
  await expect(page.locator('nav a[aria-current="page"]')).toHaveCSS(
    'color',
    'rgb(13, 53, 77)',
  )
  // Check the rendered palette, including text and keyboard focus contrast.
  const contrast = await page.evaluate(() => {
    const luminance = (color: string) => {
      const channels = color
        .match(/\d+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const s = value / 255
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const ratio = (a: string, b: string) => {
      const first = luminance(a),
        second = luminance(b)
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    }
    const button = getComputedStyle(document.querySelector('.button-primary')!)
    const root = getComputedStyle(document.documentElement)
    const muted = getComputedStyle(document.querySelector('.muted')!)
    const focus = root.getPropertyValue('--color-secondary').trim()
    const probe = document.createElement('span')
    probe.style.color = focus
    document.body.append(probe)
    const focusColor = getComputedStyle(probe).color
    probe.remove()
    return {
      button: ratio(button.color, button.backgroundColor),
      muted: ratio(muted.color, root.backgroundColor),
      focus: ratio(focusColor, root.backgroundColor),
    }
  })
  expect(contrast.button).toBeGreaterThanOrEqual(4.5)
  expect(contrast.muted).toBeGreaterThanOrEqual(4.5)
  expect(contrast.focus).toBeGreaterThanOrEqual(3)
  await page.getByLabel('Référence ou nom').fill('K24-017')
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect(page).toHaveURL(/q=K24-017/)
  await expect.poll(() => searched).toBe(true)
  await expect(page.locator('.samples-page > .eyebrow')).toHaveCSS(
    'text-transform',
    'uppercase',
  )
  await expect(page.getByRole('columnheader')).toHaveCount(4)
  await expect(page.locator('table caption')).toHaveCount(0)
  await page.getByRole('button', { name: 'Filtres', exact: true }).click()
  const filters = page.locator('#numeric-filters')
  await expect(filters).toBeVisible()
  const row = (await page.locator('.sample-search-row').boundingBox())!
  const panel = (await filters.boundingBox())!
  expect(panel.y).toBeGreaterThanOrEqual(row.y + row.height)
  expect(panel.width).toBeCloseTo(row.width, 0)
  const parameter = (await page.locator('#numeric-definition').boundingBox())!
  const min = (await page.locator('#numeric-min').boundingBox())!
  const max = (await page.locator('#numeric-max').boundingBox())!
  if (testInfo.project.name === 'desktop') {
    expect(min.y).toBeCloseTo(parameter.y, 0)
    expect(max.y).toBeCloseTo(parameter.y, 0)
  } else {
    expect(min.y).toBeGreaterThan(parameter.y)
    expect(max.y).toBeGreaterThan(min.y)
  }
  await expect(
    page.getByRole('option', { name: 'Choisir un paramètre' }),
  ).toHaveAttribute('value', '')
  await page
    .getByLabel('Paramètre', { exact: true })
    .selectOption(numericDefinition)
  await expect(page.locator('#numeric-min-unit')).toHaveText('nm')
  await expect(page.locator('#numeric-max-unit')).toHaveText('nm')
  await page.locator('#numeric-min').fill('40.125')
  await page.locator('#numeric-max').fill('45')
  await page.screenshot({
    path: testInfo.outputPath('filters.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Filtres', exact: true }).click()
  await expect(filters).toBeHidden()
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect.poll(() => numericRequests).toBe(1)
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect.poll(() => numericRequests).toBe(2)
  await page.getByRole('button', { name: 'Filtres', exact: true }).click()
  await expect(page.locator('#numeric-min')).toHaveValue('40.125')
  await page.getByRole('link', { name: 'Silicium', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Silicium', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Nom non disponible (vous)', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(sample.id, { exact: true })).toHaveCount(0)
  const abandon = page.getByRole('button', {
    name: 'Abandonner l’échantillon',
    exact: true,
  })
  await expect(abandon).toHaveCSS('color', 'rgb(159, 38, 55)')
  expect(
    await abandon.evaluate(
      (el) =>
        !!(
          document
            .querySelector('.fabrication-section')!
            .compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
    ),
  ).toBe(true)
  await abandon.click()
  await expect(
    page.getByRole('button', { name: 'Confirmer l’abandon' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Annuler le changement' }).click()
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => document.documentElement.clientWidth),
  )
  await page.screenshot({
    path: testInfo.outputPath('sample-detail.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: '← Tous les échantillons' }).click()
  await page.getByRole('link', { name: 'Créer un échantillon' }).click()
  await expect(page.getByPlaceholder('Ex. K24-017')).toBeVisible()
  await expect(
    page.getByPlaceholder('Ex. Capteur de pression · film PET'),
  ).toBeVisible()
  await expect(
    page.getByLabel('Description (facultatif)', { exact: true }),
  ).toHaveAttribute('rows', '3')
  await expect(
    page.getByLabel('Description (facultatif)', { exact: true }),
  ).toHaveCSS('resize', 'vertical')
  const formBox = (await page.locator('.compact-sample-form').boundingBox())!
  expect(formBox.width).toBeCloseTo(
    (await page.locator('main .page').boundingBox())!.width,
    0,
  )
  const refBox = (await page.locator('#reference').boundingBox())!
  const nameBox = (await page.locator('#sample-name').boundingBox())!
  if (page.viewportSize()!.width > 640) {
    expect(nameBox.y).toBeCloseTo(refBox.y, 0)
    expect(nameBox.x).toBeGreaterThan(refBox.x)
  } else expect(nameBox.y).toBeGreaterThan(refBox.y)
  for (const selector of ['#reference', '#sample-name']) {
    const height = (await page.locator(selector).boundingBox())!.height
    expect(height).toBeGreaterThanOrEqual(44)
    expect(height).toBeLessThanOrEqual(48)
  }
  await page.getByLabel('Référence *').fill('K24-018')
  await page.getByLabel('Nom *').fill('Nouveau silicium')
  await page
    .getByLabel('Description (facultatif)', { exact: true })
    .fill('Création depuis React')
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => document.documentElement.clientWidth),
  )
  await page.screenshot({
    path: testInfo.outputPath('sample-form.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Enregistrer l’échantillon' }).click()
  await expect(
    page.getByRole('heading', { name: 'Nouveau silicium', exact: true }),
  ).toBeVisible()
  expect(created).toBe(true)
})
