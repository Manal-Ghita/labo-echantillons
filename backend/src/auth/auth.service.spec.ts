import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, publicUserSelect } from './auth.service';
import { PasswordService } from './password.service';

describe('AuthService (Prisma simulé)', () => {
  const prisma = { user: { findUnique: jest.fn() } };
  const jwt = { signAsync: jest.fn() };
  const passwords = { hash: jest.fn(), verify: jest.fn() };
  let service: AuthService;
  const user = {
    id: 'test-id',
    email: 'test@example.test',
    role: 'RESEARCHER',
    passwordHash: 'test-hash',
  };
  beforeEach(() => {
    jest.resetAllMocks();
    passwords.hash.mockResolvedValue('dummy-test-hash');
    passwords.verify.mockResolvedValue(true);
    jwt.signAsync.mockResolvedValue('test-token');
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      passwords as unknown as PasswordService,
    );
  });
  it('signe uniquement après vérification du mot de passe, sans renvoyer son empreinte', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(
      service.login({ email: user.email, password: 'test-password' }),
    ).resolves.toEqual({
      access_token: 'test-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    expect(passwords.verify).toHaveBeenCalledWith(
      'test-password',
      user.passwordHash,
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: user.id });
  });
  it('refuse un mot de passe incorrect sans signer', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.login({ email: user.email, password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it('compare aussi pour un compte inconnu et refuse la connexion', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: user.email, password: 'test-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwords.verify).toHaveBeenCalledWith(
      'test-password',
      'dummy-test-hash',
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it('ne sélectionne pas le hash pour une identité vérifiée', async () => {
    const identity = { id: user.id };
    prisma.user.findUnique.mockResolvedValue(identity);
    await expect(service.findIdentity(user.id)).resolves.toEqual(identity);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: publicUserSelect,
    });
  });
  it('refuse une identité absente de la base', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findIdentity(user.id)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
