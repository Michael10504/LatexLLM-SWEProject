/** Step 12: real-Docker integration tests. Run on the dev machine with Docker Desktop on: npm run test:docker */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
  testTimeout: 180000,
  maxWorkers: 1,
};
