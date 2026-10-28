import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { PasswordService } from './password.service';

describe('AdminBootstrapService (Prisma simulé)', () => {
  const tx = { user: { count: jest.fn(), create: jest.fn() } };
  const prisma = { $transaction: jest.fn() };
  const passwords = { hash: jest.fn() };
  let service: AdminBootstrapService;
  beforeEach(() => {
    jest.resetAllMocks();
    tx.user.count.mockResolvedValue(0);
    tx.user.create.mockResolvedValue({ id: 'admin-test' });
    passwords.hash.mockResolvedValue('hash-simulé');
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => Promise<void>) => fn(tx),
    );
    service = new AdminBootstrapService(
      prisma as unknown as PrismaService,
      passwords as unknown as PasswordService,
    );
  });
  it('crée uniquement un ADMIN avec un mot de passe haché dans une transaction sérialisable', async () => {
    await service.create(' Admin ', 'admin@example.test', 'password-test-12');
    expect(passwords.hash).toHaveBeenCalledWith('password-test-12');
    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        name: 'Admin',
        email: 'admin@example.test',
        passwordHash: 'hash-simulé',
        role: 'ADMIN',
      },
      select: { id: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('refuse de remplacer un administrateur existant', async () => {
    tx.user.count.mockResolvedValue(1);
    await expect(
      service.create('Admin', 'admin@example.test', 'password-test-12'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });
  it.each([
    ['', 'admin@example.test', 'password-test-12'],
    ['Admin', 'invalid', 'password-test-12'],
    ['Admin', 'admin@example.test', 'short'],
    ['Admin', 'admin@example.test', 'é'.repeat(40)],
  ])('valide les variables locales', async (name, email, password) => {
    await expect(service.create(name, email, password)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['P2002', 'P2034'])(
    'traite %s sans remplacer de compte',
    async (code) => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Conflict', {
          code,
          clientVersion: '7.10.1',
        }),
      );
      await expect(
        service.create('Admin', 'admin@example.test', 'password-test-12'),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
});
