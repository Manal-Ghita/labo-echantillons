import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { AdminBootstrapService } from '../src/auth/admin-bootstrap.service';
import { PasswordService } from '../src/auth/password.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

// This suite is opt-in, never run by npm test. No migrations or database creation.
describe('Premier administrateur / PostgreSQL de test dédié', () => {
  let prisma: PrismaClient;
  const rollback = new Error('Intentional test rollback');

  beforeAll(async () => {
    const value = process.env.TEST_DATABASE_URL;
    if (!value)
      throw new Error('TEST_DATABASE_URL est requis ; aucune base par défaut.');
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (
      !name.endsWith('_test') ||
      name === 'labo_echantillons' ||
      ![null, 'public'].includes(url.searchParams.get('schema'))
    ) {
      throw new Error(
        'Utiliser une base dédiée terminant par _test et le schéma public.',
      );
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: value,
        connectionTimeoutMillis: 3000,
      }),
    });
    await prisma.$connect();
    const actual = await prisma.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (actual[0]?.name !== name) throw new Error('Base cible inattendue.');
    if ((await prisma.user.count()) !== 0)
      throw new Error(
        'La base de test doit être vide ; aucun nettoyage automatique.',
      );
  });
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('crée un ADMIN bcrypt, interdit un second, puis annule toutes les écritures', async () => {
    const passwords = new PasswordService();
    const email = `integration-${randomUUID()}@example.test`;
    const password = randomUUID();
    await expect(
      prisma.$transaction(
        async (tx) => {
          // Reuse the existing transaction so bootstrap's writes are always rolled back.
          const scoped = {
            $transaction: (fn: (client: typeof tx) => Promise<void>) => fn(tx),
          } as unknown as PrismaService;
          const bootstrap = new AdminBootstrapService(scoped, passwords);
          await bootstrap.create('Integration admin', email, password);
          const user = await tx.user.findUniqueOrThrow({ where: { email } });
          expect(user.role).toBe('ADMIN');
          expect(user.passwordHash).not.toBe(password);
          await expect(
            passwords.verify(password, user.passwordHash),
          ).resolves.toBe(true);
          await expect(
            bootstrap.create('Second admin', `second-${email}`, password),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(await tx.user.count()).toBe(1);
          throw rollback;
        },
        { isolationLevel: 'Serializable', timeout: 15000 },
      ),
    ).rejects.toBe(rollback);
    expect(await prisma.user.count()).toBe(0);
  });
});
