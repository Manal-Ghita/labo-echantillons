import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createStepInput,
  exactDecimal,
  fabricationMock,
  stepIds,
} from '../../test/support/fabrication-steps.fixture';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FabricationStepsService } from './fabrication-steps.service';

describe('FabricationStepsService (Prisma simulé)', () => {
  let service: FabricationStepsService;
  let mocks: ReturnType<typeof fabricationMock>;
  const owner = { id: stepIds.owner, role: 'RESEARCHER' as const };
  beforeEach(async () => {
    mocks = fabricationMock();
    const module = await Test.createTestingModule({
      providers: [
        FabricationStepsService,
        { provide: PrismaService, useValue: mocks.prisma },
      ],
    }).compile();
    service = module.get(FabricationStepsService);
  });
  it('enregistre pour le propriétaire dans une transaction sérialisable avec toutes les valeurs imbriquées', async () => {
    const result = await service.create(
      stepIds.sample,
      createStepInput(),
      owner,
    );
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(mocks.tx.fabricationStep.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.fabricationStep.create).not.toHaveBeenCalled();
    expect(result.recordedById).toBe(owner.id);
    expect(result.operationName).toBe('Dépôt');
    expect(result.performedAt.toISOString()).toBe('2026-10-29T09:30:00.000Z');
    expect(
      result.parameterValues.find(
        (value) => value.definitionId === stepIds.number,
      )?.numericValue,
    ).toBe(exactDecimal);
    expect(
      result.parameterValues.find(
        (value) => value.definitionId === stepIds.boolean,
      )?.booleanValue,
    ).toBe(false);
    const data = mocks.tx.fabricationStep.create.mock.calls[0][0].data;
    expect(data.parameterValues.create).toHaveLength(3);
    expect(data.parameterValues.create[0].numericValue).toBeInstanceOf(
      Prisma.Decimal,
    );
    expect(data).not.toHaveProperty('parameters');
    expect(data).not.toHaveProperty('recordedAt');
  });
  it('autorise ADMIN et trace son identité sans changer le propriétaire', async () => {
    const result = await service.create(stepIds.sample, createStepInput(), {
      id: stepIds.admin,
      role: 'ADMIN',
    });
    expect(result.recordedById).toBe(stepIds.admin);
  });
  it('interdit un autre chercheur', async () => {
    await expect(
      service.create(stepIds.sample, createStepInput(), {
        id: stepIds.other,
        role: 'RESEARCHER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
  });
  it.each(['RESEARCHER', 'ADMIN'] as const)(
    'interdit les nouvelles étapes sur un échantillon abandonné pour %s',
    async (role) => {
      mocks.tx.sample.findUnique.mockResolvedValue({
        id: stepIds.sample,
        creatorId: stepIds.owner,
        status: 'ABANDONED',
      });
      await expect(
        service.create(stepIds.sample, createStepInput(), {
          id: role === 'ADMIN' ? stepIds.admin : stepIds.owner,
          role,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
    },
  );
  it('accepte un ancien échantillon sans statut sans modifier ce statut', async () => {
    mocks.tx.sample.findUnique.mockResolvedValue({
      id: stepIds.sample,
      creatorId: stepIds.owner,
      status: null,
    });
    await expect(
      service.create(stepIds.sample, createStepInput(), owner),
    ).resolves.toBeDefined();
  });
  it('retourne 404 pour un échantillon absent', async () => {
    mocks.tx.sample.findUnique.mockResolvedValue(null);
    await expect(
      service.create(stepIds.sample, createStepInput(), owner),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('retourne 404 pour un type absent', async () => {
    mocks.tx.stepType.findUnique.mockResolvedValue(null);
    await expect(
      service.create(stepIds.sample, createStepInput(), owner),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('refuse un type désactivé', async () => {
    mocks.tx.stepType.findUnique.mockResolvedValue({
      id: stepIds.type,
      isActive: false,
      parameters: mocks.definitions,
    });
    await expect(
      service.create(stepIds.sample, createStepInput(), owner),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('valide et conserve un opérateur distinct', async () => {
    const result = await service.create(
      stepIds.sample,
      { ...createStepInput(), operatorId: stepIds.operator },
      owner,
    );
    expect(result.operatorId).toBe(stepIds.operator);
    expect(result.recordedById).toBe(owner.id);
    expect(mocks.tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: stepIds.operator },
      select: { id: true },
    });
  });
  it('refuse un opérateur inconnu', async () => {
    mocks.tx.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        stepIds.sample,
        { ...createStepInput(), operatorId: stepIds.operator },
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [{ definitionId: stepIds.other, value: '1' }],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.number, value: '2' },
      ],
      [
        { definitionId: stepIds.number, value: 1 },
        { definitionId: stepIds.boolean, value: true },
      ],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.boolean, value: 'false' },
      ],
      [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.boolean, value: false },
        { definitionId: stepIds.text, value: 42 },
      ],
    ].map((parameterValues) => ({ parameterValues })),
  )(
    'refuse des paramètres invalides avant toute écriture (%#)',
    async ({ parameterValues }) => {
      await expect(
        service.create(
          stepIds.sample,
          { ...createStepInput(), parameterValues },
          owner,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.tx.fabricationStep.create).not.toHaveBeenCalled();
    },
  );
  it('accepte l’omission du texte facultatif et les valeurs zéro et false', async () => {
    const result = await service.create(
      stepIds.sample,
      {
        ...createStepInput(),
        parameterValues: [
          { definitionId: stepIds.number, value: '0' },
          { definitionId: stepIds.boolean, value: false },
        ],
      },
      owner,
    );
    expect(result.parameterValues).toHaveLength(2);
  });
  it('accepte une opération sans aucune définition', async () => {
    mocks.tx.stepType.findUnique.mockResolvedValue({
      id: stepIds.type,
      name: 'Nettoyage',
      isActive: true,
      parameters: [],
    });
    await expect(
      service.create(
        stepIds.sample,
        { ...createStepInput(), parameterValues: [] },
        owner,
      ),
    ).resolves.toBeDefined();
  });
  it('conserve les répétitions et les résultats SUCCESS/FAILURE', async () => {
    const first = await service.create(
      stepIds.sample,
      createStepInput(),
      owner,
    );
    const second = await service.create(
      stepIds.sample,
      { ...createStepInput(), result: 'FAILURE' },
      owner,
    );
    expect(first.result).toBe('SUCCESS');
    expect(second.result).toBe('FAILURE');
    expect(first.id).not.toBe(second.id);
    expect(mocks.tx.fabricationStep.create).toHaveBeenCalledTimes(2);
  });
  it('laisse la transaction échouer si l’écriture imbriquée des paramètres échoue, sans écriture de secours', async () => {
    const error = new Error('Nested parameter write failed');
    mocks.tx.fabricationStep.create.mockRejectedValue(error);
    await expect(
      service.create(stepIds.sample, createStepInput(), owner),
    ).rejects.toBe(error);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.fabricationStep.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.fabricationStep.create).not.toHaveBeenCalled();
  });
  it.each(['P2034', 'P2003', 'P2025'])(
    'traduit le conflit transactionnel %s en 409 sans réessayer automatiquement',
    async (code) => {
      mocks.prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Concurrent change', {
          code,
          clientVersion: '7.10.1',
        }),
      );
      await expect(
        service.create(stepIds.sample, createStepInput(), owner),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );
  it('refuse une date invalide', async () => {
    await expect(
      service.create(
        stepIds.sample,
        { ...createStepInput(), performedAt: 'bad-date' },
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('demande un historique chronologique stable et conserve le texte historique', async () => {
    mocks.prisma.fabricationStep.findMany.mockResolvedValue([mocks.legacy]);
    const history = await service.findAll(stepIds.sample);
    expect(history[0]).toMatchObject({
      parameters: 'temperature=120 C',
      stepTypeId: null,
      result: null,
      parameterValues: [],
    });
    expect(mocks.prisma.fabricationStep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sampleId: stepIds.sample },
        orderBy: [{ performedAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    const include =
      mocks.prisma.fabricationStep.findMany.mock.calls[0][0].include;
    expect(include.recordedBy.select).toEqual({ id: true, name: true });
    expect(include.operator.select).toEqual({ id: true, name: true });
  });
  it('retourne une liste vide pour un échantillon sans étapes', async () => {
    await expect(service.findAll(stepIds.sample)).resolves.toEqual([]);
  });
  it('retourne 404 si l’échantillon consulté est absent', async () => {
    mocks.prisma.sample.findUnique.mockResolvedValue(null);
    await expect(service.findAll(stepIds.sample)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
