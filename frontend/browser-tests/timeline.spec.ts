import { expect, test } from '@playwright/test'
import type { FabricationStep } from '../src/fabrication/api'

const sampleId = '5d8f6fc0-32d9-4828-acab-a0d18ba340ad'
const sample = {
  id: sampleId,
  reference: 'FRISE-001',
  name: 'Wafer silicium',
  description: 'Fabrication suivie sur dix étapes',
  creatorId: 'owner',
  status: 'ACTIVE',
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-29T08:00:00Z',
  batchId: null,
  parentId: null,
  originStepId: null,
}
const history: FabricationStep[] = Array.from({ length: 10 }, (_, i) => ({
  id: `step-${i}`,
  revision: i === 0 ? 1 : i === 1 ? 2 : 0,
  operationName: i < 2 ? 'Déposition PVD' : `Opération ${i + 1}`,
  performedAt: `2026-10-${20 + i}T08:00:00Z`,
  recordedAt: `2026-10-${20 + i}T09:00:00Z`,
  parameters: i === 0 ? 'Ancien réglage = 120 W' : null,
  observations: `Observation conservée ${i + 1}`,
  result: i === 0 ? 'FAILURE' : 'SUCCESS',
  recordedBy: { id: 'recorder', name: 'Auteur de saisie' },
  operator: i === 0 ? { id: 'operator', name: 'Opérateur identifié' } : null,
  stepType: {
    id: 'pvd',
    code: 'DEPOT_PVD',
    name: 'Déposition PVD',
    isActive: true,
  },
  parameterValues: [
    {
      id: `text-${i}`,
      definition: {
        id: 'material',
        key: 'material',
        name: 'Matériau',
        dataType: 'TEXT',
        unit: null,
        isRequired: true,
      },
      numericValue: null,
      textValue: 'Aluminium',
      booleanValue: null,
    },
    {
      id: `number-${i}`,
      definition: {
        id: 'thickness',
        key: 'thickness',
        name: 'Épaisseur',
        dataType: 'NUMBER',
        unit: 'nm',
        isRequired: true,
      },
      numericValue: i === 0 ? '37.5' : '42.375',
      textValue: null,
      booleanValue: null,
    },
  ],
}))
for (const [role, id, authorized] of [
  ['RESEARCHER', 'owner', true],
  ['RESEARCHER', 'viewer', false],
  ['ADMIN', 'admin', true],
] as const) {
  test(`frise dix étapes ${role}/${id}, détails clavier, audit et permissions`, async ({
    page,
  }, testInfo) => {
    const requests: string[] = []
    const cors = {
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
    }
    await page.route('http://localhost:3000/**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: cors })
      expect(route.request().method()).toBe('GET')
      const path = new URL(route.request().url()).pathname
      requests.push(path)
      if (path === '/auth/me')
        return route.fulfill({
          headers: cors,
          json: {
            id,
            role,
            isActive: true,
            name: 'Personne connectée',
            email: 'timeline@example.test',
            createdAt: sample.createdAt,
          },
        })
      if (path.endsWith('/steps'))
        return route.fulfill({ headers: cors, json: history })
      if (path.endsWith('/corrections'))
        return route.fulfill({
          headers: cors,
          json: [
            {
              id: 'correction',
              revision: 1,
              reason: 'Correction tracée',
              correctedAt: sample.updatedAt,
              correctedBy: history[0].recordedBy,
              beforeSnapshot: history[0],
              afterSnapshot: history[0],
            },
          ],
        })
      if (path === `/samples/${sampleId}`)
        return route.fulfill({ headers: cors, json: sample })
      throw new Error(`Unexpected HTTP path ${path}`)
    })
    await page.addInitScript(() =>
      sessionStorage.setItem(
        'labo.session',
        JSON.stringify({
          token: 'timeline-browser-token',
          expiresAt: Date.now() + 3600000,
        }),
      ),
    )
    await page.goto(`/samples/${sampleId}`)
    const items = page.locator('.step-history > li')
    await expect(items).toHaveCount(10)
    await expect(page.getByText(sample.reference, { exact: true })).toHaveCount(
      1,
    )
    await expect(page.getByText('Actif', { exact: true })).toHaveCount(1)
    await expect(
      page.getByText('Nom non disponible' + (id === 'owner' ? ' (vous)' : ''), {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.timeline-details:not([hidden])')).toHaveCount(0)
    await expect(
      items.first().getByText('Échouée', { exact: true }),
    ).toBeVisible()
    await expect(
      items.nth(1).getByText('Réussie', { exact: true }),
    ).toBeVisible()
    expect(
      await items
        .locator('.timeline-performed-at')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('datetime')),
        ),
    ).toEqual(history.map((step) => step.performedAt))
    // React StrictMode may mount effects twice in the development server.
    expect([...new Set(requests)].sort()).toEqual(
      ['/auth/me', `/samples/${sampleId}`, `/samples/${sampleId}/steps`].sort(),
    )
    expect(
      requests.filter((path) => path.endsWith('/corrections')),
    ).toHaveLength(0)
    expect((await items.first().boundingBox())!.height).toBeLessThan(
      testInfo.project.name === 'desktop' ? 150 : 230,
    )
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(page.viewportSize()!.width)
    await page.screenshot({
      path: testInfo.outputPath('timeline-compact.png'),
      fullPage: true,
    })
    const toggle = items.first().locator('.timeline-toggle')
    await expect(toggle).toHaveAccessibleName(
      'Afficher les détails de l’étape 1',
    )
    await toggle.focus()
    await expect(toggle).toHaveCSS('outline-color', 'rgb(43, 131, 165)')
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(
      items.first().getByText('37,5 nm', { exact: true }),
    ).toBeVisible()
    await expect(
      items.first().getByText('Observation conservée 1', { exact: true }),
    ).toBeVisible()
    await expect(
      items.first().getByText('Opérateur identifié', { exact: true }),
    ).toBeVisible()
    await expect(
      items
        .first()
        .getByRole('button', { name: 'Corriger l’étape', exact: true }),
    ).toHaveCount(authorized ? 1 : 0)
    await items
      .first()
      .getByRole('button', { name: 'Afficher les corrections (1 correction)' })
      .click()
    await expect(page.getByText('Motif : Correction tracée')).toBeVisible()
    const auditPaths = requests.filter((path) => path.endsWith('/corrections'))
    expect([...new Set(auditPaths)]).toEqual([
      `/samples/${sampleId}/steps/step-0/corrections`,
    ])
    expect(auditPaths.length).toBeLessThanOrEqual(2)
    await page.screenshot({
      path: testInfo.outputPath('timeline-audit.png'),
      fullPage: true,
    })
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(
      items.first().getByText('Observation conservée 1', { exact: true }),
    ).toBeHidden()
    await items
      .nth(1)
      .getByRole('button', { name: /Afficher les détails/ })
      .click()
    await expect(
      items.nth(1).getByRole('button', {
        name: 'Afficher les corrections (2 corrections)',
      }),
    ).toBeVisible()
    await expect(
      items.nth(1).getByText('Opérateur réel', { exact: true }),
    ).toHaveCount(0)
    await items
      .nth(2)
      .getByRole('button', { name: /Afficher les détails/ })
      .click()
    await expect(
      items.nth(2).getByRole('button', { name: /corrections/ }),
    ).toHaveCount(0)
    const abandon = page.getByRole('button', {
      name: 'Abandonner l’échantillon',
      exact: true,
    })
    await expect(abandon).toHaveCount(authorized ? 1 : 0)
    if (authorized) {
      await abandon.click()
      await expect(
        page.getByRole('button', { name: 'Confirmer l’abandon' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Annuler le changement' }).click()
    }
  })
}
