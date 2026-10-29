import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

// DECIMAL(65,30): reject values that PostgreSQL would round or overflow.
// JSON numbers are refused because parsing may already have lost precision.
export function decimalValue(value: unknown): Prisma.Decimal {
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
    throw new BadRequestException(
      'Une valeur NUMBER doit être une chaîne décimale finie, sans exposant.',
    );
  }
  const [integer, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  if (
    integer.replace(/^0+/, '').length > 35 ||
    fraction.replace(/0+$/, '').length > 30
  ) {
    throw new BadRequestException(
      'Valeur NUMBER hors capacité DECIMAL(65,30) ; aucun arrondi automatique.',
    );
  }
  return new Prisma.Decimal(value);
}
