import { expect, test } from '@playwright/test'

const profile = {
  id: 'browser-test-user',
  name: 'Camille Test',
  email: 'camille@example.test',
  role: 'RESEARCHER', isActive: true,
  createdAt: '2026-10-29T08:00:00.000Z',
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
}

for (const role of ['RESEARCHER', 'ADMIN'] as const) {
  test(`connexion ${role}, navigation, rechargement et déconnexion sans débordement horizontal`, async ({
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
        await route.fulfill({ headers: cors, json: { ...profile, role } })
      } else if (path === '/samples' || path === '/step-types') {
        await route.fulfill({ headers: cors, json: [] })
      } else throw new Error('Appel métier inattendu pendant cette sous-phase.')
    })
    await page.goto('/step-types')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    const logo = page.locator('.login-logo')
    const photo = page.locator('.login-photo')
    await expect(logo).toHaveAttribute('src', '/images/logo-labo.png')
    await expect(photo).toHaveAttribute('src', '/images/wafer-login.png')
    await expect
      .poll(() =>
        logo.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true)
    if (testInfo.project.name === 'desktop') {
      await expect
        .poll(() =>
          photo.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true)
      await expect(photo).toHaveCSS('object-fit', 'cover')
      const left = await page.locator('.login-intro').boundingBox()
      const shell = await page.locator('.login-shell').boundingBox()
      expect(left!.width / shell!.width).toBeCloseTo(0.4, 2)
    } else {
      await expect(page.locator('.login-intro')).toBeHidden()
      await expect(
        page.getByRole('button', { name: 'Se connecter' }),
      ).toBeInViewport()
    }
    await expect(page.getByText('ISMIN 2026')).toHaveCount(0)
    await expect(
      page.locator('.brand-mark, .sample-lines, .login-footer'),
    ).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('login.png'),
      fullPage: true,
    })
    await expect(page.locator('html')).toHaveJSProperty(
      'scrollWidth',
      await page.evaluate(() => document.documentElement.clientWidth),
    )
    await page.getByLabel('Adresse e-mail').fill(profile.email)
    await page
      .getByLabel('Mot de passe', { exact: true })
      .fill('browser-test-password')
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
}

test('formulaire accessible sur petit écran et tablette, avec focus bleu', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  for (const width of [320, 820]) {
    await page.setViewportSize({ width, height: 900 })
    const email = page.getByLabel('Adresse e-mail')
    await email.focus()
    await expect(email).toHaveCSS('outline-color', 'rgb(43, 131, 165)')
    await expect(email).toBeInViewport()
    await expect(
      page.getByRole('button', { name: 'Se connecter' }),
    ).toBeInViewport()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    const logo = page.locator('.login-logo')
    await expect
      .poll(() =>
        logo.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true)
    expect(
      await logo.evaluate((img: HTMLImageElement) =>
        Math.abs(img.width / img.height - img.naturalWidth / img.naturalHeight),
      ),
    ).toBeLessThan(0.03)
    await page.screenshot({
      path: testInfo.outputPath(`login-${width}.png`),
      fullPage: true,
    })
  }
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
  await page.getByLabel('Adresse e-mail').fill(profile.email)
  await page
    .getByLabel('Mot de passe', { exact: true })
    .fill('incorrect-test-password')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Identifiants incorrects. Vérifiez votre adresse e-mail et votre mot de passe.',
  )
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
})
