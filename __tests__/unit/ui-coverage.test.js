/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import * as UI from '../../js/ui.js';
import { store } from '../../js/state.js';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();

describe('UI Module - Additional Coverage', () => {
  let mockStore;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset store to clean state
    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      overtimeBasis: 'daily'
    };
    store.calcParams = {
      dailyThreshold: 8,
      weeklyThreshold: 40,
      overtimeMultiplier: 1.5
    };
    store.users = [];
    store.profiles.clear();
    store.holidays.clear();
    store.timeOff.clear();
    store.overrides = {};

    document.body.innerHTML = `
      <div id="resultsContainer" class="hidden"></div>
      <div id="summaryStrip"></div>
      <div id="summaryTableBody"></div>
      <div id="detailedTableContainer"></div>
      <div id="userOverridesBody"></div>
      <div id="loadingState" class="hidden"></div>
      <div id="emptyState" class="hidden"></div>
      <div id="apiStatusBanner" class="hidden"></div>
      <div id="detailedCard" class="hidden"></div>
      <div id="summaryCard">
        <table><thead><tr></tr></thead></table>
      </div>
      <div id="detailedFilters">
        <button class="chip" data-filter="all">All</button>
        <button class="chip" data-filter="holiday">Holidays</button>
        <button class="chip" data-filter="offday">Off-days</button>
        <button class="chip" data-filter="billable">Billable</button>
      </div>
      <div id="configContent"></div>
      <input type="checkbox" id="useProfileCapacity" checked>
      <input type="checkbox" id="useProfileWorkingDays" checked>
      <input type="checkbox" id="applyHolidays" checked>
      <input type="checkbox" id="applyTimeOff" checked>
      <input type="checkbox" id="showBillableBreakdown" checked>
      <input type="number" id="configDaily" value="8">
      <input type="number" id="configMultiplier" value="1.5">
      <button id="configToggle">Toggle</button>
      <button id="generateBtn">Generate</button>
      <button id="exportBtn">Export</button>
    `;

    UI.initializeElements(true); // Force re-initialization to prevent stale references

    mockStore = createMockStore({
      users: [{ id: 'user1', name: 'Alice' }]
    });

    store.users = mockStore.users;
    store.config = mockStore.config;
    store.calcParams = mockStore.calcParams;
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
  });

  describe('renderApiStatus', () => {
    it('should show all failure types in banner', () => {
      store.apiStatus = {
        profilesFailed: 3,
        holidaysFailed: 2,
        timeOffFailed: 1
      };

      UI.renderApiStatus();

      const banner = document.getElementById('apiStatusBanner');
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.textContent).toContain('Profiles: 3 failed');
      expect(banner.textContent).toContain('Holidays: 2 failed');
      expect(banner.textContent).toContain('Time Off: 1 failed');
    });
  });

  describe('renderSummaryStrip', () => {
    it('should display holiday and time off counts', () => {
      const users = [{
        userId: 'user1',
        userName: 'Alice',
        totals: {
          expectedCapacity: 40,
          total: 45,
          regular: 40,
          overtime: 5,
          billableWorked: 30,
          nonBillableWorked: 15,
          billableOT: 3,
          nonBillableOT: 2,
          holidayCount: 2,
          timeOffCount: 1,
          amount: 1000,
          otPremium: 50
        }
      }];

      UI.renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.textContent).toContain('Holidays');
      expect(strip.textContent).toContain('2');
      expect(strip.textContent).toContain('Time Off');
      expect(strip.textContent).toContain('1');
    });
  });

  describe('renderSummaryTable', () => {
    it('should render with billable breakdown columns', () => {
      // Enable both billable breakdown and expanded state to show columns
      store.ui.summaryExpanded = true;

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

      UI.renderSummaryTable(analysis);

      const thead = document.querySelector('#summaryCard thead tr');
      expect(thead.innerHTML).toContain('Bill');
      expect(thead.innerHTML).toContain('Amount');
    });

    it('should hide billable columns when disabled', () => {
      store.config.showBillableBreakdown = false;

      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z'
        },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, store, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      UI.renderSummaryTable(analysis);

      const thead = document.querySelector('#summaryCard thead tr');
      expect(thead.innerHTML).not.toContain('Bill');
    });

    it('should show HIGH OT badge for >30% overtime', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T21:00:00Z', // 12 hours total
          duration: 'PT12H'
        },
        billable: true
      }];

      const analysis = calculateAnalysis(entries, store, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      UI.renderSummaryTable(analysis);

      const tbody = document.getElementById('summaryTableBody');
      expect(tbody.innerHTML).toContain('HIGH OT');
    });
  });

  describe('renderDetailedTable', () => {
    it('should filter to show only holiday entries', () => {
      // Updated test data structure: metadata is in day.meta.*
      const users = [{
        userId: 'user1',
        userName: 'Alice',
        days: new Map([
          ['2025-01-01', {
            entries: [{
              id: 'entry1',
              timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z' },
              description: 'Work',
              userName: 'Alice'
            }],
            meta: {
              isHoliday: true,
              isNonWorking: false,
              isTimeOff: false,
              holidayName: 'New Year',
              capacity: 0
            }
          }]
        ])
      }];

      UI.renderDetailedTable(users, 'holiday');

      const container = document.getElementById('detailedTableContainer');
      expect(container.textContent).toContain('HOLIDAY');
    });

    it('should filter to show only off-day entries', () => {
      // Updated test data structure: metadata is in day.meta.*
      const users = [{
        userId: 'user1',
        userName: 'Alice',
        days: new Map([
          ['2025-01-04', {
            entries: [{
              id: 'entry1',
              timeInterval: { start: '2025-01-04T09:00:00Z', end: '2025-01-04T17:00:00Z' }
            }],
            meta: {
              isHoliday: false,
              isNonWorking: true,
              isTimeOff: false,
              capacity: 0
            }
          }]
        ])
      }];

      UI.renderDetailedTable(users, 'offday');

      const container = document.getElementById('detailedTableContainer');
      expect(container.textContent).toContain('OFF-DAY');
    });

    it('should render empty state with filter name', () => {
      UI.renderDetailedTable([], 'holiday');

      const container = document.getElementById('detailedTableContainer');
      expect(container.textContent).toContain('holiday');
    });
  });

  describe('renderOverridesTable', () => {
    it('should render with profile capacity', () => {
      store.users = [{ id: 'user1', name: 'Alice' }];
      store.profiles.set('user1', {
        workCapacityHours: 7.5,
        workingDays: ['MONDAY']
      });

      UI.renderOverridesTable();

      const tbody = document.getElementById('userOverridesBody');
      expect(tbody.textContent).toContain('(7.5h profile)');
    });

    it('should handle empty users', () => {
      store.users = [];

      UI.renderOverridesTable();

      const tbody = document.getElementById('userOverridesBody');
      expect(tbody.children.length).toBe(0);
    });
  });

  describe('showError and hideError', () => {
    it('should show error banner', () => {
      UI.showError('Test error');

      const banner = document.getElementById('apiStatusBanner');
      expect(banner).toBeTruthy();
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it('should hide error banner', () => {
      UI.showError('Test error');

      const banner = document.getElementById('apiStatusBanner');
      expect(banner.classList.contains('hidden')).toBe(false);

      UI.hideError();

      expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('should handle error object', () => {
      const error = { title: 'Error', message: 'Something went wrong' };
      UI.showError(error);

      const banner = document.getElementById('apiStatusBanner');
      expect(banner).toBeTruthy();
      expect(banner.classList.contains('hidden')).toBe(false);
    });
  });
});
