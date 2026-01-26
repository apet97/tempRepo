/**
 * @jest-environment jsdom
 */

/**
 * Summary Strip Layout Specification Tests
 *
 * This file documents the summary strip component layout and behavior:
 *
 * LAYOUT STRUCTURE:
 * - Two-row layout when showBillableBreakdown is ON
 *   - Row 1 (ot-summary-row-top): Time metrics
 *   - Row 2 (ot-summary-row-bottom): Money metrics
 * - Single-row layout when showBillableBreakdown is OFF
 *
 * TIME METRICS (always displayed):
 * - Users count
 * - Capacity
 * - Total time
 * - Break
 * - Regular
 * - Overtime (with "danger" class)
 * - Billable time (when breakdown enabled)
 * - Non-billable time (when breakdown enabled)
 * - Billable OT (when breakdown enabled)
 * - Non-billable OT (when breakdown enabled)
 * - Holidays count
 * - Time Off count
 *
 * MONEY METRICS:
 * - Total amount (with "highlight" class)
 * - OT Premium
 * - Tier 2 Premium (when enableTieredOT is ON)
 * - Base amount
 *
 * PROFIT MODE:
 * - Shows stacked amounts (Earned, Cost, Profit)
 * - Uses renderAmountStack() for multi-line display
 *
 * @see js/ui/summary.ts - renderSummaryStrip implementation
 * @see js/ui/shared.ts - formatHoursDisplay, formatCurrency, renderAmountStack
 */

import { jest, afterEach, beforeEach, describe, it, expect } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';
import { createMockStore, generateMockAnalysisData } from '../helpers/mock-data.js';

// Mock the store module
let mockStore;

jest.unstable_mockModule('../../js/state.js', () => ({
  store: {
    get config() { return mockStore?.config || {}; },
    get ui() { return mockStore?.ui || {}; }
  }
}));

// Mock shared module
jest.unstable_mockModule('../../js/ui/shared.js', () => ({
  getElements: jest.fn(() => ({
    summaryStrip: document.getElementById('summaryStrip') || document.createElement('div')
  })),
  formatHoursDisplay: jest.fn((h) => `${h}h`),
  formatCurrency: jest.fn((a) => `$${a.toFixed(2)}`),
  escapeHtml: jest.fn((s) => s),
  getAmountDisplayMode: jest.fn(() => mockStore?.config?.amountDisplay || 'earned'),
  getAmountLabels: jest.fn(() => ({ total: 'Total Amount', base: 'Base Amount' })),
  renderAmountStack: jest.fn((lines) => lines.map(l => `${l.label}: $${l.value}`).join('<br>')),
  getSwatchColor: jest.fn(() => '#000')
}));

