import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  ListSamplesDto,
  NumericSearchFilterDto,
} from './dto/list-samples.dto';
import { decimalValue } from '../fabrication-steps/decimal-value';

export async function advancedSampleWhere(
  prisma: PrismaService,
  q: string | undefined,
  filter: ListSamplesDto,
): Promise<Prisma.SampleWhereInput | undefined> {
  const conditions: Prisma.SampleWhereInput[] = [];
  if (q)
    conditions.push({
      OR: [
        { reference: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ],
    });
  if (filter.status)
    conditions.push({
      status: filter.status === 'UNSPECIFIED' ? null : filter.status,
    });
  if (filter.batchId) conditions.push({ batchId: filter.batchId });
  const rows: { value: NumericSearchFilterDto; legacy: boolean }[] = (
    filter.numericFilters ?? []
  ).map((value) => ({ value, legacy: false }));
  if (
    !filter.parameterDefinitionId &&
    (filter.min !== undefined || filter.max !== undefined)
  )
    throw new BadRequestException(
      'Choisissez un paramètre numérique avant les bornes.',
    );
  if (filter.parameterDefinitionId)
    rows.unshift({
      legacy: true,
      value: {
        parameterDefinitionId: filter.parameterDefinitionId,
        min: filter.min,
        max: filter.max,
      },
    });
  if (rows.length > 10)
    throw new BadRequestException(
      'Au maximum 10 filtres numériques, paramètre simple inclus.',
    );
  const definitions = rows.length
    ? await prisma.parameterDefinition.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                rows.map((row) =>
                  row.value.parameterDefinitionId.toLowerCase(),
                ),
              ),
            ],
          },
        },
        select: { id: true, dataType: true },
      })
    : [];
  const known = new Map(definitions.map((d) => [d.id, d.dataType]));
  const steps: Prisma.FabricationStepWhereInput[] = [];
  if (filter.stepTypeId) steps.push({ stepTypeId: filter.stepTypeId });
  for (const { value, legacy } of rows) {
    const id = value.parameterDefinitionId.toLowerCase();
    if (known.get(id) !== 'NUMBER')
      throw new BadRequestException('Définition numérique inconnue.');
    if (
      value.eq !== undefined &&
      (value.min !== undefined || value.max !== undefined)
    )
      throw new BadRequestException(
        'Une valeur exacte ne peut pas être combinée à des bornes dans le même critère.',
      );
    if (
      !legacy &&
      value.eq === undefined &&
      value.min === undefined &&
      value.max === undefined
    )
      throw new BadRequestException(
        'Chaque critère numérique doit contenir une valeur exacte ou une borne.',
      );
    const eq = value.eq === undefined ? undefined : decimalValue(value.eq);
    const min = value.min === undefined ? undefined : decimalValue(value.min);
    const max = value.max === undefined ? undefined : decimalValue(value.max);
    if (min !== undefined && max !== undefined && min.gt(max))
      throw new BadRequestException(
        'La borne minimale dépasse la borne maximale.',
      );
    steps.push({
      parameterValues: {
        some: {
          definitionId: id,
          numericValue: {
            not: null,
            ...(eq !== undefined ? { equals: eq } : {}),
            ...(min !== undefined ? { gte: min } : {}),
            ...(max !== undefined ? { lte: max } : {}),
          },
        },
      },
    });
  }
  if (steps.length) {
    if (filter.matchMode === 'SAME_STEP')
      conditions.push({ steps: { some: { AND: steps } } });
    else conditions.push(...steps.map((step) => ({ steps: { some: step } })));
  }
  return conditions.length ? { AND: conditions } : undefined;
}
