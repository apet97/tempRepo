// Mock UI module for testing
// This is a manual mock that doesn't depend on real DOM elements

export const Elements = {
  resultsContainer: { classList: { add: jest.fn(), remove: jest.fn() } },
  summaryStrip: { innerHTML: '', classList: { add: jest.fn(), remove: jest.fn() } },
  summaryTableBody: { innerHTML: '', appendChild: jest.fn() },
  userOverridesBody: { innerHTML: '', addEventListener: jest.fn() },
  loadingState: { classList: { add: jest.fn(), remove: jest.fn() } },
  emptyState: { classList: { add: jest.fn(), remove: jest.fn() }, textContent: '' },
  apiStatusBanner: { classList: { add: jest.fn(), remove: jest.fn() }, textContent: '' }
};

export const initializeElements = jest.fn(() => Elements);
export const hideError = jest.fn();

export function renderLoading(isLoading) {
  // Mock implementation
}

export function renderApiStatus() {
  // Mock implementation
}

export function renderOverridesTable() {
  // Mock implementation
}

export function renderSummaryStrip(users) {
  // Mock implementation
}

export function renderSummaryTable(users) {
  // Mock implementation
}

export function renderDetailedTable(users, filter) {
  // Mock implementation
}

export function bindEvents(callbacks) {
  // Mock implementation
}

export function showError(message) {
  // Mock implementation
}
