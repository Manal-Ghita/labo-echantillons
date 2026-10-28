import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    // Prisma generates .js imports pointing to TypeScript source before build.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/generated/**',
    '!src/main.ts',
    '!src/auth/create-admin.ts',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
