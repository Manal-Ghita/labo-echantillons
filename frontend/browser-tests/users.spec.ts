import { expect, test } from '@playwright/test'

const profile = {
  id: 'c154ee0f-8739-42cd-99bd-ce28e491ed90',
  name: 'Alex Responsable',
  email: 'alex@example.test',
  role: 'ADMIN',
  createdAt: '2026-10-29T08:00:00Z',
  isActive: true,
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
}
test('tableau 30 comptes et panneau accessibles, sans exposer les UUID', async ({
  page,
}, testInfo) => {
  let users = Array.from({ length: 30 }, (_, index) => ({
    ...profile,
    id: `${profile.id}-${index}`,
    name: `Membre ${String(index + 1).padStart(2, '0')}`,
    email: `membre${index + 1}@example.test`,
    role: index === 0 ? 'ADMIN' : 'RESEARCHER',
  }))
  let posts = 0
  await page.route('http://localhost:3000/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    const path = new URL(request.url()).pathname
    if (path === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (path === '/users') {
      if (request.method() === 'POST') {
        posts++
        const body = request.postDataJSON()
        expect(Object.keys(body).sort()).toEqual(['email', 'name', 'password'])
        expect(body.password).toBe('e'.repeat(72))
        const created = {
          ...profile,
          id: 'new-researcher',
          name: body.name,
          email: body.email,
          role: 'RESEARCHER',
          isActive: true,
        }
        users = [...users, created]
        return route.fulfill({ status: 201, headers: cors, json: created })
      }
      return route.fulfill({ headers: cors, json: users })
    }
    throw new Error(`Unexpected request ${path}`)
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'mock-users-browser-token',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/users')
  await expect(page.getByText('30 comptes', { exact: true })).toBeVisible()
  await expect(page.locator('.users-table caption')).toHaveCount(0)
  const search = page.getByPlaceholder('Rechercher par nom ou e-mail…')
  await search.fill('MEMBRE 01')
  await expect(page.getByRole('row')).toHaveCount(2)
  await expect(page.getByText('1 résultat sur 30 comptes')).toBeVisible()
  await search.fill('MÉMBRE2@EXAMPLE.TEST')
  await expect(page.getByRole('rowheader', { name: 'Membre 02' })).toBeVisible()
  await expect(page.getByText('1 résultat sur 30 comptes')).toBeVisible()
  await search.fill('aucun membre')
  await expect(
    page.getByText('Aucun compte ne correspond à votre recherche.'),
  ).toBeVisible()
  await expect(page.getByText('0 résultat sur 30 comptes')).toBeVisible()
  await search.fill('')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(31)
  await expect(page.getByRole('columnheader')).toHaveText([
    'Nom',
    'Email',
    'Rôle',
    'État',
    'Date de création',
    'Actions',
  ])
  await expect(page.locator('.users-table')).not.toContainText('RESEARCHER')
  await expect(page.locator('.users-table')).not.toContainText('ADMIN')
  await expect(page.locator('.users-page')).not.toContainText(profile.id)
  await expect(page.locator('.users-page form')).toHaveCount(0)
  const lastAction = page.getByRole('button', {
    name: 'Actions pour Membre 30',
    exact: true,
  })
  await lastAction.scrollIntoViewIfNeeded()
  await lastAction.click()
  const menu = page.getByRole('menu')
  await expect(page.getByRole('menuitem', { name: 'Désactiver' })).toBeFocused()
  expect(
    await menu.evaluate((element) => element.parentElement === document.body),
  ).toBe(true)
  const box = (await menu.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(8)
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width - 8)
  expect(box.y + box.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 8,
  )
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(lastAction).toBeFocused()
  await lastAction.press('Enter')
  await page.mouse.click(8, 8)
  await expect(menu).toHaveCount(0)
  const firstAction = page.getByRole('button', {
    name: 'Actions pour Membre 01',
    exact: true,
  })
  await firstAction.scrollIntoViewIfNeeded()
  await firstAction.focus()
  await page.keyboard.press('Space')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Actions pour Membre 02', exact: true }),
  ).toBeFocused()
  await page
    .getByRole('button', { name: 'Actions pour Membre 02', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Actions pour Membre 03', exact: true })
    .click()
  await expect(page.getByRole('menu')).toHaveCount(1)
  await expect(
    page.getByRole('menu', { name: 'Actions pour Membre 03' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
  const region = page.getByRole('region', { name: 'Membres du laboratoire' })
  if (testInfo.project.name === 'mobile')
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    )
  await page.screenshot({
    path: testInfo.outputPath('users-page.png'),
    fullPage: true,
  })
  const open = page.getByRole('button', {
    name: 'Ajouter un chercheur',
    exact: true,
  })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un chercheur' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveCount(1)
  await expect(page.getByPlaceholder('Ex. Karim Benali')).toBeVisible()
  await expect(page.getByPlaceholder('prenom.nom@labo.com')).toBeVisible()
  const close = page.getByRole('button', { name: 'Fermer le panneau' })
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(
    page.getByRole('button', { name: 'Annuler', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(open).toBeFocused()
  await open.click()
  await page.getByLabel('Nom complet *').fill('Charlie Recherche')
  await page.getByLabel('Adresse e-mail *').fill('charlie@example.test')
  const password = page.getByLabel('Mot de passe initial *')
  await password.fill('é'.repeat(37))
  await page
    .getByRole('button', { name: 'Créer le compte', exact: true })
    .click()
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toBeInViewport()
  await expect(page.locator('#researcher-password-error')).toHaveText(
    /72 octets UTF-8/,
  )
  expect(posts).toBe(0)
  await password.fill('e'.repeat(72))
  await page.getByRole('button', { name: 'Afficher le mot de passe' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('e'.repeat(72))
  await page.getByRole('button', { name: 'Masquer le mot de passe' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  page.once('dialog', (confirmation) => confirmation.dismiss())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(password).toHaveValue('e'.repeat(72))
  page.once('dialog', (confirmation) => confirmation.accept())
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await expect(open).toBeFocused()
  expect(posts).toBe(0)
  await open.click()
  await page.getByLabel('Nom complet *').fill('Charlie Recherche')
  await page.getByLabel('Adresse e-mail *').fill('charlie@example.test')
  await password.fill('e'.repeat(72))
  await expect(dialog.locator('form input')).toHaveCount(3)
  if (testInfo.project.name === 'mobile')
    expect((await dialog.boundingBox())!.width).toBe(page.viewportSize()!.width)
  else expect((await dialog.boundingBox())!.x).toBeGreaterThan(0)
  // Short viewport: only the form body scrolls; footer actions remain reachable.
  const original = page.viewportSize()!
  await page.setViewportSize({ width: original.width, height: 420 })
  await password.scrollIntoViewIfNeeded()
  await expect(
    page.getByRole('button', { name: 'Créer le compte', exact: true }),
  ).toBeInViewport()
  expect(
    await dialog
      .locator('.side-panel-body')
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true)
  await page.setViewportSize(original)
  await dialog.locator('.side-panel-body').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.screenshot({ path: testInfo.outputPath('users-panel.png') })
  await page
    .getByRole('button', { name: 'Créer le compte', exact: true })
    .click()
  await expect(page.getByText('Compte chercheur créé.')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('rowheader', { name: 'Charlie Recherche' }),
  ).toBeVisible()
  expect(posts).toBe(1)
  await expect(open).toBeFocused()
})

test('RESEARCHER ne peut pas consulter les comptes ni ouvrir leur création', async ({
  page,
}) => {
  await page.route('http://localhost:3000/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(new URL(route.request().url()).pathname).toBe('/auth/me')
    return route.fulfill({
      headers: cors,
      json: { ...profile, role: 'RESEARCHER' },
    })
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'mock-researcher-token',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/users')
  await expect(
    page.getByRole('heading', { name: 'Accès non autorisé' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Ajouter un chercheur' }),
  ).toHaveCount(0)
})

test('ADMIN désactive puis réactive un compte, avec confirmation et protection de son propre compte', async ({
  page,
}) => {
  const otherId = 'c154ee0f-8739-42cd-99bd-ce28e491ed91'
  let active = true,
    changes = 0
  const other = () => ({
    ...profile,
    id: otherId,
    name: 'Sam Recherche',
    email: 'sam@example.test',
    role: 'RESEARCHER',
    isActive: active,
  })
  await page.route('http://localhost:3000/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    if (path === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (path === '/users')
      return route.fulfill({ headers: cors, json: [profile, other()] })
    if (path === `/users/${otherId}/status`) {
      expect(req.method()).toBe('PATCH')
      const body = req.postDataJSON()
      expect(Object.keys(body)).toEqual(['isActive'])
      expect(typeof body.isActive).toBe('boolean')
      active = body.isActive
      changes++
      return route.fulfill({ headers: cors, json: other() })
    }
    throw new Error(`Unexpected request ${path}`)
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'mock-admin-status',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/users')
  const own = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: profile.name, exact: true }),
  })
  await expect(own.getByText('Compte actuel')).toBeVisible()
  await expect(own.getByRole('button')).toHaveCount(0)
  const row = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Sam Recherche', exact: true }),
  })
  const action = row.getByRole('button', { name: 'Actions pour Sam Recherche' })
  await action.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Désactiver' })).toBeFocused()
  page.once('dialog', (confirmation) => confirmation.dismiss())
  await page.getByRole('menuitem', { name: 'Désactiver' }).click()
  expect(changes).toBe(0)
  await expect(row.getByText('Actif', { exact: true })).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(action).toBeFocused()
  await action.click()
  page.once('dialog', (confirmation) => confirmation.accept())
  await page.getByRole('menuitem', { name: 'Désactiver' }).click()
  await expect(row.getByText('Désactivé', { exact: true })).toBeVisible()
  await expect(action).toBeFocused()
  await action.click()
  await page.getByRole('menuitem', { name: 'Réactiver' }).click()
  await expect(row.getByText('Actif', { exact: true })).toBeVisible()
  expect(changes).toBe(2)
  await expect(page.getByText('2 comptes', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  )
})
