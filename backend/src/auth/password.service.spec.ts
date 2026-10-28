import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();
  it('hache avec bcrypt coût 12 et vérifie sans conserver le mot de passe', async () => {
    const password = 'a-test-password';
    const encoded = await service.hash(password);
    expect(encoded.startsWith('$2b$12$')).toBe(true);
    expect(encoded).not.toBe(password);
    await expect(service.verify(password, encoded)).resolves.toBe(true);
    await expect(service.verify('incorrect', encoded)).resolves.toBe(false);
    await expect(service.verify('é'.repeat(40), encoded)).resolves.toBe(false);
  });
});
