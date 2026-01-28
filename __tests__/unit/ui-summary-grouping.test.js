/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { renderSummaryTable } from '../../js/ui/summary.js';
import { initializeElements } from '../../js/ui/shared.js';
import { store } from '../../js/state.js';
import { calculateAnalysis } from '../../js/calc.js';
import { formatWeekKey, getWeekKey } from '../../js/utils.js';
import { createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Summary Table grouping behaviors', () => {
  let storeSnapshot;

  beforeEach(() => {
    jest.clearAllMocks();

    storeSnapshot = {
      users: store.users,
      config: { ...store.config },
      calcParams: { ...store.calcParams },
      profiles: store.profiles,
      holidays: store.holidays,
      timeOff: store.timeOff,
      overrides: store.overrides,
      ui: { ...store.ui }
    };

    document.body.innerHTML = `
      <div id="resultsContainer" class="hidden"></div>
      <div id="summaryCard">
        <table><thead><tr id="summaryHeaderRow"></tr></thead></table>
      </div>
      <div id="summaryTableBody"></div>
    `;
    initializeElements(true);

    const mockStore = createMockStore({
      users: [{ id: 'user1', name: 'Alice' }]
    });
    store.users = mockStore.users;
    store.config = mockStore.config;
    store.calcParams = mockStore.calcParams;
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.ui = { ...store.ui, summaryExpanded: true };
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
    store.users = storeSnapshot.users;
    store.config = storeSnapshot.config;
    store.calcParams = storeSnapshot.calcParams;
    store.profiles = storeSnapshot.profiles;
    store.holidays = storeSnapshot.holidays;
    store.timeOff = storeSnapshot.timeOff;
    store.overrides = storeSnapshot.overrides;
    store.ui = storeSnapshot.ui;
  });

  it('renders project grouping with project label', () => {
    store.ui.summaryGroupBy = 'project';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      projectId: 'proj1',
      projectName: 'Project A',
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Project');
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('Project A');
  });

  it('renders client grouping with client label', () => {
    store.ui.summaryGroupBy = 'client';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      clientId: 'client1',
      clientName: 'Client X',
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Client');
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('Client X');
  });

  it('renders task grouping with task label', () => {
    store.ui.summaryGroupBy = 'task';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      taskId: 'task1',
      taskName: 'Development',
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Task');
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain('Development');
  });

  it('renders week grouping with week label', () => {
    store.ui.summaryGroupBy = 'week';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).toContain('Week');
    const expectedLabel = formatWeekKey(getWeekKey('2025-01-15'));
    const firstRow = document.querySelector('#summaryTableBody tr');
    expect(firstRow?.textContent).toContain(expectedLabel);
  });

  it('hides billable columns when breakdown is disabled', () => {
    store.config.showBillableBreakdown = false;
    store.ui.summaryGroupBy = 'user';

    const entries = [{
      id: 'entry1',
      userId: 'user1',
      userName: 'Alice',
      timeInterval: {
        start: '2025-01-15T09:00:00Z',
        end: '2025-01-15T17:00:00Z',
        duration: 'PT8H'
      },
      hourlyRate: { amount: 5000 },
      billable: true
    }];

    const analysis = calculateAnalysis(entries, store, {
      start: '2025-01-01',
      end: '2025-01-31'
    });

    renderSummaryTable(analysis);

    const header = document.querySelector('#summaryHeaderRow');
    expect(header.textContent).not.toContain('Bill.');
  });
});
