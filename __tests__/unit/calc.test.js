/**
 * @jest-environment jsdom
 */

import { jest, afterEach } from '@jest/globals';
import { calculateAnalysis } from '../../js/calc.js';
import { IsoUtils } from '../../js/utils.js';
import { generateMockEntries, generateMockUsers, generateMockProfile, generateMockHoliday, createMockStore } from '../helpers/mock-data.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Calculation Module - calculateAnalysis', () => {
  let mockStore;
  let mockUsers;
  let dateRange;

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
    mockUsers = null;
  });

  beforeEach(() => {
    mockUsers = generateMockUsers(3);
    mockStore = createMockStore({
      users: mockUsers,
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: true,
        applyTimeOff: true,
        showBillableBreakdown: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5
      },
      overrides: {}
    });
    dateRange = { start: '2025-01-01', end: '2025-01-31' };
  });

  describe('Basic Calculation', () => {
    it('should calculate totals for single entry within capacity', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'Alice Johnson',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      expect(results).toHaveLength(3); // All users
      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.billableWorked).toBe(8);
    });

    it('should calculate overtime for entry exceeding capacity', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(10);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.billableOT).toBe(2);
    });

    it('should handle multiple entries on same day', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T12:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T13:00:00Z',
            end: '2025-01-15T18:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(0);
    });

    it('should split overtime across entries', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T14:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(9);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(1);
    });
  });

  describe('Profile Capacity', () => {
    it('should use profile capacity when enabled', () => {
      const profile = generateMockProfile('user0', 7);
      mockStore.profiles.set('user0', {
        workCapacityHours: 7,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z', // Wednesday
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(7);
      expect(userResult.totals.overtime).toBe(1);
      // Expected capacity across date range (7 hours * working days in Jan)
      expect(userResult.totals.expectedCapacity).toBeGreaterThan(0);
    });

    it('should fall back to global threshold when profile not available', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(8); // Global threshold
      expect(userResult.totals.overtime).toBe(2);
    });

    it('should use user override over profile', () => {
      mockStore.overrides = {
        'user0': { capacity: 6 }
      };

      const profile = generateMockProfile('user0', 7);
      mockStore.profiles.set('user0', {
        workCapacityHours: 7,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(6); // Override takes precedence
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Working Days', () => {
    it('should treat non-working days as capacity 0', () => {
      mockStore.profiles.set('user0', {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] // No weekends
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-18T09:00:00Z', // Saturday
          end: '2025-01-18T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
      // Capacity is calculated across ALL days in range, only Jan 18 (Sat) has 0 capacity
      // Jan 2025 has 23 working days (Mon-Fri) = 184 hours capacity
      expect(userResult.totals.expectedCapacity).toBe(184);
    });

    it('should respect working days from profile', () => {
      mockStore.profiles.set('user0', {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'WEDNESDAY', 'FRIDAY'] // 3 days only
      });

      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z', // Wednesday
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-14T09:00:00Z', // Tuesday (not in working days)
            end: '2025-01-14T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Wednesday entry
      const wednesdayDay = Array.from(userResult.days.values()).find(d =>
        Array.from(d.entries.values()).some(e => e.timeInterval.start.includes('2025-01-15'))
      );
      // Tuesday entry
      const tuesdayDay = Array.from(userResult.days.values()).find(d =>
        Array.from(d.entries.values()).some(e => e.timeInterval.start.includes('2025-01-14'))
      );

      expect(userResult.totals.overtime).toBe(8); // Tuesday work is all overtime
    });
  });

  describe('Holidays', () => {
    it('should treat holidays as capacity 0', () => {
      const holiday = generateMockHoliday('user0', '2025-01-01', 'New Year');
      const holidayMap = new Map();
      holidayMap.set('2025-01-01', holiday);
      mockStore.holidays.set('user0', holidayMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-01T09:00:00Z', // Holiday
          end: '2025-01-01T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
      // Capacity is calculated across ALL days, only Jan 1 has 0 capacity due to holiday
      // But Note: Jan 1, 2025 is a Wednesday (working day), so it has capacity
      // After holiday applied: 0 capacity for Jan 1
      // Total capacity = (23 working days - 1 holiday) * 8 = 176
      expect(userResult.totals.expectedCapacity).toBe(176);
      expect(userResult.totals.holidayCount).toBe(1);
    });

    it('should prioritize holidays over working days', () => {
      const holiday = generateMockHoliday('user0', '2025-01-15', 'Special Day');
      const holidayMap = new Map();
      holidayMap.set('2025-01-15', holiday);
      mockStore.holidays.set('user0', holidayMap);

      mockStore.profiles.set('user0', {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      });

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z', // Wednesday but also holiday
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0); // Holiday takes precedence
      expect(userResult.totals.overtime).toBe(8);
    });
  });

  describe('Time Off', () => {
    it('should reduce capacity for partial time off', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: false, hours: 4 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Effective capacity = 8 - 4 = 4
      expect(userResult.totals.regular).toBe(4);
      expect(userResult.totals.overtime).toBe(4);
      expect(userResult.totals.timeOffCount).toBe(1);
    });

    it('should set capacity to 0 for full day time off', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
    });
  });

  describe('Billable Breakdown', () => {
    it('should separate billable and non-billable hours', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T14:00:00Z',
            end: '2025-01-15T16:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.total).toBe(6);
      expect(userResult.totals.billableWorked).toBe(4);
      expect(userResult.totals.nonBillableWorked).toBe(2);
    });

    it('should split billable overtime correctly', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T18:00:00Z',
            end: '2025-01-15T20:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: false // Non-billable overtime
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.billableOT).toBe(0); // No billable overtime
      expect(userResult.totals.nonBillableOT).toBe(2); // All non-billable
    });
  });

  describe('Cost Calculation', () => {
    it('should calculate base amount and overtime premium', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour
        costRate: { amount: 3000 }, // $30/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Base cost: 10 hours * $50 = $500
      // OT Premium: 2 hours * $50 * (1.5 - 1) = $50
      // Total: $550
      expect(userResult.totals.amount).toBe(550);
      expect(userResult.totals.otPremium).toBe(50);
    });

    it('should use cost rate when amount display is cost', () => {
      mockStore.config.amountDisplay = 'cost';

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 4000 }, // $40/hour billable
        costRate: { amount: 2500 }, // $25/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(200);
      expect(userResult.totals.otPremium).toBe(0);
    });

    it('should not fall back to earned rate when cost rate is missing', () => {
      mockStore.config.amountDisplay = 'cost';

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T11:00:00Z',
          duration: 'PT2H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour earned
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(0);
      expect(userResult.totals.profit).toBe(100);
    });

    it('should calculate profit from earned minus cost', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour earned
        costRate: { amount: 3000 }, // $30/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.profit).toBe(220);
      const day = userResult.days.get('2025-01-15');
      expect(day.entries[0].analysis.profit).toBe(220);
    });

    it('should use profit amounts when amount display is profit', () => {
      mockStore.config.amountDisplay = 'profit';

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour earned
        costRate: { amount: 3000 }, // $30/hour cost
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(160);
      expect(userResult.totals.amountEarned).toBe(400);
      expect(userResult.totals.amountCost).toBe(240);
      expect(userResult.totals.amountProfit).toBe(160);
      const day = userResult.days.get('2025-01-15');
      expect(day.entries[0].analysis.hourlyRate).toBe(20);
      expect(day.entries[0].analysis.totalAmountWithOT).toBe(160);
      expect(day.entries[0].analysis.amounts.earned.totalAmountWithOT).toBe(400);
      expect(day.entries[0].analysis.amounts.cost.totalAmountWithOT).toBe(240);
      expect(day.entries[0].analysis.amounts.profit.totalAmountWithOT).toBe(160);
    });

    it('should use earnedRate and costRate (cents) when provided', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T11:00:00Z',
          duration: 'PT2H'
        },
        earnedRate: 6000, // $60/hour in cents
        costRate: 2500, // $25/hour in cents
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(120);
      expect(userResult.totals.profit).toBe(70);
    });

    it('should derive earned rate from amounts when rates are missing', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T13:00:00Z',
          duration: 'PT4H'
        },
        amounts: [{ type: 'EARNED', amount: 200 }]
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.amount).toBe(200);
      const day = userResult.days.get('2025-01-15');
      expect(day.entries[0].analysis.amounts.earned.rate).toBe(50);
      expect(day.entries[0].analysis.amounts.profit.totalAmountWithOT).toBe(200);
    });

    it('should use user override multiplier', () => {
      mockStore.overrides = {
        'user0': { multiplier: 2.0 }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 }, // $50/hour
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Base cost: 10 hours * $50 = $500
      // OT Premium: 2 hours * $50 * (2.0 - 1) = $100
      // Total: $600
      expect(userResult.totals.amount).toBe(600);
      expect(userResult.totals.otPremium).toBe(100);
    });
  });

  describe('Users Without Entries', () => {
    it('should include users with no entries in results', () => {
      const entries = [];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      expect(results).toHaveLength(3); // All users included
      results.forEach(user => {
        expect(user.totals.total).toBe(0);
        expect(user.totals.expectedCapacity).toBeGreaterThan(0);
      });
    });

    it('should calculate expected capacity for users without entries', () => {
      const dateRange = { start: '2025-01-01', end: '2025-01-31' }; // 31 days

      const results = calculateAnalysis([], mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      // Expected capacity considers working days (Mon-Fri)
      // January 2025 has 23 working days (Mon-Fri)
      // 23 days * 8 hours = 184 hours
      expect(userResult.totals.expectedCapacity).toBe(184);
    });
  });

  describe('Multi-Day Time Off', () => {
    it('should handle multi-day time off', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user0', timeOffMap);

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const userResult = results.find(u => u.userId === 'user0');
      expect(userResult.totals.timeOffCount).toBe(1);
    });
  });

  describe('Per-Day Override Calculations', () => {
    let mockStore;
    let dateRange;

    beforeEach(() => {
      mockStore = {
        users: [{ id: 'user0', name: 'User 0' }],
        overrides: {},
        profiles: new Map(),
        holidays: new Map(),
        timeOff: new Map(),
        config: {
          useProfileCapacity: false,
          useProfileWorkingDays: false,
          applyHolidays: false,
          applyTimeOff: false
        },
        calcParams: {
          dailyThreshold: 8,
          overtimeMultiplier: 1.5
        }
      };

      dateRange = {
        start: '2025-01-15',
        end: '2025-01-15'
      };
    });

    it('should use per-day capacity override over global', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          capacity: 8,  // Global fallback
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Specific day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T15:00:00Z',
          duration: 'PT6H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use per-day capacity of 4, not global 8
      expect(dayData.meta.capacity).toBe(4);
      // 6 hours of work with 4 hour capacity = 4 regular + 2 OT
      expect(results[0].totals.regular).toBe(4);
      expect(results[0].totals.overtime).toBe(2);
    });

    it('should use per-day multiplier in OT calculations', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          multiplier: 1.5,  // Global fallback
          perDayOverrides: {
            '2025-01-15': { multiplier: 3.0 }  // Triple OT on this day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // 2 hours OT * $50 * 3.0 multiplier = $300 total
      // Premium = (3.0 - 1) * 2 * 50 = $200
      expect(results[0].totals.overtime).toBe(2);
      expect(results[0].totals.otPremium).toBe(200);
    });

    it('should fall back to global override when per-day not set', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          capacity: 6,  // Global fallback
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Only one day specified
          }
        }
      };

      dateRange = {
        start: '2025-01-15',
        end: '2025-01-16'
      };

      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T15:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-16T09:00:00Z',
            end: '2025-01-16T15:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      const day15 = results[0].days.get('2025-01-15');
      const day16 = results[0].days.get('2025-01-16');

      expect(day15.meta.capacity).toBe(4);  // Per-day override
      expect(day16.meta.capacity).toBe(6);  // Falls back to global
    });

    it('should use global mode when mode is not perDay', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'global',
          capacity: 7,
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Should be ignored in global mode
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use global capacity of 7, not per-day 4
      expect(dayData.meta.capacity).toBe(7);
      expect(results[0].totals.regular).toBe(7);
      expect(results[0].totals.overtime).toBe(1);
    });

    it('should handle missing mode as global by default', () => {
      mockStore.overrides = {
        'user0': {
          capacity: 7,
          // No mode field - should default to global behavior
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use global capacity of 7 (backward compatibility)
      expect(dayData.meta.capacity).toBe(7);
    });

    it('should combine per-day capacity and multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': {
              capacity: 6,
              multiplier: 2.0
            }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // 6 hour capacity, so 4 hours OT
      expect(results[0].totals.regular).toBe(6);
      expect(results[0].totals.overtime).toBe(4);
      // Premium = (2.0 - 1) * 4 * 50 = $200
      expect(results[0].totals.otPremium).toBe(200);
    });
  });

  /**
   * Override Mode Interaction Matrix Specification
   *
   * SPECIFICATION:
   * Tests various combinations of override modes and settings to ensure
   * the precedence rules are correctly applied:
   *
   * 1. Per-day capacity + weekly multiplier: multiplier applies
   * 2. Per-day multiplier + global capacity: capacity from global
   * 3. Per-day tier2Threshold + global tier2Multiplier
   * 4. Invalid/undefined override mode defaults to global
   * 5. Weekly override mode behavior
   *
   * @see docs/prd.md - Capacity Precedence section
   */
  describe('Override Mode Interaction Matrix', () => {
    let mockStore;
    let dateRange;

    beforeEach(() => {
      mockStore = {
        users: [{ id: 'user0', name: 'User 0' }],
        overrides: {},
        profiles: new Map(),
        holidays: new Map(),
        timeOff: new Map(),
        config: {
          useProfileCapacity: false,
          useProfileWorkingDays: false,
          applyHolidays: false,
          applyTimeOff: false,
          enableTieredOT: true
        },
        calcParams: {
          dailyThreshold: 8,
          overtimeMultiplier: 1.5,
          tier2ThresholdHours: 4,
          tier2Multiplier: 2.0
        }
      };

      dateRange = { start: '2025-01-15', end: '2025-01-15' };
    });

    it('per-day capacity + global multiplier: uses per-day capacity, global multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          multiplier: 2.0,  // Global multiplier
          perDayOverrides: {
            '2025-01-15': { capacity: 4 }  // Only capacity specified for day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T15:00:00Z',
          duration: 'PT6H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // Should use per-day capacity of 4
      expect(results[0].totals.regular).toBe(4);
      expect(results[0].totals.overtime).toBe(2);
      // Should use global multiplier of 2.0 for OT premium
      // Premium = (2.0 - 1) * 2 * 50 = $100
      expect(results[0].totals.otPremium).toBe(100);
    });

    it('per-day multiplier + global capacity: uses global capacity, per-day multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          capacity: 6,  // Global capacity
          perDayOverrides: {
            '2025-01-15': { multiplier: 3.0 }  // Only multiplier specified for day
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // Should use global capacity of 6 (per-day doesn't override it)
      expect(results[0].totals.regular).toBe(6);
      expect(results[0].totals.overtime).toBe(2);
      // Should use per-day multiplier of 3.0
      // Premium = (3.0 - 1) * 2 * 50 = $200
      expect(results[0].totals.otPremium).toBe(200);
    });

    it('per-day tier2Threshold + global tier2Multiplier', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': {
              capacity: 4,
              tier2ThresholdHours: 2  // Lower threshold for more tier2 hours
            }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // 4h capacity, 6h OT
      expect(results[0].totals.overtime).toBe(6);
    });

    it('invalid mode value defaults to global behavior', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'invalidMode',  // Invalid mode
          capacity: 5,
          perDayOverrides: {
            '2025-01-15': { capacity: 3 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Invalid mode should fall back to global, using capacity 5
      expect(dayData.meta.capacity).toBe(5);
    });

    it('weekly override mode with weekday-specific capacity', () => {
      // 2025-01-15 is a Wednesday
      mockStore.overrides = {
        'user0': {
          mode: 'weekly',
          weeklyOverrides: {
            WEDNESDAY: { capacity: 6, multiplier: 2.0 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Should use weekly override for Wednesday
      expect(dayData.meta.capacity).toBe(6);
      expect(results[0].totals.overtime).toBe(2);
      // Premium with 2.0 multiplier
      expect(results[0].totals.otPremium).toBe(100);
    });

    it('weekly override falls back to global when weekday not specified', () => {
      // 2025-01-15 is a Wednesday, but we only define Monday
      mockStore.overrides = {
        'user0': {
          mode: 'weekly',
          capacity: 7,  // Global fallback
          weeklyOverrides: {
            MONDAY: { capacity: 6 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // Wednesday not in weeklyOverrides, should fall back to global capacity 7
      expect(dayData.meta.capacity).toBe(7);
    });

    it('perDay mode takes precedence over weekly override', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          weeklyOverrides: {
            WEDNESDAY: { capacity: 5 }  // Should be ignored
          },
          perDayOverrides: {
            '2025-01-15': { capacity: 3 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const dayData = results[0].days.get('2025-01-15');

      // perDay mode should use perDayOverrides, not weeklyOverrides
      expect(dayData.meta.capacity).toBe(3);
      expect(results[0].totals.overtime).toBe(5);
    });

    it('zero capacity override makes all hours OT', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': { capacity: 0 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // All 8 hours should be OT
      expect(results[0].totals.regular).toBe(0);
      expect(results[0].totals.overtime).toBe(8);
    });

    it('multiplier of 1.0 results in zero OT premium', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          perDayOverrides: {
            '2025-01-15': { capacity: 4, multiplier: 1.0 }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T15:00:00Z',
          duration: 'PT6H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      expect(results[0].totals.overtime).toBe(2);
      // Premium = (1.0 - 1) * 2 * 50 = $0
      expect(results[0].totals.otPremium).toBe(0);
    });
  });
});

// ============================================================================
// MUTATION TESTING - NaN Checks and Edge Cases (B2, B3, B4, B5, B6, B7)
// ============================================================================
// These tests are specifically designed to kill surviving mutants in calc.ts
// by testing edge cases around NaN handling, boundary conditions, and
// mutation-prone comparison operators.
// ============================================================================

describe('Calculation Module - Mutation Test Coverage', () => {
  let mockStore;
  let dateRange;

  beforeEach(() => {
    mockStore = {
      users: [{ id: 'user0', name: 'User 0' }],
      overrides: {},
      profiles: new Map(),
      holidays: new Map(),
      timeOff: new Map(),
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: true,
        applyTimeOff: true,
        showBillableBreakdown: true,
        enableTieredOT: true,
        overtimeBasis: 'daily'
      },
      calcParams: {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 4,
        tier2Multiplier: 2.0
      }
    };
    dateRange = { start: '2025-01-15', end: '2025-01-15' };
  });

  afterEach(() => {
    standardAfterEach();
    mockStore = null;
  });

  describe('B2: NaN Checks in Override Resolution', () => {
    it('should fall back to global when perDay capacity is NaN-producing string', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          capacity: 6, // Fallback
          perDayOverrides: {
            '2025-01-15': { capacity: 'not-a-number' } // Invalid
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      // Should use fallback capacity of 6
      expect(results[0].totals.regular).toBe(6);
      expect(results[0].totals.overtime).toBe(2);
    });

    it('should fall back to global when weekly capacity is NaN-producing string', () => {
      // 2025-01-15 is Wednesday
      mockStore.overrides = {
        'user0': {
          mode: 'weekly',
          capacity: 7, // Fallback
          weeklyOverrides: {
            WEDNESDAY: { capacity: 'invalid' } // Invalid
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      // Should use fallback capacity of 7
      expect(results[0].totals.regular).toBe(7);
      expect(results[0].totals.overtime).toBe(1);
    });

    it('should fall back to global when perDay multiplier is empty string', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          multiplier: 2.0, // Fallback
          perDayOverrides: {
            '2025-01-15': { multiplier: '' } // Empty string produces NaN
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      // Should use fallback multiplier of 2.0
      // Premium = (2.0 - 1) * 2h * $50 = $100
      expect(results[0].totals.otPremium).toBe(100);
    });

    it('should fall back to global when weekly multiplier is undefined', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'weekly',
          multiplier: 2.5, // Fallback
          weeklyOverrides: {
            WEDNESDAY: { multiplier: undefined }
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      // Should use fallback multiplier of 2.5
      // Premium = (2.5 - 1) * 2h * $50 = $150
      expect(results[0].totals.otPremium).toBe(150);
    });

    it('should fall back to global when tier2Threshold is NaN-producing', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          tier2Threshold: '2', // Fallback
          perDayOverrides: {
            '2025-01-15': { tier2Threshold: 'abc' } // Invalid
          }
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      // Should use fallback tier2Threshold of 2
      // 2h OT, tier2 kicks in at 2h cumulative OT, so 0h tier2 here
      expect(results[0].totals.overtime).toBe(2);
    });

    it('should fall back to global when tier2Multiplier is NaN-producing', () => {
      mockStore.overrides = {
        'user0': {
          mode: 'perDay',
          tier2Multiplier: '3.0', // Fallback
          perDayOverrides: {
            '2025-01-15': { tier2Multiplier: 'xyz' } // Invalid
          }
        }
      };
      mockStore.calcParams.tier2ThresholdHours = 0; // All OT gets tier2

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      // Should use fallback tier2Multiplier of 3.0
      // Tier2 premium = (3.0 - 1.5) * 2h * $50 = $150
      expect(results[0].totals.otPremiumTier2).toBe(150);
    });

    it('should use global override capacity when value is NaN string', () => {
      mockStore.overrides = {
        'user0': {
          capacity: 'not-a-number' // Global override but invalid
        }
      };

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      // Invalid global override, should fall back to dailyThreshold (8)
      expect(results[0].totals.regular).toBe(8);
      expect(results[0].totals.overtime).toBe(0);
    });
  });

  describe('B3: Holiday/Time-Off Dual-Source Detection', () => {
    it('should detect holiday from entry type when applyHolidays is disabled', () => {
      mockStore.config.applyHolidays = false;

      const entries = [
        {
          id: 'holiday_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY', // Use HOLIDAY type for fallback detection
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 0 },
          billable: false
        },
        {
          id: 'work_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T17:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Holiday from entry type should set capacity to 0
      // All WORK is overtime
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.regular).toBe(8); // PTO counts as regular
    });

    it('should detect time-off from entry type when applyTimeOff is disabled', () => {
      mockStore.config.applyTimeOff = false;
      // Disable profile working days to avoid non-working day detection
      mockStore.config.useProfileWorkingDays = false;

      const entries = [
        {
          id: 'timeoff_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF', // TIME_OFF type triggers fallback detection
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 0 },
          billable: false
        },
        {
          id: 'work_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-15T13:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Time-off from entry type should reduce capacity by 4h (8 - 4 = 4)
      // WORK 6h with 4h capacity = 4h regular + 2h OT
      expect(userResult.totals.overtime).toBe(2);
    });

    it('should use API holiday data when applyHolidays is enabled', () => {
      mockStore.config.applyHolidays = true;
      mockStore.holidays.set('user0', new Map([
        ['2025-01-15', { name: 'API Holiday' }]
      ]));

      // Entry has no holiday type, but API says it's holiday
      const entries = [{
        id: 'work_entry',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // API holiday sets capacity to 0, all WORK is OT
      expect(userResult.totals.overtime).toBe(8);
      expect(userResult.totals.regular).toBe(0);
    });
  });

  describe('B4: Tier2 OT Boundary Conditions', () => {
    it('should handle OT exactly at tier2 threshold (edge case: >=)', () => {
      mockStore.calcParams.tier2ThresholdHours = 2;

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H' // 8 regular + 2 OT
        },
        hourlyRate: { amount: 10000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 2 OT hours, threshold is 2
      // First 2h reach threshold exactly, no tier2 hours
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.otPremium).toBe(100); // 2 * $100 * 0.5
      expect(userResult.totals.otPremiumTier2).toBe(0); // No tier2 yet
    });

    it('should handle OT at exactly one hour above threshold', () => {
      mockStore.calcParams.tier2ThresholdHours = 2;

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T20:00:00Z',
          duration: 'PT11H' // 8 regular + 3 OT
        },
        hourlyRate: { amount: 10000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 3 OT hours, threshold is 2
      // 2h tier1, 1h tier2
      expect(userResult.totals.overtime).toBe(3);
      expect(userResult.totals.otPremium).toBe(150); // 3 * $100 * 0.5
      expect(userResult.totals.otPremiumTier2).toBe(50); // 1 * $100 * 0.5
    });

    it('should handle case where all OT is tier2 (accumulator already past threshold)', () => {
      mockStore.calcParams.tier2ThresholdHours = 2;
      dateRange = { start: '2025-01-15', end: '2025-01-16' };

      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T20:00:00Z',
            duration: 'PT11H' // 8 regular + 3 OT (cumulative OT: 3, past threshold of 2)
          },
          hourlyRate: { amount: 10000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-16T09:00:00Z',
            end: '2025-01-16T19:00:00Z',
            duration: 'PT10H' // 8 regular + 2 OT (cumulative OT: 5, all tier2)
          },
          hourlyRate: { amount: 10000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Day 1: 3 OT (2h tier1, 1h tier2)
      // Day 2: 2 OT (all tier2 because cumulative already at 3)
      // Total: 5 OT, 3h tier2
      expect(userResult.totals.overtime).toBe(5);
      expect(userResult.totals.otPremium).toBe(250); // 5 * $100 * 0.5
      expect(userResult.totals.otPremiumTier2).toBe(150); // 3 * $100 * 0.5
    });

    it('should handle tier2 when entry exactly fills remaining tier1 capacity', () => {
      mockStore.calcParams.tier2ThresholdHours = 4;
      dateRange = { start: '2025-01-15', end: '2025-01-16' };

      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T19:00:00Z',
            duration: 'PT10H' // 8 regular + 2 OT (cumulative: 2)
          },
          hourlyRate: { amount: 10000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-16T09:00:00Z',
            end: '2025-01-16T19:00:00Z',
            duration: 'PT10H' // 8 regular + 2 OT (cumulative: 4, exactly at threshold)
          },
          hourlyRate: { amount: 10000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Total: 4 OT, all tier1 (cumulative exactly at threshold, not past it)
      expect(userResult.totals.overtime).toBe(4);
      expect(userResult.totals.otPremium).toBe(200); // 4 * $100 * 0.5
      expect(userResult.totals.otPremiumTier2).toBe(0);
    });
  });

  describe('B5: Entry Classification and Tags', () => {
    it('should set isBreak true for BREAK entries', () => {
      const entries = [{
        id: 'break_1',
        userId: 'user0',
        userName: 'User 0',
        type: 'BREAK',
        timeInterval: {
          start: '2025-01-15T12:00:00Z',
          end: '2025-01-15T13:00:00Z',
          duration: 'PT1H'
        },
        hourlyRate: { amount: 0 },
        billable: false
      }];

      calculateAnalysis(entries, mockStore, dateRange);

      expect(entries[0].analysis.isBreak).toBe(true);
      expect(entries[0].analysis.tags).toContain('BREAK');
    });

    it('should set isBreak false for WORK entries', () => {
      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      calculateAnalysis(entries, mockStore, dateRange);

      expect(entries[0].analysis.isBreak).toBe(false);
      expect(entries[0].analysis.tags).not.toContain('BREAK');
    });

    it('should add HOLIDAY tag when day is holiday', () => {
      mockStore.holidays.set('user0', new Map([
        ['2025-01-15', { name: 'Test Holiday' }]
      ]));

      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      calculateAnalysis(entries, mockStore, dateRange);

      expect(entries[0].analysis.tags).toContain('HOLIDAY');
    });

    it('should add OFF-DAY tag when day is non-working', () => {
      mockStore.profiles.set('user0', {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'TUESDAY', 'THURSDAY', 'FRIDAY'] // No Wednesday
      });

      // 2025-01-15 is Wednesday
      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      calculateAnalysis(entries, mockStore, dateRange);

      expect(entries[0].analysis.tags).toContain('OFF-DAY');
    });

    it('should add TIME-OFF tag when day has time-off', () => {
      mockStore.timeOff.set('user0', new Map([
        ['2025-01-15', { isFullDay: false, hours: 4 }]
      ]));

      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T13:00:00Z',
          duration: 'PT4H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      calculateAnalysis(entries, mockStore, dateRange);

      expect(entries[0].analysis.tags).toContain('TIME-OFF');
    });

    it('should initialize tags as empty array', () => {
      // Regular working day with no special context
      mockStore.config.applyHolidays = false;
      mockStore.config.applyTimeOff = false;
      mockStore.config.useProfileWorkingDays = false;

      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        type: 'REGULAR',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      calculateAnalysis(entries, mockStore, dateRange);

      expect(entries[0].analysis.tags).toBeDefined();
      expect(Array.isArray(entries[0].analysis.tags)).toBe(true);
      expect(entries[0].analysis.tags.length).toBe(0);
    });
  });

  describe('B6: Billable Accumulation', () => {
    it('should accumulate billable worked hours for billable entry', () => {
      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.billableWorked).toBe(8);
      expect(userResult.totals.nonBillableWorked).toBe(0);
    });

    it('should accumulate non-billable worked hours for non-billable entry', () => {
      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: false
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.billableWorked).toBe(0);
      expect(userResult.totals.nonBillableWorked).toBe(8);
    });

    it('should accumulate billable OT hours for billable overtime entry', () => {
      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.billableOT).toBe(2);
      expect(userResult.totals.nonBillableOT).toBe(0);
    });

    it('should accumulate non-billable OT hours for non-billable overtime entry', () => {
      const entries = [{
        id: 'work_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: false
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.billableOT).toBe(0);
      expect(userResult.totals.nonBillableOT).toBe(2);
    });

    it('should correctly split billable vs non-billable for mixed entries', () => {
      const entries = [
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'work_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T14:00:00Z',
            end: '2025-01-15T18:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_3',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T19:00:00Z',
            end: '2025-01-15T21:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 4h billable + 4h non-billable regular, 2h billable OT
      expect(userResult.totals.billableWorked).toBe(4);
      expect(userResult.totals.nonBillableWorked).toBe(4);
      expect(userResult.totals.billableOT).toBe(2);
      expect(userResult.totals.nonBillableOT).toBe(0);
    });

    it('should accumulate break hours to billable or non-billable based on flag', () => {
      const entries = [
        {
          id: 'break_billable',
          userId: 'user0',
          userName: 'User 0',
          type: 'BREAK',
          timeInterval: {
            start: '2025-01-15T12:00:00Z',
            end: '2025-01-15T12:30:00Z',
            duration: 'PT0H30M'
          },
          hourlyRate: { amount: 0 },
          billable: true
        },
        {
          id: 'break_non_billable',
          userId: 'user0',
          userName: 'User 0',
          type: 'BREAK',
          timeInterval: {
            start: '2025-01-15T13:00:00Z',
            end: '2025-01-15T13:30:00Z',
            duration: 'PT0H30M'
          },
          hourlyRate: { amount: 0 },
          billable: false
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.breaks).toBe(1); // 0.5 + 0.5
      expect(userResult.totals.billableWorked).toBe(0.5);
      expect(userResult.totals.nonBillableWorked).toBe(0.5);
    });
  });

  describe('B7: Amount Accumulation', () => {
    it('should accumulate amounts correctly (verify += not -=)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 }, // $50/hr
          costRate: { amount: 3000 }, // $30/hr
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T14:00:00Z',
            end: '2025-01-15T18:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          costRate: { amount: 3000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Total: 8h * $50 = $400 earned
      expect(userResult.totals.amountEarned).toBe(400);
      // Total: 8h * $30 = $240 cost
      expect(userResult.totals.amountCost).toBe(240);
      // Profit: $400 - $240 = $160
      expect(userResult.totals.amountProfit).toBe(160);
    });

    it('should accumulate tier1 premiums correctly', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 }, // $50/hr
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // 8h regular + 2h OT
      // Tier1 premium: 2h * $50 * 0.5 = $50
      expect(userResult.totals.otPremium).toBe(50);
      expect(userResult.totals.otPremiumEarned).toBe(50);
    });

    it('should accumulate tier2 premiums correctly', () => {
      mockStore.calcParams.tier2ThresholdHours = 0; // All OT is tier2

      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Tier2 premium: 2h * $50 * (2.0 - 1.5) = $50
      expect(userResult.totals.otPremiumTier2).toBe(50);
      expect(userResult.totals.otPremiumTier2Earned).toBe(50);
    });

    it('should accumulate base amounts correctly', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 10000 }, // $100/hr
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Base amount: 10h * $100 = $1000
      expect(userResult.totals.amountEarnedBase).toBe(1000);
    });

    it('should have positive totals after accumulation (not negative from -=)', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T11:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          costRate: { amount: 3000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user0',
          userName: 'User 0',
          timeInterval: {
            start: '2025-01-15T11:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          costRate: { amount: 3000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // All amounts should be positive (not negative from subtraction)
      expect(userResult.totals.amount).toBeGreaterThan(0);
      expect(userResult.totals.amountEarned).toBeGreaterThan(0);
      expect(userResult.totals.amountCost).toBeGreaterThan(0);
      expect(userResult.totals.amountProfit).toBeGreaterThan(0);
    });
  });

  describe('B1: Rate Field Extraction Edge Cases', () => {
    it('should handle rate as plain number (not object)', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: 5000, // Plain number, not { amount: 5000 }
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should extract rate from plain number
      expect(userResult.totals.amountEarned).toBe(400); // 8h * $50
    });

    it('should handle rate as string (graceful fallback to 0)', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: '5000', // String - not a valid rate format
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // String hourlyRate is not valid, should gracefully fall back to 0
      expect(userResult.totals.amountEarned).toBe(0);
    });

    it('should handle rate object without amount key', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { value: 5000 }, // Wrong key
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // No valid rate, should be 0
      expect(userResult.totals.amountEarned).toBe(0);
    });

    it('should handle null hourlyRate', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: null,
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should not crash, amount should be 0
      expect(userResult.totals.amountEarned).toBe(0);
    });

    it('should extract earnedRate from flat number', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        earnedRate: 6000, // Flat number in cents
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // earnedRate 6000 cents = $60/hr, 8h = $480
      expect(userResult.totals.amountEarned).toBe(480);
    });

    it('should extract earnedRate from object', () => {
      const entries = [{
        id: 'entry_1',
        userId: 'user0',
        userName: 'User 0',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        earnedRate: { amount: 6000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.amountEarned).toBe(480);
    });
  });
});
