/**
 * @jest-environment jsdom
 */

import { calculateAnalysis } from '../../js/calc.js';
import { IsoUtils } from '../../js/utils.js';
import { generateMockEntries, generateMockUsers, generateMockProfile, generateMockHoliday, createMockStore } from '../helpers/mock-data.js';

describe('Calculation Module - calculateAnalysis', () => {
  let mockStore;
  let mockUsers;
  let dateRange;

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
});
