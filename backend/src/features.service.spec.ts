import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';
import { PasswordService } from './auth/password.service';
import { UsersService } from './users/users.service';
import { SamplesService } from './samples/samples.service';
import { FabricationStepsService } from './fabrication-steps/fabrication-steps.service';
import {
  fabricationMock,
  stepIds,
} from '../test/support/fabrication-steps.fixture';

describe('Comptes RESEARCHER (Prisma simulé)', () => {
  const user = { create: jest.fn(), findMany: jest.fn() };
  const passwords = { hash: jest.fn().mockResolvedValue('hash-only') };
  const service = new UsersService(
    { user } as unknown as PrismaService,
    passwords as unknown as PasswordService,
  );
  it('sélectionne uniquement id et nom pour les opérateurs sans filtrer arbitrairement les rôles', async () => {
    user.findMany.mockResolvedValue([
      {
        id: 'researcher',
        name: 'Alex',
        email: 'hidden@example.test',
        role: 'RESEARCHER',
        passwordHash: 'hidden',
      },
      { id: 'admin', name: 'Sam', role: 'ADMIN' },
    ]);
    expect(await service.findOperators()).toEqual([
      { id: 'researcher', name: 'Alex' },
      { id: 'admin', name: 'Sam' },
    ]);
    expect(user.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    expect(user.create).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    user.create.mockReset();
    user.findMany.mockReset();
    passwords.hash.mockClear();
  });
  it('fixe le rôle, hache le mot de passe et sélectionne uniquement les champs publics', async () => {
    user.create.mockResolvedValue({ id: 'new', role: 'RESEARCHER' });
    await service.createResearcher({
      name: 'Camille',
      email: 'camille@example.test',
      password: 'test-password-only',
    });
    expect(passwords.hash).toHaveBeenCalledWith('test-password-only');
    expect(user.create).toHaveBeenCalledWith({
      data: {
        name: 'Camille',
        email: 'camille@example.test',
        passwordHash: 'hash-only',
        role: 'RESEARCHER',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        isActive: true,
      },
    });
  });
  it('refuse plus de 72 octets UTF-8 avant hachage', async () => {
    await expect(
      service.createResearcher({
        name: 'N',
        email: 'e@example.test',
        password: 'é'.repeat(40),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(user.create).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
  });
  it('traduit le conflit email sans remplacer de compte', async () => {
    user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    await expect(
      service.createResearcher({
        name: 'N',
        email: 'e@example.test',
        password: 'test-password-only',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('liste sans mot de passe ni empreinte', async () => {
    user.findMany.mockResolvedValue([]);
    await service.findAll();
    expect(user.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'passwordHash',
    );
  });
});

describe('Recherche numérique et statut (Prisma simulé)', () => {
  const sample = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const parameterDefinition = { findUnique: jest.fn(), findMany: jest.fn() };
  const tx = { sample };
  const prisma = {
    sample,
    parameterDefinition,
    $transaction: jest.fn((work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const service = new SamplesService(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.clearAllMocks();
    parameterDefinition.findUnique.mockResolvedValue({
      id: stepIds.number,
      dataType: 'NUMBER',
    });
    sample.findUnique.mockResolvedValue({
      id: stepIds.sample,
      creatorId: stepIds.owner,
    });
  });
  it('combine texte et bornes inclusives exactes sur la même valeur', async () => {
    await service.findAll('film', {
      parameterDefinitionId: stepIds.number,
      min: '0.123456789012345678901234567891',
      max: '0.123456789012345678901234567892',
    });
    const where = sample.findMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    const value = where.steps.some.parameterValues.some;
    expect(value.definitionId).toBe(stepIds.number);
    expect(value.numericValue.gte.toFixed()).toBe(
      '0.123456789012345678901234567891',
    );
    expect(value.numericValue.lte.toFixed()).toBe(
      '0.123456789012345678901234567892',
    );
    expect(where.steps.some).not.toHaveProperty('result');
  });
  it('propose les définitions actives ou déjà utilisées, y compris archivées', async () => {
    await service.numericParameters();
    expect(parameterDefinition.findMany.mock.calls[0][0].where).toEqual({
      dataType: 'NUMBER',
      OR: [{ stepType: { isActive: true } }, { values: { some: {} } }],
    });
  });
  it.each([
    { min: '1' },
    { max: '2' },
    { parameterDefinitionId: stepIds.number, min: '2', max: '1' },
    { parameterDefinitionId: stepIds.number, min: '1e3' },
  ])('rejette le filtre incohérent %j', async (filter) => {
    await expect(service.findAll(undefined, filter)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sample.findMany).not.toHaveBeenCalled();
  });
  it.each([null, { id: stepIds.text, dataType: 'TEXT' }])(
    'refuse une définition non numérique',
    async (definition) => {
      parameterDefinition.findUnique.mockResolvedValue(definition);
      await expect(
        service.findAll(undefined, {
          parameterDefinitionId: stepIds.text,
          min: '0',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it.each(['ACTIVE', 'ABANDONED'] as const)(
    'permet au propriétaire de choisir %s sans toucher aux étapes',
    async (status) => {
      await service.updateStatus(stepIds.sample, status, {
        id: stepIds.owner,
        role: 'RESEARCHER',
      });
      expect(sample.update).toHaveBeenCalledWith({
        where: { id: stepIds.sample },
        data: { status },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    },
  );
  it('permet ADMIN et refuse un autre chercheur', async () => {
    await service.updateStatus(stepIds.sample, 'ABANDONED', {
      id: stepIds.admin,
      role: 'ADMIN',
    });
    sample.update.mockClear();
    await expect(
      service.updateStatus(stepIds.sample, 'ACTIVE', {
        id: stepIds.other,
        role: 'RESEARCHER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sample.update).not.toHaveBeenCalled();
  });
  it('renvoie 404 pour un échantillon absent', async () => {
    sample.findUnique.mockResolvedValue(null);
    await expect(
      service.updateStatus(stepIds.sample, 'ACTIVE', {
        id: stepIds.owner,
        role: 'RESEARCHER',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Corrections et journal (Prisma simulé)', () => {
  function context() {
    const fixture = fabricationMock();
    const previous = {
      ...fixture.legacy,
      sample: { creatorId: stepIds.owner },
      stepType: {
        id: stepIds.type,
        name: 'Dépôt',
        code: 'DEPOT',
        isActive: false,
        parameters: fixture.definitions,
      },
    };
    const fabricationStep = {
      findUnique: jest.fn().mockResolvedValue(previous),
      update: jest.fn().mockResolvedValue({ ...previous, revision: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: previous.id }),
    };
    const stepCorrection = { create: jest.fn(), findMany: jest.fn() };
    const tx = { fabricationStep, stepCorrection, user: fixture.tx.user };
    const prisma = {
      ...tx,
      $transaction: jest.fn((work: (value: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    return {
      service: new FabricationStepsService(prisma as unknown as PrismaService),
      previous,
      fabricationStep,
      stepCorrection,
      prisma,
    };
  }
  const actor = { id: stepIds.owner, role: 'RESEARCHER' as const };
  it('conserve avant/après, motif et auteur JWT dans une transaction', async () => {
    const c = context();
    await c.service.correct(
      stepIds.sample,
      c.previous.id,
      {
        expectedRevision: 0,
        reason: 'Erreur de cahier',
        observations: 'Corrigé',
      },
      actor,
    );
    expect(c.fabricationStep.update.mock.calls[0][0].data).toEqual({
      observations: 'Corrigé',
      revision: { increment: 1 },
    });
    const audit = c.stepCorrection.create.mock.calls[0][0].data;
    expect(audit.reason).toBe('Erreur de cahier');
    expect(audit.correctedById).toBe(actor.id);
    expect(audit.revision).toBe(1);
    expect(audit.beforeSnapshot.parameters).toBe('temperature=120 C');
    expect(audit.afterSnapshot).toBeDefined();
    expect(c.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('permet la correction des valeurs d’un type inactif', async () => {
    const c = context();
    await c.service.correct(
      stepIds.sample,
      c.previous.id,
      {
        expectedRevision: 0,
        reason: 'Réglage mal recopié',
        parameterValues: [
          {
            definitionId: stepIds.number,
            value: '1.123456789012345678901234567891',
          },
          { definitionId: stepIds.boolean, value: false },
        ],
      },
      actor,
    );
    const value =
      c.fabricationStep.update.mock.calls[0][0].data.parameterValues.create[0];
    expect(value.numericValue.toFixed()).toBe(
      '1.123456789012345678901234567891',
    );
  });
  it('refuse un autre propriétaire et une étape d’un autre échantillon', async () => {
    const c = context();
    await expect(
      c.service.correct(
        stepIds.sample,
        c.previous.id,
        { expectedRevision: 0, reason: 'R', observations: 'X' },
        { id: stepIds.other, role: 'RESEARCHER' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      c.service.correct(
        stepIds.other,
        c.previous.id,
        { expectedRevision: 0, reason: 'R', observations: 'X' },
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(c.fabricationStep.update).not.toHaveBeenCalled();
  });
  it('refuse une révision périmée', async () => {
    const c = context();
    await expect(
      c.service.correct(
        stepIds.sample,
        c.previous.id,
        { expectedRevision: 2, reason: 'R', observations: 'X' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(c.stepCorrection.create).not.toHaveBeenCalled();
  });
  it.each([
    { values: [] },
    { values: [{ definitionId: stepIds.other, value: 'X' }] },
    {
      values: [
        { definitionId: stepIds.number, value: '1' },
        { definitionId: stepIds.number, value: '2' },
      ],
    },
  ])('refuse des paramètres invalides', async ({ values: parameterValues }) => {
    const c = context();
    await expect(
      c.service.correct(
        stepIds.sample,
        c.previous.id,
        { expectedRevision: 0, reason: 'R', parameterValues },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(c.fabricationStep.update).not.toHaveBeenCalled();
  });
  it('ne masque pas l’échec du journal, provoquant le rollback Prisma', async () => {
    const c = context();
    c.stepCorrection.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      c.service.correct(
        stepIds.sample,
        c.previous.id,
        { expectedRevision: 0, reason: 'R', observations: 'X' },
        actor,
      ),
    ).rejects.toThrow('audit unavailable');
  });
  it('refuse un motif sans champ à corriger', async () => {
    const c = context();
    await expect(
      c.service.correct(
        stepIds.sample,
        c.previous.id,
        { expectedRevision: 0, reason: 'R' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('consulte le journal dans l’ordre des révisions', async () => {
    const c = context();
    await c.service.findCorrections(stepIds.sample, c.previous.id);
    expect(c.stepCorrection.findMany).toHaveBeenCalledWith({
      where: { stepId: c.previous.id },
      orderBy: { revision: 'asc' },
      include: { correctedBy: { select: { id: true, name: true } } },
    });
  });
});
