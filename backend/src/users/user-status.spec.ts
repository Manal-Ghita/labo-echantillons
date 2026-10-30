import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { Prisma } from '../generated/prisma/client';

describe('Statut utilisateur — transaction Prisma simulée', () => {
  const actor = { id: 'admin', role: 'ADMIN', isActive: true, authVersion: 4 };
  const initial = {
    id: 'target',
    name: 'Sam',
    email: 'sam@example.test',
    role: 'RESEARCHER',
    isActive: true,
    authVersion: 8,
    createdAt: new Date(),
    passwordHash: 'never-public',
  };
  let target: typeof initial;
  const user = {
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
  const tx = { user };
  const prisma = { user, $transaction: jest.fn() };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    {} as PasswordService,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    target = { ...initial };
    user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === 'admin' ? actor : where.id === 'target' ? target : null,
      ),
    );
    user.count.mockResolvedValue(2);
    user.update.mockImplementation(
      ({ data }: { data: { isActive: boolean } }) =>
        Promise.resolve({
          ...target,
          isActive: data.isActive,
          authVersion: target.authVersion + 1,
        }),
    );
    prisma.$transaction.mockImplementation(
      (work: (value: typeof tx) => Promise<unknown>) => work(tx),
    );
  });
  it('change seulement état/version atomiquement, et ne renvoie aucun secret', async () => {
    const response = await service.updateStatus('target', false, 'admin', 4);
    expect(response.isActive).toBe(false);
    expect(response).not.toHaveProperty('authVersion');
    expect(response).not.toHaveProperty('passwordHash');
    expect(user.update.mock.calls[0][0].data).toEqual({
      isActive: false,
      authVersion: { increment: 1 },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('réactive sans changer identité, rôle ou mot de passe', async () => {
    target.isActive = false;
    expect(
      (await service.updateStatus('target', true, 'admin', 4)).isActive,
    ).toBe(true);
    expect(Object.keys(user.update.mock.calls[0][0].data).sort()).toEqual([
      'authVersion',
      'isActive',
    ]);
  });
  it('ne réincrémente pas une version pour un état déjà atteint', async () => {
    await service.updateStatus('target', true, 'admin', 4);
    expect(user.update).not.toHaveBeenCalled();
  });
  it('refuse l’auto-désactivation', async () => {
    await expect(
      service.updateStatus('admin', false, 'admin', 4),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(user.update).not.toHaveBeenCalled();
  });
  it('refuse de désactiver le dernier ADMIN actif', async () => {
    target.role = 'ADMIN';
    user.count.mockResolvedValue(1);
    await expect(
      service.updateStatus('target', false, 'admin', 4),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(user.update).not.toHaveBeenCalled();
  });
  it('permet la désactivation d’un autre ADMIN quand il en reste un actif', async () => {
    target.role = 'ADMIN';
    await service.updateStatus('target', false, 'admin', 4);
    expect(user.count).toHaveBeenCalledWith({
      where: { role: 'ADMIN', isActive: true },
    });
    expect(user.update).toHaveBeenCalledTimes(1);
  });
  it('revérifie la version de session de l’appelant dans la transaction', async () => {
    await expect(
      service.updateStatus('target', false, 'admin', 3),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.update).not.toHaveBeenCalled();
  });
  it('revérifie l’activité et le rôle dans la transaction', async () => {
    user.findUnique.mockResolvedValueOnce({ ...actor, isActive: false });
    await expect(
      service.updateStatus('target', false, 'admin', 4),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    user.findUnique.mockResolvedValueOnce({ ...actor, role: 'RESEARCHER' });
    await expect(
      service.updateStatus('target', false, 'admin', 4),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('renvoie 404 pour une cible absente', async () => {
    await expect(
      service.updateStatus('missing', false, 'admin', 4),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each(['P2034', 'P2025'])(
    'convertit %s en conflit sans succès trompeur',
    async (code) => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code,
          clientVersion: '7.10.1',
        }),
      );
      await expect(
        service.updateStatus('target', false, 'admin', 4),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it('garde les opérateurs désactivés et la projection id/nom', async () => {
    user.findMany.mockResolvedValue([{ ...target, isActive: false }]);
    expect(await service.findOperators()).toEqual([
      { id: 'target', name: 'Sam' },
    ]);
    expect(user.findMany.mock.calls[0][0]).not.toHaveProperty('where');
  });
  it.each(['40001', '40P01'])(
    'convertit le conflit adapter-pg %s au commit en 409',
    async (code) => {
      prisma.$transaction.mockRejectedValue(
        Object.assign(new Error('TransactionWriteConflict'), {
          name: 'DriverAdapterError',
          cause: { kind: 'TransactionWriteConflict', originalCode: code },
        }),
      );
      await expect(
        service.updateStatus('target', false, 'admin', 4),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it('ne masque pas une erreur driver sans rapport avec la concurrence', async () => {
    const failure = Object.assign(new Error('Other database failure'), {
      name: 'DriverAdapterError',
      cause: { kind: 'UniqueConstraintViolation', originalCode: '23505' },
    });
    prisma.$transaction.mockRejectedValue(failure);
    await expect(
      service.updateStatus('target', false, 'admin', 4),
    ).rejects.toBe(failure);
  });
});
