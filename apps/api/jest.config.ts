import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // ts-jest warns about Node16 module resolution unless this is set.
          isolatedModules: true,
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Unit tests compile workspace sources directly instead of requiring the
    // built dist/, so a stale build can never make a test pass.
    // Agents (apps/agents/*) are workspace sources too — SPEC section 11a.
    '^@legal-platform/agent-(.*)$': '<rootDir>/../../apps/agents/$1/src/index.ts',
    '^@legal-platform/(.*)$': '<rootDir>/../../packages/$1/src/index.ts',
  },
};

export default config;
