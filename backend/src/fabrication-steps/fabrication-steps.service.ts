import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Prisma } from '../generated/prisma/client';
import type { ParameterDefinition } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decimalValue } from './decimal-value';
import { CreateFabricationStepDto } from './dto/create-fabrication-step.dto';
import { CorrectFabricationStepDto } from './dto/correct-fabrication-step.dto';

const historyInclude = {
  parameterValues: {
    include: { definition: true },
    orderBy: { definition: { key: 'asc' } },
  },
  recordedBy: { select: { id: true, name: true } },
  operator: { select: { id: true, name: true } },
  stepType: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      parameters: true,
    },
  },
} satisfies Prisma.FabricationStepInclude;
type StepWithDetails = Prisma.FabricationStepGetPayload<{
  include: typeof historyInclude;
}>;

function serializeStep(step: StepWithDetails) {
  return {
    ...step,
    parameterValues: step.parameterValues.map((value) => ({
      ...value,
      numericValue: value.numericValue?.toFixed() ?? null,
    })),
  };
}

function parameterData(definition: ParameterDefinition, value: unknown) {
  switch (definition.dataType) {
    case 'NUMBER':
      return { definitionId: definition.id, numericValue: decimalValue(value) };
    case 'TEXT':
      if (typeof value !== 'string')
        throw new BadRequestException(
          `Le paramètre ${definition.key} attend un texte.`,
        );
      return { definitionId: definition.id, textValue: value };
    case 'BOOLEAN':
      if (typeof value !== 'boolean')
        throw new BadRequestException(
          `Le paramètre ${definition.key} attend un booléen.`,
        );
      return { definitionId: definition.id, booleanValue: value };
  }
}

@Injectable()
export class FabricationStepsService {
  constructor(private readonly prisma: PrismaService) {}

