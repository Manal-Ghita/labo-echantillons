import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStepTypeDto } from './dto/create-step-type.dto';
import { StepTypesService } from './step-types.service';

describe('StepTypesService (Prisma simulé)', () => {
  let service: StepTypesService;
  const prisma = {
    stepType: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const id = '762849cc-220e-4e4f-b4af-2e1593697d0e';
  const dto = {
    code: 'DEPOSITION',
    name: 'Dépôt',
    parameters: [
      {
        key: 'temperature',
        name: 'Température',
        dataType: 'NUMBER',
        unit: 'C',
        isRequired: true,
      },
    ],
  } satisfies CreateStepTypeDto;
  const catalog = { id, ...dto, isActive: true };
  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        StepTypesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(StepTypesService);
  });

  it('liste uniquement les types actifs et ordonne leurs paramètres', async () => {
    prisma.stepType.findMany.mockResolvedValue([catalog]);
    await expect(service.findAll(false, 'RESEARCHER')).resolves.toEqual([
      catalog,
    ]);
    expect(prisma.stepType.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      include: { parameters: { orderBy: { key: 'asc' } } },
      orderBy: { code: 'asc' },
    });
  });
  it('permet à ADMIN de consulter aussi les types inactifs', async () => {
    prisma.stepType.findMany.mockResolvedValue([]);
    await service.findAll(true, 'ADMIN');
    expect(prisma.stepType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
  it('refuse la liste inactive à RESEARCHER avant toute requête', () => {
    expect(() => service.findAll(true, 'RESEARCHER')).toThrow(
      ForbiddenException,
    );
    expect(prisma.stepType.findMany).not.toHaveBeenCalled();
  });
  it('filtre les types inactifs lors de la consultation par un chercheur', async () => {
    prisma.stepType.findFirst.mockResolvedValue(catalog);
    await expect(service.findOne(id, 'RESEARCHER')).resolves.toEqual(catalog);
    expect(prisma.stepType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, isActive: true } }),
    );
  });
  it('autorise la consultation individuelle inactive par ADMIN', async () => {
    prisma.stepType.findFirst.mockResolvedValue({
      ...catalog,
      isActive: false,
    });
    await service.findOne(id, 'ADMIN');
    expect(prisma.stepType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id } }),
    );
  });
  it('retourne 404 pour une entrée absente ou non visible', async () => {
    prisma.stepType.findFirst.mockResolvedValue(null);
    await expect(service.findOne(id, 'RESEARCHER')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('crée le type et ses définitions dans une écriture imbriquée atomique', async () => {
    prisma.stepType.create.mockResolvedValue(catalog);
    await expect(service.create(dto)).resolves.toEqual(catalog);
    expect(prisma.stepType.create).toHaveBeenCalledWith({
      data: {
        code: dto.code,
        name: dto.name,
        description: undefined,
        parameters: { create: dto.parameters },
      },
      include: { parameters: { orderBy: { key: 'asc' } } },
    });
  });
  it('accepte une opération sans paramètres', async () => {
    await service.create({ ...dto, parameters: [] });
    expect(prisma.stepType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ parameters: { create: [] } }),
      }),
    );
  });
  it('traduit un conflit d’unicité concurrent en 409', async () => {
    prisma.stepType.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );
    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
  });
  it('ne masque pas une panne inattendue', async () => {
    const error = new Error('Database unavailable');
    prisma.stepType.create.mockRejectedValue(error);
    await expect(service.create(dto)).rejects.toBe(error);
  });
  it('ne met à jour que la description, le nom et la disponibilité', async () => {
    const patch = { name: 'Dépôt renommé', description: null, isActive: false };
    prisma.stepType.update.mockResolvedValue({ ...catalog, ...patch });
    await expect(service.update(id, patch)).resolves.toMatchObject({
      isActive: false,
    });
    expect(prisma.stepType.update).toHaveBeenCalledWith({
      where: { id },
      data: patch,
      include: { parameters: { orderBy: { key: 'asc' } } },
    });
  });
  it('réactive sans toucher aux définitions ni aux anciennes étapes', async () => {
    await service.update(id, { isActive: true });
    expect(prisma.stepType.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );
  });
  it('refuse un PATCH vide', async () => {
    await expect(service.update(id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.stepType.update).not.toHaveBeenCalled();
  });
  it('retourne 404 si la cible du PATCH a disparu', async () => {
    prisma.stepType.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Missing', {
        code: 'P2025',
        clientVersion: '7.10.1',
      }),
    );
    await expect(
      service.update(id, { isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('ne masque pas une panne lors du PATCH', async () => {
    const error = new Error('Database unavailable');
    prisma.stepType.update.mockRejectedValue(error);
    await expect(service.update(id, { isActive: false })).rejects.toBe(error);
  });
});
