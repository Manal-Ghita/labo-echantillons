import { describe, expect, it } from 'vitest'
import { numericDisplay } from './display'

describe('Affichage numérique français sans arrondi', () => {
  it.each([
    ['37.5', 'nm', '37,5\u00a0nm'],
    ['42.375', 'nm', '42,375\u00a0nm'],
    [
      '-0.000000000000000000000000000001',
      null,
      '-0,000000000000000000000000000001',
    ],
    [
      '12345678901234567890123456789012345.123456789012345678901234567891',
      'nm',
      '12345678901234567890123456789012345,123456789012345678901234567891\u00a0nm',
    ],
    ['0', null, '0'],
    [null, 'nm', 'Non renseigné'],
  ])('conserve tous les chiffres de %s', (value, unit, expected) => {
    expect(numericDisplay(value, unit)).toBe(expected)
  })
})
