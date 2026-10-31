/** Jest config for the WS-6 client module. Run from the repo root: npm run test:client */
module.exports = {
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.clienttest.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  testEnvironment: 'node'
};
