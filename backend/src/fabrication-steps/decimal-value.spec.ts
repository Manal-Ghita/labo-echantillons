import { BadRequestException } from '@nestjs/common';
import { decimalValue } from './decimal-value';

describe('Décimaux de fabrication', () => {
  it.each([
    '0',
    '-0',
    '+12.30',
    '-120.12345678901234567890123456789',
    '9'.repeat(35) + '.' + '9'.repeat(30),
    '000012.0000',
    '0.1' + '0'.repeat(40),
  ])('préserve exactement %s', (value) => {
    const parsed = decimalValue(value);
    expect(parsed.isFinite()).toBe(true);
    expect(parsed.eq(value)).toBe(true);
  });
  it.each([
    null,
    undefined,
    0,
    1.25,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    false,
    {},
    [],
    '',
    ' 1 ',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e2',
    '.5',
    '1.',
    '1,5',
    '9'.repeat(36),
    '0.' + '0'.repeat(30) + '1',
  ])('rejette une valeur non représentable sans perte (%#)', (value) => {
    expect(() => decimalValue(value)).toThrow(BadRequestException);
  });
});