  async correct(
    sampleId: string,
    stepId: string,
    dto: CorrectFabricationStepDto,
    actor: Pick<AuthenticatedUser, 'id' | 'role'>,
  ) {
    if (
      ![
        'performedAt',
        'result',
        'operatorId',
        'observations',
        'parameters',
        'parameterValues',
      ].some((key) => dto[key as keyof CorrectFabricationStepDto] !== undefined)
    )
      throw new BadRequestException('Au moins un champ à corriger est requis.');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const previous = await tx.fabricationStep.findUnique({
            where: { id: stepId },
            include: {
              ...historyInclude,
              sample: { select: { creatorId: true } },
            },
          });
          if (!previous || previous.sampleId !== sampleId)
            throw new NotFoundException(
              'Étape introuvable pour cet échantillon.',
            );
          if (actor.role !== 'ADMIN' && previous.sample.creatorId !== actor.id)
            throw new ForbiddenException(
              'Correction réservée au propriétaire ou à ADMIN.',
            );
          if (previous.revision !== dto.expectedRevision)
            throw new ConflictException(
              'Cette étape a déjà été corrigée ; rechargez son historique.',
            );
          if (dto.operatorId) {
            if (
              !(await tx.user.findUnique({
                where: { id: dto.operatorId },
                select: { id: true },
              }))
            )
              throw new BadRequestException('Opérateur inconnu.');
          }
          let values: ReturnType<typeof parameterData>[] | undefined;
          if (dto.parameterValues !== undefined) {
            const definitions = new Map(
              previous.stepType?.parameters.map((definition) => [
                definition.id,
                definition,
              ]) ?? [],
            );
            const seen = new Set<string>();
            values = dto.parameterValues.map((parameter) => {
              const id = parameter.definitionId.toLowerCase();
              if (seen.has(id))
                throw new BadRequestException(
                  'Un paramètre ne peut être fourni qu’une fois.',
                );
              seen.add(id);
              const definition = definitions.get(id);
              if (!definition)
                throw new BadRequestException(
                  'Paramètre inconnu pour cette opération.',
                );
              return parameterData(definition, parameter.value);
            });
            if (
              [...definitions.values()].some(
                (definition) =>
                  definition.isRequired && !seen.has(definition.id),
              )
            )
              throw new BadRequestException(
                'Un paramètre obligatoire est absent.',
              );
          }
          const beforeSnapshot = JSON.parse(
            JSON.stringify(serializeStep(previous)),
          ) as Prisma.InputJsonValue;
          const updated = await tx.fabricationStep.update({
            where: { id: stepId },
            data: {
              ...(dto.performedAt !== undefined
                ? { performedAt: new Date(dto.performedAt) }
                : {}),
              ...(dto.result !== undefined ? { result: dto.result } : {}),
              ...(dto.operatorId !== undefined
                ? { operatorId: dto.operatorId }
                : {}),
              ...(dto.observations !== undefined
                ? { observations: dto.observations }
                : {}),
              ...(dto.parameters !== undefined
                ? { parameters: dto.parameters }
                : {}),
              ...(values !== undefined
                ? { parameterValues: { deleteMany: {}, create: values } }
                : {}),
              revision: { increment: 1 },
            },
            include: historyInclude,
          });
          await tx.stepCorrection.create({
            data: {
              stepId,
              revision: updated.revision,
              correctedById: actor.id,
              reason: dto.reason,
              beforeSnapshot,
              afterSnapshot: JSON.parse(
                JSON.stringify(serializeStep(updated)),
              ) as Prisma.InputJsonValue,
            },
          });
          return serializeStep(updated);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034', 'P2025', 'P2003'].includes(error.code)
      )
        throw new ConflictException(
          'La correction est en conflit avec une autre modification.',
        );
      throw error;
    }
  }

  async findCorrections(sampleId: string, stepId: string) {
    const step = await this.prisma.fabricationStep.findFirst({
      where: { id: stepId, sampleId },
      select: { id: true },
    });
    if (!step)
      throw new NotFoundException('Étape introuvable pour cet échantillon.');
    return this.prisma.stepCorrection.findMany({
      where: { stepId },
      orderBy: { revision: 'asc' },
      include: { correctedBy: { select: { id: true, name: true } } },
    });
  }

  async create(
    sampleId: string,
    dto: CreateFabricationStepDto,
    actor: Pick<AuthenticatedUser, 'id' | 'role'>,
  ) {
    const performedAt = new Date(dto.performedAt);
    if (Number.isNaN(performedAt.getTime()))
      throw new BadRequestException('Date de réalisation invalide.');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const sample = await tx.sample.findUnique({
            where: { id: sampleId },
            select: { id: true, creatorId: true, status: true },
          });
          if (!sample) throw new NotFoundException('Échantillon introuvable.');
          if (actor.role !== 'ADMIN' && sample.creatorId !== actor.id)
            throw new ForbiddenException(
              'Seul le propriétaire ou ADMIN peut enregistrer une étape.',
            );
          if (sample.status === 'ABANDONED')
            throw new ConflictException(
              'Un échantillon abandonné doit être réactivé avant toute nouvelle étape.',
            );
          const type = await tx.stepType.findUnique({
            where: { id: dto.stepTypeId },
            include: { parameters: true },
          });
          if (!type) throw new NotFoundException('Type d’étape introuvable.');
          if (!type.isActive)
            throw new ConflictException('Ce type d’étape est désactivé.');
          if (dto.operatorId !== undefined) {
            const operator = await tx.user.findUnique({
              where: { id: dto.operatorId },
              select: { id: true },
            });
            if (!operator) throw new BadRequestException('Opérateur inconnu.');
          }
          const definitions = new Map(
            type.parameters.map((definition) => [definition.id, definition]),
          );
          const seen = new Set<string>();
          const values = dto.parameterValues.map((parameter) => {
            const definitionId = parameter.definitionId.toLowerCase();
            if (seen.has(definitionId))
              throw new BadRequestException(
                'Un paramètre ne peut être fourni qu’une fois.',
              );
            seen.add(definitionId);
            const definition = definitions.get(definitionId);
            if (!definition)
              throw new BadRequestException(
                'Paramètre inconnu pour le type sélectionné.',
              );
            return parameterData(definition, parameter.value);
          });
          if (
            type.parameters.some(
              (definition) => definition.isRequired && !seen.has(definition.id),
            )
          ) {
            throw new BadRequestException(
              'Un paramètre obligatoire est absent.',
            );
          }
          const created = await tx.fabricationStep.create({
            data: {
              sampleId,
              stepTypeId: type.id,
              operationName: type.name,
              performedAt,
              result: dto.result,
              recordedById: actor.id,
              operatorId: dto.operatorId,
              observations: dto.observations,
              parameterValues: { create: values },
            },
            include: historyInclude,
          });
          return serializeStep(created);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2003', 'P2025'].includes(error.code)
      ) {
        throw new ConflictException(
          'Une donnée liée a changé pendant la saisie ; veuillez réessayer.',
        );
      }
      throw error;
    }
  }

  async findAll(sampleId: string) {
    const sample = await this.prisma.sample.findUnique({
      where: { id: sampleId },
      select: { id: true },
    });
    if (!sample) throw new NotFoundException('Échantillon introuvable.');
    const steps = await this.prisma.fabricationStep.findMany({
      where: { sampleId },
      include: historyInclude,
      orderBy: [{ performedAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
    });
    return steps.map(serializeStep);
  }
}
