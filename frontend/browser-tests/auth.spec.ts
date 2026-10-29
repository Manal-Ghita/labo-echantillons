import { expect, test } from '@playwright/test'

const profile = {
  id: 'browser-test-user',
  name: 'Camille Test',
  email: 'camille@example.test',
  role: 'RESEARCHER',
  createdAt: '2026-10-29T08:00:00.000Z',
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
}

test('connexion, navigation, rechargement et déconnexion sans débordement horizontal', async ({
  page,
}, testInfo) => {
  await page.route('http://localhost:3000/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/login') {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({
        email: profile.email,
        password: 'browser-test-password',
      })
      await route.fulfill({
        headers: cors,
        json: {
          access_token: 'browser-test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
      })
    } else if (path === '/auth/me') {
      expect(route.request().headers().authorization).toBe(
        'Bearer browser-test-token',
      )
      await route.fulfill({ headers: cors, json: profile })
    } else if (path === '/samples') {
      await route.fulfill({ headers: cors, json: [] })
    } else throw new Error('Appel métier inattendu pendant cette sous-phase.')
  })
  await page.goto('/step-types')
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('login.png'),
    fullPage: true,
  })
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => document.documentElement.clientWidth),
  )
  await page.getByLabel('Email').fill(profile.email)
  await page.getByLabel('Mot de passe').fill('browser-test-password')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(
    page.getByRole('heading', { name: 'Catalogue des opérations' }),
  ).toBeVisible()
  await expect(page.getByText(profile.name)).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Catalogue des opérations' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Échantillons', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Échantillons', exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('workspace.png'),
    fullPage: true,
  })
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => document.documentElement.clientWidth),
  )
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  expect(
    await page.evaluate(() => sessionStorage.getItem('labo.session')),
  ).toBeNull()
  expect(page.url()).not.toContain('password')
})

test('affiche une erreur de connexion lisible', async ({ page }) => {
  await page.route('http://localhost:3000/**', (route) =>
    route.fulfill(
      route.request().method() === 'OPTIONS'
        ? { status: 204, headers: cors }
        : {
            status: 401,
            headers: cors,
            json: { message: 'Unauthorized', statusCode: 401 },
          },
    ),
  )
  await page.goto('/login')
  await page.getByLabel('Email').fill(profile.email)
  await page.getByLabel('Mot de passe').fill('incorrect-test-password')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Email ou mot de passe incorrect.',
  )
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
})
