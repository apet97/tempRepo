export default {
  testEnvironment: 'jsdom',
  transform: {},
  moduleNameMapper: {},
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  collectCoverageFrom: [
    'js/**/*.js',
    '!js/**/*.backup.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 75,
      lines: 80,
      statements: 80
    }
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'js/test-helpers.js'
  ],
  moduleFileExtensions: ['js'],
  verbose: false,
  clearMocks: true,
  fakeTimers: {
    enableGlobally: true
  }
};
