import { expect, test } from '@playwright/test'
import type {
  FabricationStep,
  ParameterDefinition,
  StepType,
} from '../src/fabrication/api'

// Exercise a non-whole-hour offset, independent of the machine running tests.
test.use({ timezoneId: 'Asia/Kathmandu' })

const owner = '87da980d-d334-48ae-9a09-bdd68a1feaa8'
const sampleId = '5d8f6fc0-32d9-4828-acab-a0d18ba340ad'
const typeId = '06d1546b-65cf-4fe6-a35e-84164b90af14'
const definitionIds = [
  '01751530-a733-4e3f-a72c-a8c08785d95a',
  '8b717a1a-629e-4871-935b-7f4d60976772',
  '3e1bf8ea-13a3-4595-a8da-1607250cdcbd',
]
const precise =
  '12345678901234567890123456789012345.123456789012345678901234567891'
const definitions: ParameterDefinition[] = [
  {
    id: definitionIds[0],
    key: 'number',
    name: 'Température',
    dataType: 'NUMBER',
    unit: '°C',
    isRequired: true,
  },
  {
    id: definitionIds[1],
    key: 'text',
    name: 'Gaz',
    dataType: 'TEXT',
    unit: null,
    isRequired: false,
  },
  {
    id: definitionIds[2],
    key: 'bool',
    name: 'Sous vide',
    dataType: 'BOOLEAN',
    unit: null,
    isRequired: true,
  },
]
const type: StepType = {
  id: typeId,
  code: 'DEPOT',
  name: 'Dépôt',
  description: null,
  isActive: true,
  parameters: definitions,
}
const legacy: FabricationStep = {
  id: 'legacy',
  operationName: 'Ancien nettoyage',
  performedAt: '2026-10-27T08:00:00Z',
  recordedAt: '2026-10-27T09:00:00Z',
  parameters: 'Puissance = 120 W',
  observations: null,
  result: null,
  stepType: null,
  recordedBy: { id: owner, name: 'Camille' },
  operator: null,
  parameterValues: [],
}
const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
}

