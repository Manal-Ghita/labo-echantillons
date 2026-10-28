import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SamplesService } from './samples.service';

describe('SamplesService (Prisma simulé)', () => {
  let service: SamplesService;
  const prisma = {
    user: { findUnique: jest.fn() },
    sample: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  };
  const creatorId = '3fd8de68-8847-42fc-94df-99459f699ba9';
  const sample = {
    id: 'b25dd475-83ce-47d7-8538-d2c53fcfcb4e',
    reference: 'LAB-001',
    name: 'Film souple',
    creatorId,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [SamplesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(SamplesService);
    prisma.user.findUnique.mockResolvedValue({ id: creatorId });
    prisma.sample.create.mockResolvedValue(sample);
  });

  it('crée avec le créateur serveur et normalise les champs obligatoires', async () => {
    await expect(
      service.create(
        {
          reference: ' LAB-001 ',
          name: ' Film souple ',
          description: 'Description',
        },
        creatorId,
      ),
    ).resolves.toEqual(sample);
    expect(prisma.sample.create).toHaveBeenCalledWith({
      data: {
        reference: 'LAB-001',
        name: 'Film souple',
        description: 'Description',
        creator: { connect: { id: creatorId } },
      },
    });
  });

  it('accepte une description absente', async () => {
    await expect(
      service.create({ reference: 'LAB-001', name: 'Film' }, creatorId),
    ).resolves.toEqual(sample);
  });

  it.each([
    {},
    { reference: 'X' },
    { reference: ' ', name: 'Film' },
    { reference: 'X', name: ' ' },
    { reference: 42, name: 'Film' },
    { reference: 'X', name: 'Film', description: 42 },
    { reference: 'X', name: 'Film', description: null },
    { reference: 'X', name: 'Film', createdById: 'intrus' },
    { reference: 'X', name: 'Film', creatorId: 'intrus' },
  ])('rejette les données invalides : %j', async (input) => {
    await expect(
      service.create(input as never, creatorId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sample.create).not.toHaveBeenCalled();
  });

  it('refuse un créateur absent', async () => {
    await expect(
      service.create({ reference: 'X', name: 'Film' }, ''),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sample.create).not.toHaveBeenCalled();
  });

  it('refuse un créateur inconnu sans fabriquer de compte', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ reference: 'X', name: 'Film' }, creatorId),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sample.create).not.toHaveBeenCalled();
  });

  it.each([
    ['P2002', ConflictException],
    ['P2003', UnauthorizedException],
    ['P2025', UnauthorizedException],
  ] as const)('traduit %s en erreur métier', async (code, exception) => {
    prisma.sample.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Test', {
        code,
        clientVersion: '7.10.1',
      }),
    );
    await expect(
      service.create({ reference: 'X', name: 'Film' }, creatorId),
    ).rejects.toBeInstanceOf(exception);
  });

  it('propage une panne inattendue', async () => {
    const error = new Error('Panne simulée');
    prisma.sample.create.mockRejectedValue(error);
    await expect(
      service.create({ reference: 'X', name: 'Film' }, creatorId),
    ).rejects.toBe(error);
  });

  it('liste les échantillons', async () => {
    prisma.sample.findMany.mockResolvedValue([sample]);
    await expect(service.findAll()).resolves.toEqual([sample]);
    expect(prisma.sample.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  });

  it('recherche par référence OU nom, sans distinction de casse', async () => {
    prisma.sample.findMany.mockResolvedValue([]);
    await expect(service.findAll(' film ')).resolves.toEqual([]);
    expect(prisma.sample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { reference: { contains: 'film', mode: 'insensitive' } },
            { name: { contains: 'film', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('traite une recherche vide comme une liste', async () => {
    prisma.sample.findMany.mockResolvedValue([]);
    await service.findAll('  ');
    expect(prisma.sample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('retourne un échantillon par identifiant', async () => {
    prisma.sample.findUnique.mockResolvedValue(sample);
    await expect(service.findOne(sample.id)).resolves.toEqual(sample);
    expect(prisma.sample.findUnique).toHaveBeenCalledWith({
      where: { id: sample.id },
    });
  });

  it('signale un échantillon inexistant', async () => {
    prisma.sample.findUnique.mockResolvedValue(null);
    await expect(service.findOne(sample.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
