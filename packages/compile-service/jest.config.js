/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
  // Real-Docker tests (Step 12) live in tests/integration and run only with: npm test -- --selectProjects ... or RUN_DOCKER_TESTS=1
  testPathIgnorePatterns: process.env.RUN_DOCKER_TESTS ? [] : ['/tests/integration/'],
};
