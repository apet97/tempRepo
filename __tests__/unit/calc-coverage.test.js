/**
 * @jest-environment jsdom
 */

import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';

describe('calc.js - Edge Cases & Full Coverage', () => {
  let mockStore;
  let dateRange;

  beforeEach(() => {
    mockStore = createMockStore({
      users: [{ id: 'user1', name: 'Alice' }],
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
      overrides: {},
      profiles: new Map(),
      holidays: new Map(),
      timeOff: new Map()
    });
    dateRange = { start: '2025-01-01', end: '2025-01-31' };
  });

  describe('calculateDuration edge cases', () => {
    it('should return 0 when both duration and timeInterval are missing', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice'
        // No timeInterval or duration
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Entry with no duration should contribute 0 to totals
      expect(userResult.totals.total).toBe(0);
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(0);
    });

    it('should handle entries with only start time (no end or duration)', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z'
          // No end time
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Should return 0 when end time is missing
      expect(userResult.totals.total).toBe(0);
    });

    it('should handle entries with malformed duration strings', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'INVALID_DURATION_STRING'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Falls back to start/end diff: 8 hours
      expect(userResult.totals.total).toBe(8);
    });

    it('should handle entries that span exactly 24 hours', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T00:00:00Z',
          end: '2025-01-16T00:00:00Z',
          duration: 'PT24H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // 24 hours total, 8 regular, 16 overtime
      expect(userResult.totals.total).toBe(24);
      expect(userResult.totals.regular).toBe(8);
      expect(userResult.totals.overtime).toBe(16);
    });
  });

  describe('User initialization fallback', () => {
    it('should handle entries from users not in the users list', () => {
      // Entry from user2, but only user1 is in the users list
      const entries = [{
        id: 'entry1',
        userId: 'user2',
        userName: 'Bob',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // Should create a new user entry for user2
      expect(results).toHaveLength(2);
      const newUser = results.find(u => u.userId === 'user2');
      expect(newUser).toBeDefined();
      expect(newUser.userName).toBe('Bob');
      expect(newUser.totals.total).toBe(8);
    });

    it('should handle entries with null/undefined userName', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user2',
        // No userName
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const newUser = results.find(u => u.userId === 'user2');

      expect(newUser.userName).toBe('Unknown'); // Falls back to 'Unknown'
      expect(newUser.totals.total).toBe(8);
    });
  });

  describe('Break entry handling', () => {
    it('should handle BREAK type entries', () => {
      const entries = [
        {
          id: 'entry1',
          userId: 'user1',
          userName: 'Alice',
          type: 'BREAK',
          timeInterval: {
            start: '2025-01-15T12:00:00Z',
            end: '2025-01-15T13:00:00Z',
            duration: 'PT1H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'entry2',
          userId: 'user1',
          userName: 'Alice',
          type: 'TIME',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // BREAK entries should be counted in breaks AND regular hours
      expect(userResult.totals.total).toBe(9); // 1h break + 8h work
      expect(userResult.totals.breaks).toBe(1); // Break time
      expect(userResult.totals.regular).toBe(9); // 1h BREAK + 8h WORK
      expect(userResult.totals.overtime).toBe(0);
    });

    it('should count billable break time as regular billable hours', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        type: 'BREAK',
        timeInterval: {
          start: '2025-01-15T12:00:00Z',
          end: '2025-01-15T13:00:00Z',
          duration: 'PT1H'
        },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Break entries should count as regular hours (never overtime)
      expect(userResult.totals.billableWorked).toBe(1);
      expect(userResult.totals.billableOT).toBe(0);
      expect(userResult.totals.total).toBe(1);
    });
  });

  describe('Zero capacity edge cases', () => {
    it('should handle capacity reduced to 0 by time off', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: false, hours: 8 });
      mockStore.timeOff.set('user1', timeOffMap);

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Effective capacity = 8 - 8 = 0, so all time is overtime
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
    });

    it('should handle capacity reduced below 0 (should clamp to 0)', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: false, hours: 10 }); // More than capacity
      mockStore.timeOff.set('user1', timeOffMap);

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Capacity should clamp to 0, not negative
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
    });
  });

  describe('Date range edge cases', () => {
    it('should handle empty date range', () => {
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

      const results = calculateAnalysis(entries, mockStore, {}); // Empty date range
      const userResult = results.find(u => u.userId === 'user1');

      // Should still process entries even without date range
      expect(userResult.totals.total).toBe(8);
    });

    it('should handle date range with start but no end', () => {
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

      const results = calculateAnalysis(entries, mockStore, { start: '2025-01-01' }); // No end
      const userResult = results.find(u => u.userId === 'user1');

      expect(userResult.totals.total).toBe(8);
    });

    it('should handle date range with end but no start', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, { end: '2025-01-31' }); // No start
      const userResult = results.find(u => u.userId === 'user1');

      expect(userResult.totals.total).toBe(8);
    });

    it('should handle single-day date range', () => {
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

      const results = calculateAnalysis(entries, mockStore, { start: '2025-01-15', end: '2025-01-15' });
      const userResult = results.find(u => u.userId === 'user1');

      expect(userResult.totals.total).toBe(8);
      expect(userResult.totals.expectedCapacity).toBe(8); // Only one day
    });

    it('should handle entries outside date range', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-02-15T09:00:00Z', // February, not in January range
          end: '2025-02-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange); // January range
      const userResult = results.find(u => u.userId === 'user1');

      // Entry outside range should not be included
      expect(userResult.totals.total).toBe(0);
      expect(userResult.totals.expectedCapacity).toBeGreaterThan(0); // But capacity should be calculated
    });
  });

  describe('Holiday and time off overlap', () => {
    it('should handle holiday and time off on same day (holiday takes precedence)', () => {
      const holidayMap = new Map();
      holidayMap.set('2025-01-15', { name: 'Holiday' });
      mockStore.holidays.set('user1', holidayMap);

      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user1', timeOffMap);

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Holiday should take precedence (both result in 0 capacity)
      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(8);
      expect(userResult.totals.holidayCount).toBe(1);
    });
  });

  describe('Multiple anomalies on same day', () => {
    it('should track all anomaly types for a day', () => {
      const holidayMap = new Map();
      holidayMap.set('2025-01-15', { name: 'Test Holiday' });
      mockStore.holidays.set('user1', holidayMap);

      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user1', timeOffMap);

      mockStore.profiles.set('user1', {
        workCapacityHours: 8,
        workingDays: ['MONDAY'] // Jan 15, 2025 is Wednesday
      });

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Day has holiday, is non-working, and has time off
      expect(userResult.totals.holidayCount).toBe(1);
      expect(userResult.totals.timeOffCount).toBe(1);

      const dayData = userResult.days.get('2025-01-15');
      expect(dayData.meta.isHoliday).toBe(true);
      expect(dayData.meta.isNonWorking).toBe(true); // Not in working days
      expect(dayData.meta.isTimeOff).toBe(true);
    });
  });

  describe('Entry sorting for tail attribution', () => {
    it('should split overtime to later entries (tail attribution)', () => {
      const entries = [
        {
          id: 'entry1',
          userId: 'user1',
          userName: 'Alice',
          timeInterval: {
            start: '2025-01-15T09:00:00Z', // First
            end: '2025-01-15T13:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry2',
          userId: 'user1',
          userName: 'Alice',
          timeInterval: {
            start: '2025-01-15T14:00:00Z', // Second
            end: '2025-01-15T19:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');
      const dayData = userResult.days.get('2025-01-15');

      // First entry should be all regular (4 hours)
      const firstEntry = dayData.entries.find(e => e.id === 'entry1');
      expect(firstEntry.analysis.regular).toBe(4);
      expect(firstEntry.analysis.overtime).toBe(0);

      // Second entry should have 4 regular, 1 overtime (capacity is 8)
      const secondEntry = dayData.entries.find(e => e.id === 'entry2');
      expect(secondEntry.analysis.regular).toBe(4);
      expect(secondEntry.analysis.overtime).toBe(1);
    });

    it('should sort entries by start time before splitting', () => {
      const entries = [
        {
          id: 'entry1',
          userId: 'user1',
          userName: 'Alice',
          timeInterval: {
            start: '2025-01-15T18:00:00Z', // Later entry comes first
            end: '2025-01-15T20:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry2',
          userId: 'user1',
          userName: 'Alice',
          timeInterval: {
            start: '2025-01-15T09:00:00Z', // Earlier entry comes second
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');
      const dayData = userResult.days.get('2025-01-15');

      // Entries should be sorted by start time, so entry2 (9am) should be processed first
      const firstEntry = dayData.entries.find(e => e.id === 'entry2');
      const secondEntry = dayData.entries.find(e => e.id === 'entry1');

      // First entry (9am) should be all regular
      expect(firstEntry.analysis.regular).toBe(8);
      expect(firstEntry.analysis.overtime).toBe(0);

      // Second entry (6pm) should be all overtime
      expect(secondEntry.analysis.regular).toBe(0);
      expect(secondEntry.analysis.overtime).toBe(2);
    });
  });

  describe('Cost calculation edge cases', () => {
    it('should handle entries with zero hourly rate', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 0 }, // Zero rate
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      expect(userResult.totals.amount).toBe(0);
      expect(userResult.totals.otPremium).toBe(0);
    });

    it('should handle entries with no hourlyRate object', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        // No hourlyRate
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Should treat as $0 rate
      expect(userResult.totals.amount).toBe(0);
      expect(userResult.totals.otPremium).toBe(0);
    });

    it('should handle entries with null hourlyRate', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: null,
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      expect(userResult.totals.amount).toBe(0);
      expect(userResult.totals.otPremium).toBe(0);
    });
  });

  describe('Override multiplier edge cases', () => {
    it('should handle multiplier of exactly 1.0 (no premium)', () => {
      mockStore.overrides = {
        'user1': { multiplier: 1.0 }
      };

      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Base cost: 10 * 50 = 500
      // OT Premium: 2 * 50 * (1.0 - 1) = 0
      expect(userResult.totals.amount).toBe(500);
      expect(userResult.totals.otPremium).toBe(0);
    });

    it('should handle very high multiplier', () => {
      mockStore.overrides = {
        'user1': { multiplier: 5.0 }
      };

      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Base cost: 10 * 50 = 500
      // OT Premium: 2 * 50 * (5.0 - 1) = 400
      // Total: 900
      expect(userResult.totals.amount).toBe(900);
      expect(userResult.totals.otPremium).toBe(400);
    });

    it('should handle NaN multiplier (should use global)', () => {
      mockStore.overrides = {
        'user1': { multiplier: NaN }
      };

      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // NaN should be treated as missing, so use global 1.5
      expect(userResult.totals.amount).toBe(550); // 500 + 50
    });
  });

  describe('Entry analysis tags', () => {
    it('should add HOLIDAY tag for holiday entries', () => {
      const holidayMap = new Map();
      holidayMap.set('2025-01-15', { name: 'New Year' });
      mockStore.holidays.set('user1', holidayMap);

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');
      const dayData = userResult.days.get('2025-01-15');
      const entry = dayData.entries[0];

      expect(entry.analysis.tags).toContain('HOLIDAY');
    });

    it('should add OFF-DAY tag for non-working day entries', () => {
      mockStore.profiles.set('user1', {
        workCapacityHours: 8,
        workingDays: ['MONDAY'] // Jan 15, 2025 is Wednesday
      });

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');
      const dayData = userResult.days.get('2025-01-15');
      const entry = dayData.entries[0];

      expect(entry.analysis.tags).toContain('OFF-DAY');
    });

    it('should add TIME-OFF tag for time off entries', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user1', timeOffMap);

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');
      const dayData = userResult.days.get('2025-01-15');
      const entry = dayData.entries[0];

      expect(entry.analysis.tags).toContain('TIME-OFF');
    });

    it('should include multiple tags when multiple anomalies apply', () => {
      const holidayMap = new Map();
      holidayMap.set('2025-01-15', { name: 'Holiday' });
      mockStore.holidays.set('user1', holidayMap);

      mockStore.profiles.set('user1', {
        workCapacityHours: 8,
        workingDays: ['MONDAY'] // Jan 15 is Wednesday
      });

      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true, hours: 0 });
      mockStore.timeOff.set('user1', timeOffMap);

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

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');
      const dayData = userResult.days.get('2025-01-15');
      const entry = dayData.entries[0];

      expect(entry.analysis.tags).toContain('HOLIDAY');
      expect(entry.analysis.tags).toContain('OFF-DAY');
      expect(entry.analysis.tags).toContain('TIME-OFF');
    });
  });

  describe('Empty/null data handling', () => {
    it('should handle entries array with null entries', () => {
      const entries = [null, {
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
      }, undefined];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Should process valid entry and skip null/undefined
      expect(userResult.totals.total).toBe(8);
    });

    it('should handle store with null users array', () => {
      mockStore.users = null;

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

      const results = calculateAnalysis(entries, mockStore, dateRange);

      // Should create user from entry even if users array is null
      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user1');
    });

    it('should handle entries with null timeInterval', () => {
      const entries = [{
        id: 'entry1',
        userId: 'user1',
        userName: 'Alice',
        timeInterval: null,
        hourlyRate: { amount: 5000 },
        billable: true
      }];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user1');

      // Should handle gracefully and not crash
      expect(userResult.totals.total).toBe(0);
    });
  });
});
