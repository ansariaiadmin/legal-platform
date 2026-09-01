import type { Config } from 'jest';

/**
 * Integration suite. It needs a reachable PostgreSQL (see the `migrations`
 * job in .github/workflows/ci.yml, which runs it against a real
 * pgvector/pgvector:pg16 service container). Without DATABASE_URL the suite
 * skips itself instead of failing.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e-spec.ts'],
  testTimeout: 60_000,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          isolatedModules: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@legal-platform/(.*)$': '<rootDir>/../../packages/$1/src/index.ts',
  },
};

export default config;