for (const result of ['SUCCESS', 'FAILURE'] as const) {
  test(`enregistre ${result} avec précision décimale et actualise l’historique`, async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-10-30T13:14:15Z'))
    let created: FabricationStep | null = null
    await page.route('http://localhost:3000/**', async (route) => {
      const request = route.request()
      if (request.method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: cors })
      expect(request.headers().authorization).toBe(
        'Bearer fabrication-browser-token',
      )
      const path = new URL(request.url()).pathname
      if (path === '/auth/me')
        return route.fulfill({
          headers: cors,
          json: {
            id: owner,
            name: 'Camille',
            role: 'RESEARCHER', isActive: true,
            email: 'camille@example.test',
            createdAt: legacy.recordedAt,
          },
        })
      if (path === `/samples/${sampleId}`)
        return route.fulfill({
          headers: cors,
          json: {
            id: sampleId,
            name: 'Silicium',
            reference: 'K24-017',
            description: null,
            creatorId: owner,
            status: 'ACTIVE',
            createdAt: legacy.recordedAt,
            updatedAt: legacy.recordedAt,
            batchId: null,
            parentId: null,
            originStepId: null,
          },
        })
      if (path === '/users/operators')
        return route.fulfill({
          headers: cors,
          json: [
            { id: owner, name: 'Camille' },
            { id: '8b717a1a-629e-4871-935b-7f4d60976772', name: 'Alex' },
          ],
        })
      if (path === '/step-types')
        return route.fulfill({ headers: cors, json: [type] })
      if (path === `/samples/${sampleId}/steps`) {
        if (request.method() === 'POST') {
          const body = request.postDataJSON()
          expect(body.result).toBe(result)
          expect(body.parameterValues).toEqual([
            { definitionId: definitionIds[0], value: precise },
            { definitionId: definitionIds[1], value: 'Argon' },
            { definitionId: definitionIds[2], value: false },
          ])
          expect(body).not.toHaveProperty('recordedById')
          expect(body.operatorId).toBe(
            result === 'SUCCESS'
              ? owner
              : '8b717a1a-629e-4871-935b-7f4d60976772',
          )
          expect(body.performedAt).toBe('2026-10-29T04:45:00.000Z')
          const response = {
            ...legacy,
            id: 'new-step',
            operationName: 'Dépôt',
            performedAt: body.performedAt,
            parameters: null,
            result,
            observations: body.observations,
            stepType: type,
            parameterValues: [
              {
                id: 'n',
                definition: definitions[0],
                numericValue: precise,
                textValue: null,
                booleanValue: null,
              },
              {
                id: 't',
                definition: definitions[1],
                numericValue: null,
                textValue: 'Argon',
                booleanValue: null,
              },
              {
                id: 'b',
                definition: definitions[2],
                numericValue: null,
                textValue: null,
                booleanValue: false,
              },
            ],
          }
          // Keep a serialized fixture without involving PostgreSQL.
          created = response
          return route.fulfill({ status: 201, headers: cors, json: response })
        }
        return route.fulfill({
          headers: cors,
          json: created ? [legacy, created] : [legacy],
        })
      }
      throw new Error('Unexpected API request')
    })
    await page.addInitScript(() =>
      sessionStorage.setItem(
        'labo.session',
        JSON.stringify({
          token: 'fabrication-browser-token',
          expiresAt: Date.now() + 3600000,
        }),
      ),
    )
    await page.goto(`/samples/${sampleId}`)
    await page.locator('.timeline-toggle').first().click()
    await expect(
      page.locator('.timeline-details').first().getByText('Puissance = 120 W'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Enregistrer une étape' }).click()
    await expect(page.locator('.step-entry-context')).toHaveText(
      'K24-017 · Silicium',
    )
    await expect(page.locator('#performed-at')).toHaveValue(
      '2026-10-30T18:59:15',
    )
    const save = page.getByRole('button', {
      name: 'Enregistrer l’étape',
      exact: true,
    })
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page.locator('#step-type')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(
      page.getByRole('group', { name: 'Résultat *' }),
    ).toHaveAttribute('aria-invalid', 'true')
    await page.getByLabel('Type d’opération *').selectOption(typeId)
    await page.getByLabel('Date de réalisation *').fill('2026-10-29T10:30')
    await page
      .getByRole('radio', {
        name: result === 'SUCCESS' ? 'Réussie' : 'Échouée',
      })
      .check()
    await page
      .getByLabel('Température (°C) *')
      .fill(result === 'SUCCESS' ? precise.replace('.', ',') : precise)
    await page.getByLabel('Gaz', { exact: true }).fill('Argon')
    await page.getByLabel('Sous vide *').selectOption('false')
    await expect(
      page.getByLabel('Opérateur réel', { exact: true }),
    ).toHaveValue(owner)
    if (result === 'FAILURE') {
      await page.getByLabel('Rechercher un opérateur par nom').fill('alex')
      await page
        .getByLabel('Opérateur réel', { exact: true })
        .selectOption('8b717a1a-629e-4871-935b-7f4d60976772')
    }
    const fields = [
      '#step-type',
      `#parameter-${definitionIds[0]}`,
      '.step-result-options',
      '#step-observations',
      '#performed-at',
      '#step-operator',
    ]
    const positions = await Promise.all(
      fields.map((selector) => page.locator(selector).boundingBox()),
    )
    for (let i = 1; i < positions.length; i++)
      expect(positions[i]!.y).toBeGreaterThan(positions[i - 1]!.y)
    const submitBox = (await save.boundingBox())!
    const cancelBox = (await page
      .getByRole('button', { name: 'Annuler la saisie' })
      .boundingBox())!
    expect(submitBox.y).toBeCloseTo(cancelBox.y, 0)
    expect(submitBox.width).toBeLessThan(
      (await page.locator('.step-entry form').boundingBox())!.width,
    )
    for (const selector of [
      '#step-type',
      `#parameter-${definitionIds[0]}`,
      '#performed-at',
      '#step-operator',
    ]) {
      const height = (await page.locator(selector).boundingBox())!.height
      expect(height).toBeGreaterThanOrEqual(44)
      expect(height).toBeLessThanOrEqual(48)
    }
    await page
      .getByLabel('Observations', { exact: true })
      .fill('Essai navigateur')
    await expect(page.locator('html')).toHaveJSProperty(
      'scrollWidth',
      await page.evaluate(() => document.documentElement.clientWidth),
    )
    await page.screenshot({
      path: testInfo.outputPath('step-form.png'),
      fullPage: true,
    })
    await page
      .getByRole('button', { name: 'Enregistrer l’étape', exact: true })
      .click()
    await expect(
      page.getByText('Étape enregistrée.', { exact: true }),
    ).toBeVisible()
    await page.locator('.timeline-toggle').last().click()
    await expect(
      page.getByText(precise.replace('.', ',') + ' °C', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Non', { exact: true })).toBeVisible()
    await expect(
      page.getByText(result === 'SUCCESS' ? 'Réussie' : 'Échouée', {
        exact: true,
      }),
    ).toBeVisible()
    const items = page.locator('.step-history > li')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText('Ancien nettoyage')
    await expect(items.last()).toContainText('Dépôt')
    await expect(page.locator('html')).toHaveJSProperty(
      'scrollWidth',
      await page.evaluate(() => document.documentElement.clientWidth),
    )
    await page.screenshot({
      path: testInfo.outputPath('step-history.png'),
      fullPage: true,
    })
  })
}
