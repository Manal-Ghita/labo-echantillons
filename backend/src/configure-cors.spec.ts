import type { INestApplication } from '@nestjs/common';
import { configureCors } from './configure-cors';

describe('Configuration CORS', () => {
  it.each([
    '*',
    'http://localhost:5173/path',
    'ftp://example.test',
    'https://user:pass@example.test',
    'https://example.test?token=value',
  ])('refuse une origine trop large ou invalide : %s', (value) => {
    const app = { enableCors: jest.fn() };
    expect(() =>
      configureCors(app as unknown as INestApplication, value),
    ).toThrow('WEB_ORIGIN');
    expect(app.enableCors).not.toHaveBeenCalled();
  });
});
