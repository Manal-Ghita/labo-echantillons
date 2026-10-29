import { expect, test } from '@playwright/test'
import type { StepType } from '../src/fabrication/api'

const id = '06d1546b-65cf-4fe6-a35e-84164b90af14'
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
}
const profile = {
  id: 'catalogue-browser-user',
  name: 'Camille Test',
  email: 'camille@example.test',
  role: 'ADMIN',
  createdAt: '2026-10-29T08:00:00Z',
}
const seed: StepType = {
  id,
  code: 'DEPOT',
  name: 'Dépôt',
  description: null,
  isActive: true,
  parameters: [
    {
      id: 'definition',
      key: 'temperature',
      name: 'Température',
      dataType: 'NUMBER',
      unit: '°C',
      isRequired: true,
    },
  ],
}

test('ADMIN crée les définitions, désactive et réactive sans perdre les paramètres', async ({
  page,
}, testInfo) => {
  let current: StepType | undefined
  await page.route('http://localhost:3000/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    expect(request.headers().authorization).toBe(
      'Bearer catalogue-browser-token',
    )
    const url = new URL(request.url())
    if (url.pathname === '/auth/me')
      return route.fulfill({ headers: cors, json: profile })
    if (url.pathname === '/step-types' && request.method() === 'POST') {
      const body = request.postDataJSON()
      expect(body).toEqual({
        code: 'DEPOT',
        name: 'Dépôt',
        parameters: [
          {
            key: 'temperature',
            name: 'Température',
            dataType: 'NUMBER',
            unit: '°C',
            isRequired: true,
          },
          { key: 'gaz', name: 'Gaz', dataType: 'TEXT', isRequired: false },
          {
            key: 'vide',
            name: 'Sous vide',
            dataType: 'BOOLEAN',
            isRequired: false,
          },
        ],
      })
      current = {
        ...body,
        id,
        description: null,
        isActive: true,
        parameters: body.parameters.map((p: object, index: number) => ({
          ...p,
          id: String(index),
        })),
      }
      return route.fulfill({ status: 201, headers: cors, json: current })
    }
    if (url.pathname === `/step-types/${id}` && request.method() === 'PATCH') {
      const body = request.postDataJSON()
      expect(Object.keys(body).sort()).toEqual([
        'description',
        'isActive',
        'name',
      ])
      current = { ...current!, ...body }
      return route.fulfill({ headers: cors, json: current })
    }
    if (url.pathname === `/step-types/${id}`)
      return route.fulfill({ headers: cors, json: current })
    if (url.pathname === '/step-types')
      return route.fulfill({
        headers: cors,
        json:
          current &&
          (current.isActive ||
            url.searchParams.get('includeInactive') === 'true')
            ? [current]
            : [],
      })
    throw new Error('Unexpected API request')
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'catalogue-browser-token',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/step-types')
  await page.getByRole('link', { name: 'Créer un type d’opération' }).click()
  await page.getByLabel('Code *').fill('DEPOT')
  await page.getByLabel('Nom *', { exact: true }).fill('Dépôt')
  for (const parameter of [
    { key: 'temperature', name: 'Température', dataType: 'NUMBER' },
    { key: 'gaz', name: 'Gaz', dataType: 'TEXT' },
    { key: 'vide', name: 'Sous vide', dataType: 'BOOLEAN' },
  ]) {
    await page.getByRole('button', { name: 'Ajouter un paramètre' }).click()
    const fieldset = page.getByRole('group').last()
    await fieldset.getByLabel('Clé *').fill(parameter.key)
    await fieldset.getByLabel('Nom du paramètre *').fill(parameter.name)
    await fieldset
      .getByLabel('Type de valeur *')
      .selectOption(parameter.dataType)
    if (parameter.dataType === 'NUMBER') {
      await fieldset.getByLabel('Unité', { exact: true }).fill('°C')
      await fieldset.getByLabel('Paramètre obligatoire').check()
    }
  }
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => document.documentElement.clientWidth),
  )
  await page.screenshot({
    path: testInfo.outputPath('catalogue-form.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Créer le type', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Dépôt', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('BOOLEAN', { exact: true })).toBeVisible()
  await page
    .getByRole('button', { name: 'Modifier le type', exact: true })
    .click()
  await expect(page.getByLabel('Code *')).toBeDisabled()
  await page.getByLabel('Type actif').uncheck()
  await page
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click()
  await expect(page.getByText('Inactif', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '← Retour au catalogue' }).click()
  await expect(
    page.getByRole('heading', { name: 'Aucun type d’opération actif' }),
  ).toBeVisible()
  await page.getByLabel('Inclure les types inactifs').check()
  await page.getByRole('link', { name: 'Dépôt', exact: true }).click()
  await page
    .getByRole('button', { name: 'Modifier le type', exact: true })
    .click()
  await page.getByLabel('Type actif').check()
  await page
    .getByRole('button', { name: 'Enregistrer les modifications' })
    .click()
  await expect(page.getByText('Actif', { exact: true })).toBeVisible()
  await expect(page.getByText('°C', { exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => document.documentElement.clientWidth),
  )
  await page.screenshot({
    path: testInfo.outputPath('catalogue-detail.png'),
    fullPage: true,
  })
})

test('RESEARCHER consulte les paramètres mais ne peut pas créer', async ({
  page,
}) => {
  await page.route('http://localhost:3000/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: cors })
    const path = new URL(route.request().url()).pathname
    if (path === '/auth/me')
      return route.fulfill({
        headers: cors,
        json: { ...profile, role: 'RESEARCHER' },
      })
    expect(route.request().method()).toBe('GET')
    return route.fulfill({
      headers: cors,
      json: path === '/step-types' ? [seed] : seed,
    })
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'labo.session',
      JSON.stringify({
        token: 'catalogue-browser-token',
        expiresAt: Date.now() + 3600000,
      }),
    ),
  )
  await page.goto('/step-types')
  await expect(
    page.getByRole('link', { name: 'Créer un type d’opération' }),
  ).toHaveCount(0)
  await page.getByRole('link', { name: 'Dépôt', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Température', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Modifier le type', exact: true }),
  ).toHaveCount(0)
  await page.goto('/step-types/new')
  await expect(
    page.getByRole('heading', { name: 'Accès non autorisé' }),
  ).toBeVisible()
})