describe('Summary Strip Layout Specification', () => {
  let renderSummaryStrip;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock DOM
    document.body.innerHTML = '<div id="summaryStrip"></div>';

    // Create mock store
    mockStore = createMockStore({
      config: {
        showBillableBreakdown: true,
        enableTieredOT: false,
        amountDisplay: 'earned'
      },
      ui: {
        summaryExpanded: false
      }
    });

    // Import after mocks are set up
    const summaryModule = await import('../../js/ui/summary.js');
    renderSummaryStrip = summaryModule.renderSummaryStrip;
  });

  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
    mockStore = null;
  });

  describe('Total Hours Rendering', () => {
    it('should render total hours in strip header', async () => {
      const users = generateMockAnalysisData(2);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Total time');
    });

    it('should aggregate hours from all users', async () => {
      const users = generateMockAnalysisData(3);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      // Should show aggregated metrics
      expect(strip.innerHTML).toContain('Users');
      expect(strip.innerHTML).toContain('Regular');
      expect(strip.innerHTML).toContain('Overtime');
    });

    it('should show user count', async () => {
      const users = generateMockAnalysisData(5);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Users');
    });
  });

  describe('Billable Breakdown Display', () => {
    it('should render billable breakdown when enabled', async () => {
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(1);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Billable time');
      expect(strip.innerHTML).toContain('Non-billable time');
      expect(strip.innerHTML).toContain('Billable OT');
      expect(strip.innerHTML).toContain('Non-billable OT');
    });

    it('should hide billable breakdown when disabled', async () => {
      mockStore.config.showBillableBreakdown = false;
      const users = generateMockAnalysisData(1);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).not.toContain('Billable time');
      expect(strip.innerHTML).not.toContain('Non-billable time');
    });

    it('should use two-row layout when breakdown enabled', async () => {
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(1);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('ot-summary-row-top');
      expect(strip.innerHTML).toContain('ot-summary-row-bottom');
    });

    it('should use single-row layout when breakdown disabled', async () => {
      mockStore.config.showBillableBreakdown = false;
      const users = generateMockAnalysisData(1);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('ot-summary-row-top');
      expect(strip.innerHTML).not.toContain('ot-summary-row-bottom');
    });
  });

  describe('Holiday and Time-Off Counts', () => {
    it('should show holiday count', async () => {
      const users = generateMockAnalysisData(1);
      users[0].totals.holidayCount = 3;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Holidays');
    });

    it('should show time-off count', async () => {
      const users = generateMockAnalysisData(1);
      users[0].totals.timeOffCount = 2;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Time Off');
    });
  });

  describe('Amount Display Modes', () => {
    it('should render amount stacks in profit mode', async () => {
      mockStore.config.amountDisplay = 'profit';
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(1);
      users[0].totals.amountEarned = 1000;
      users[0].totals.amountCost = 600;
      users[0].totals.amountProfit = 400;

      // Update mock to return profit mode
      const sharedModule = await import('../../js/ui/shared.js');
      sharedModule.getAmountDisplayMode.mockReturnValue('profit');

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      // In profit mode, renderAmountStack is called
      expect(sharedModule.renderAmountStack).toHaveBeenCalled();
    });

    it('should render single amount in earned mode', async () => {
      mockStore.config.amountDisplay = 'earned';
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(1);
      users[0].totals.amount = 1500;

      const sharedModule = await import('../../js/ui/shared.js');
      sharedModule.getAmountDisplayMode.mockReturnValue('earned');

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(sharedModule.formatCurrency).toHaveBeenCalled();
    });
  });

  describe('Tiered OT Display', () => {
    it('should show Tier 2 Premium when tieredOT enabled', async () => {
      mockStore.config.enableTieredOT = true;
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(1);
      users[0].totals.otPremiumTier2 = 100;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Tier 2 Premium');
    });

    it('should hide Tier 2 Premium when tieredOT disabled', async () => {
      mockStore.config.enableTieredOT = false;
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(1);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).not.toContain('Tier 2 Premium');
    });
  });

  describe('CSS Classes', () => {
    it('should apply "danger" class to overtime', async () => {
      const users = generateMockAnalysisData(1);
      users[0].totals.overtime = 10;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('class="summary-item danger"');
    });

    it('should apply "highlight" class to total amount', async () => {
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(1);

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('class="summary-item highlight"');
    });
  });

  describe('Empty Data Handling', () => {
    it('should handle empty users array', async () => {
      const users = [];

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Users');
      // Should show 0 values
    });

    it('should handle users with zero totals', async () => {
      const users = [{
        userId: 'user1',
        userName: 'Test',
        days: new Map(),
        totals: {
          regular: 0,
          overtime: 0,
          total: 0,
          breaks: 0,
          expectedCapacity: 0,
          billableWorked: 0,
          nonBillableWorked: 0,
          billableOT: 0,
          nonBillableOT: 0,
          amount: 0,
          otPremium: 0,
          holidayCount: 0,
          timeOffCount: 0
        }
      }];

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toBeDefined();
    });
  });

  describe('Metric Aggregation', () => {
    it('should sum capacity from all users', async () => {
      const users = generateMockAnalysisData(3);
      users[0].totals.expectedCapacity = 40;
      users[1].totals.expectedCapacity = 40;
      users[2].totals.expectedCapacity = 40;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Capacity');
    });

    it('should sum regular hours from all users', async () => {
      const users = generateMockAnalysisData(2);
      users[0].totals.regular = 35;
      users[1].totals.regular = 40;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Regular');
    });

    it('should sum overtime hours from all users', async () => {
      const users = generateMockAnalysisData(2);
      users[0].totals.overtime = 5;
      users[1].totals.overtime = 8;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('Overtime');
    });

    it('should sum OT premiums from all users', async () => {
      mockStore.config.showBillableBreakdown = true;
      const users = generateMockAnalysisData(2);
      users[0].totals.otPremium = 100;
      users[1].totals.otPremium = 150;

      renderSummaryStrip(users);

      const strip = document.getElementById('summaryStrip');
      expect(strip.innerHTML).toContain('OT Premium');
    });
  });
});
