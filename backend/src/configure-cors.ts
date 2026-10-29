import type { INestApplication } from '@nestjs/common';

export function configureCors(
  app: INestApplication,
  value = process.env.WEB_ORIGIN ?? 'http://localhost:5173',
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WEB_ORIGIN doit être une origine HTTP(S) unique.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'WEB_ORIGIN doit être une origine HTTP(S) unique, sans chemin ni identifiants.',
    );
  }
  const allowed = url.origin;
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void,
    ) => callback(null, origin === allowed),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });
}
