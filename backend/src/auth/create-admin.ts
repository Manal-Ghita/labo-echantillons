import 'dotenv/config';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { PasswordService } from './password.service';

async function main(): Promise<void> {
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!name || !email || !password)
    throw new Error('ADMIN_NAME, ADMIN_EMAIL et ADMIN_PASSWORD sont requis.');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    await new AdminBootstrapService(prisma, new PasswordService()).create(
      name,
      email,
      password,
    );
    console.log('Premier administrateur créé.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof HttpException
        ? error.message
        : 'Création impossible : vérifier les variables ADMIN_* et la connexion PostgreSQL.',
    );
    process.exitCode = 1;
  });
}
