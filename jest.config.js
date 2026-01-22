export default {
  testEnvironment: 'jsdom',
  // Transform TypeScript files with ts-jest in ESM mode
  transform: {
    '\\.ts$': ['ts-jest', {
      useESM: true
    }]
  },
  // Use custom resolver to map .js to .ts for project files
  resolver: './jest.resolver.cjs',
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  collectCoverageFrom: [
    'js/**/*.ts',
    '!js/**/*.d.ts',
    '!js/**/*.backup.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 75,
      lines: 75,
      statements: 75
    }
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'js/test-helpers.ts',
    'js/calc.worker.ts',    // Web Worker - requires Worker API, not available in jsdom
    'js/worker-manager.ts', // Worker management - requires Worker API
    'js/logger.ts',         // Logging - side-effect heavy, low-value coverage
    'js/main.ts',           // Orchestrator - requires full integration test
    'js/ui/index.ts',       // UI bootstrap - requires full DOM integration
    'js/ui/overrides.ts',   // Complex DOM table - requires integration test
    'js/error-reporting.ts' // Sentry integration - optional/graceful, dynamic import
  ],
  moduleFileExtensions: ['js', 'ts'],
  verbose: false,
  silent: true,
  clearMocks: true,
  fakeTimers: {
    enableGlobally: true
  },
  extensionsToTreatAsEsm: ['.ts'],
  transformIgnorePatterns: [
    '/node_modules/'
  ]
};
