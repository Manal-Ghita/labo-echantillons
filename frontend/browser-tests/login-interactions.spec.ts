import { expect, test } from '@playwright/test'

test('oeil, aide, focus et chargement accessibles sans double soumission', async ({
  page,
}) => {
  let requests = 0
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('http://localhost:3000/**', async (route) => {
    const headers = {
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    }
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers })
    requests++
    expect(route.request().postDataJSON()).toEqual({
      email: 'interaction@example.test',
      password: 'temporary-test-password',
    })
    await pending
    return route.fulfill({
      status: 401,
      headers,
      json: { message: 'Unauthorized' },
    })
  })
  await page.goto('/login')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Adresse e-mail')).toBeFocused()
  await expect(page.getByLabel('Adresse e-mail')).toHaveCSS(
    'outline-color',
    'rgb(43, 131, 165)',
  )
  await page.keyboard.type('interaction@example.test')
  await page.keyboard.press('Tab')
  await page.keyboard.type('temporary-test-password')
  await page.keyboard.press('Tab')
  const eye = page.getByRole('button', { name: 'Afficher le mot de passe' })
  await expect(eye).toBeFocused()
  await expect(eye).toHaveCSS('outline-color', 'rgb(43, 131, 165)')
  await page.keyboard.press('Enter')
  await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  await expect(page.locator('#password')).toHaveValue('temporary-test-password')
  await page.keyboard.press('Space')
  await expect(page.locator('#password')).toHaveAttribute('type', 'password')
  await expect(page.locator('#password')).toHaveValue('temporary-test-password')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Mot de passe oublié ?' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#password-help')).toHaveText(
    'Pour réinitialiser votre mot de passe, contactez la responsable du laboratoire.',
  )
  expect(requests).toBe(0)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeFocused()
  await page.keyboard.press('Enter')
  const loading = page.getByRole('button', { name: 'Connexion en cours…' })
  await expect(loading).toBeDisabled()
  await expect(page.locator('#password')).toBeDisabled()
  await expect.poll(() => requests).toBe(1)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.login-spinner')).toHaveCSS(
    'animation-name',
    'none',
  )
  expect(requests).toBe(1)
  release()
  await expect(page.getByRole('alert')).toHaveText(
    'Identifiants incorrects. Vérifiez votre adresse e-mail et votre mot de passe.',
  )
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
  await expect(page.locator('#password')).toHaveValue('')
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
})

test('une panne réseau reste distincte des identifiants incorrects', async ({
  page,
}) => {
  await page.route('http://localhost:3000/**', (route) => route.abort('failed'))
  await page.goto('/login')
  await page.getByLabel('Adresse e-mail').fill('network@example.test')
  await page
    .getByLabel('Mot de passe', { exact: true })
    .fill('temporary-test-password')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
  )
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
})
