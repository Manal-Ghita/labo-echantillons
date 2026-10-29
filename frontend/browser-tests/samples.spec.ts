import { expect, test } from '@playwright/test'

const profile = {
  id: 'browser-owner',
  name: 'Camille Test',
  email: 'camille@example.test',
  role: 'RESEARCHER',
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
  await page.route('http://localhost:3000/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(request.headers().authorization).toBe('Bearer browser-sample-token')
    const url = new URL(request.url())
    if (url.pathname === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
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
      if (url.searchParams.has('q')) {
        expect(url.searchParams.get('q')).toBe('K24-017')
        searched = true
      }
      return route.fulfill({ headers: cors, json: [sample] })
    }
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
  await page.getByLabel('Référence ou nom').fill('K24-017')
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click()
  await expect(page).toHaveURL(/q=K24-017/)
  await expect.poll(() => searched).toBe(true)
  await page.getByRole('link', { name: 'Silicium', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Silicium', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('browser-owner (vous)', { exact: true }),
  ).toBeVisible()
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
  await page.getByLabel('Référence *').fill('K24-018')
  await page.getByLabel('Nom *').fill('Nouveau silicium')
  await page
    .getByLabel('Description', { exact: true })
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
