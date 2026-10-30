import { expect, test } from '@playwright/test'

test('connexion compacte, textes en haut et erreurs accessibles à toutes les tailles', async ({
  page,
}, testInfo) => {
  await page.route('http://localhost:3000/**', (route) =>
    route.fulfill(
      route.request().method() === 'OPTIONS'
        ? {
            status: 204,
            headers: {
              'access-control-allow-origin': 'http://localhost:5173',
              'access-control-allow-methods': 'GET,POST,OPTIONS',
              'access-control-allow-headers': 'content-type,authorization',
            },
          }
        : {
            status: 401,
            headers: { 'access-control-allow-origin': 'http://localhost:5173' },
            json: { message: 'Unauthorized', statusCode: 401 },
          },
    ),
  )
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    await page.goto('/login')
    await expect
      .poll(() =>
        page
          .locator('.login-logo')
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true)
    const shell = (await page.locator('.login-shell').boundingBox())!
    const card = (await page.locator('.login-card').boundingBox())!
    for (const selector of [
      '.login-logo',
      '.login-platform-name',
      '#login-title',
      '#email',
      '#password',
      '.login-card button[type="submit"]',
      '.access-help',
    ]) {
      expect((await page.locator(selector).boundingBox())!.x).toBeCloseTo(
        card.x,
        0,
      )
    }
    expect(card.width).toBeLessThanOrEqual(420)
    expect(shell.x).toBe(0)
    expect(shell.width).toBe(width)
    await expect(page.locator('.login-shell')).toHaveCSS('border-radius', '0px')
    if (width > 760) {
      await expect
        .poll(() =>
          page
            .locator('.login-photo')
            .evaluate(
              (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
            ),
        )
        .toBe(true)
      const photo = (await page.locator('.login-intro').boundingBox())!
      const text = (await page.locator('.intro-copy').boundingBox())!
      expect(photo.width / shell.width).toBeCloseTo(0.4, 2)
      expect((text.y - photo.y) / photo.height).toBeGreaterThanOrEqual(0.12)
      expect((text.y - photo.y) / photo.height).toBeLessThanOrEqual(0.15)
      expect(
        Math.abs(card.y + card.height / 2 - (shell.y + shell.height / 2)),
      ).toBeLessThan(2)
    } else await expect(page.locator('.login-intro')).toBeHidden()
    for (const field of [
      '#email',
      '#password',
      '.login-card button[type="submit"]',
    ]) {
      const bounds = (await page.locator(field).boundingBox())!
      expect(bounds.height).toBeGreaterThanOrEqual(46)
      expect(bounds.height).toBeLessThanOrEqual(50)
      await expect(page.locator(field)).toBeInViewport()
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(height)
    await page.screenshot({
      path: testInfo.outputPath(`login-${width}x${height}.png`),
      fullPage: true,
    })
    await page.getByLabel('Adresse e-mail').fill('layout@example.test')
    await page
      .getByLabel('Mot de passe', { exact: true })
      .fill('invalid-layout-password')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert')).toBeInViewport()
    await expect(
      page.getByRole('button', { name: 'Se connecter' }),
    ).toBeInViewport()
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(height)
    await page.screenshot({
      path: testInfo.outputPath(`login-error-${width}x${height}.png`),
      fullPage: true,
    })
  }
  // A narrow and short CSS viewport also exercises reflow under browser zoom.
  await page.setViewportSize({ width: 683, height: 384 })
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeGreaterThan(384)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    683,
  )
  await page.getByRole('alert').scrollIntoViewIfNeeded()
  await expect(page.getByRole('alert')).toBeInViewport()
  await page.locator('.access-help').scrollIntoViewIfNeeded()
  await expect(page.locator('.access-help')).toBeInViewport()
  // Even a short desktop keeps its whole form scrollable, without hidden overflow.
  await page.setViewportSize({ width: 1100, height: 360 })
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeGreaterThan(360)
  await page.getByLabel('Adresse e-mail').scrollIntoViewIfNeeded()
  await expect(page.getByLabel('Adresse e-mail')).toBeInViewport()
  await page.locator('.access-help').scrollIntoViewIfNeeded()
  await expect(page.locator('.access-help')).toBeInViewport()
})
