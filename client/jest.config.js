module.exports = {
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.clienttest.ts'],
  transform: {
    '^.+\\.ts$': '<rootDir>/jest.ws6.transform.js'
  },
  testEnvironment: 'node'
};