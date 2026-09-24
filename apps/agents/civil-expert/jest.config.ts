import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { isolatedModules: true } }] },
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@legal-platform/(.*)$': '<rootDir>/../../../packages/$1/src/index.ts',
  },
};

export default config;
