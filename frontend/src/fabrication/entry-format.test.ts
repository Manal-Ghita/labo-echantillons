import { describe, expect, it } from 'vitest'
import { entryLabel, normalizedEntryValues } from './entry-format'
import { parameterValues } from './api'
import type { StepType } from './api'

const type: StepType = {
  id: 'pvd',
  code: 'DEPOT_PVD',
  name: 'Déposition PVD',
  description: null,
  isActive: true,
  parameters: [
    {
      id: 'n',
      key: 'thickness',
      name: 'Épaisseur (nm) (nm)',
      unit: 'nm',
      dataType: 'NUMBER',
      isRequired: true,
    },
    {
      id: 't',
      key: 'material',
      name: 'Matériau',
      unit: null,
      dataType: 'TEXT',
      isRequired: false,
    },
  ],
}
describe('Adaptation des saisies sans changer les contrats API', () => {
  it('déduplique seulement le libellé visible, sans modifier la définition', () => {
    expect(entryLabel(type.parameters[0])).toBe('Épaisseur (nm) *')
    expect(type.parameters[0].name).toBe('Épaisseur (nm) (nm)')
    expect(type.parameters[0].unit).toBe('nm')
  })
  it.each([',', '.'])(
    'préserve les 65 chiffres avec le séparateur %s',
    (separator) => {
      const digits = '12345678901234567890123456789012345'
      const fraction = '123456789012345678901234567891'
      const values = {
        n: `${digits}${separator}${fraction}`,
        t: 'Matériau, libre',
      }
      expect(
        parameterValues(type, normalizedEntryValues(type, values)),
      ).toEqual([
        { definitionId: 'n', value: `${digits}.${fraction}` },
        { definitionId: 't', value: 'Matériau, libre' },
      ])
      expect(values.n).toBe(`${digits}${separator}${fraction}`)
    },
  )
  it.each([
    '1,2,3',
    '1,2.3',
    '1e3',
    '1 000,5',
    '9'.repeat(36),
    '0,' + '1'.repeat(31),
  ])('refuse toujours %s', (n) => {
    expect(() =>
      parameterValues(type, normalizedEntryValues(type, { n })),
    ).toThrow()
  })
})
