/**
 * @jest-environment jsdom
 */

import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore, generateMockUsers } from '../helpers/mock-data.js';

describe('Calculation Module - Holiday/Time-Off Detection from Entries', () => {
  let mockStore;
  let mockUsers;
  let dateRange;

  beforeEach(() => {
    mockUsers = generateMockUsers(1);
    mockStore = createMockStore({
      users: mockUsers,
      config: {
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: false, // Disabled API-based holidays for fallback testing
        applyTimeOff: false,  // Disabled API-based time-off for fallback testing
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
    dateRange = { start: '2025-01-20', end: '2025-01-20' };
  });

  describe('Holiday detection from HOLIDAY entry type', () => {
    it('should detect holiday from HOLIDAY entry and set capacity=0 for WORK entries', () => {
      const entries = [
        {
          id: 'holiday_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Holiday entry counts as regular hours, not OT
      expect(userResult.totals.vacationEntryHours).toBe(8);

      // WORK entry (2h) should be all OT because capacity=0 (holiday day)
      expect(userResult.totals.regular).toBe(8); // Only holiday hours
      expect(userResult.totals.overtime).toBe(2); // All WORK is OT
      expect(userResult.totals.total).toBe(10);
    });

    it('should handle multiple WORK entries on holiday day (all should be OT)', () => {
      const entries = [
        {
          id: 'holiday_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T11:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'work_2',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T11:00:00Z',
            end: '2025-01-20T16:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(8); // Only holiday
      expect(userResult.totals.overtime).toBe(8); // 3h + 5h all OT
      expect(userResult.totals.total).toBe(16);
    });
  });

  describe('Time-off detection from TIME_OFF entry type', () => {
    it('should detect time-off from TIME_OFF entry and reduce capacity', () => {
      const entries = [
        {
          id: 'timeoff_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T18:00:00Z',
            duration: 'PT6H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Time-off entry counts as regular hours
      expect(userResult.totals.vacationEntryHours).toBe(4);

      // Effective capacity = 8h - 4h = 4h
      // WORK: 6h → 4h regular, 2h OT
      expect(userResult.totals.regular).toBe(8); // 4h time-off + 4h work
      expect(userResult.totals.overtime).toBe(2);
      expect(userResult.totals.total).toBe(10);
    });

    it('should handle full-day time-off (capacity becomes 0)', () => {
      const entries = [
        {
          id: 'timeoff_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(8); // Only time-off
      expect(userResult.totals.overtime).toBe(2); // All WORK is OT
      expect(userResult.totals.total).toBe(10);
    });
  });

  describe('API holiday takes precedence over entry-based detection', () => {
    it('should use API holiday name when both API and entry exist', () => {
      // Enable API-based holidays
      mockStore.config.applyHolidays = true;

      // Add holiday to API map
      mockStore.holidays.set('user0', new Map([
        ['2025-01-20', {
          id: 'holiday_api',
          userId: 'user0',
          name: 'National Day (API)',
          date: '2025-01-20'
        }]
      ]));

      const entries = [
        {
          id: 'holiday_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Should still detect holiday and apply capacity=0
      expect(userResult.totals.overtime).toBe(2); // All WORK is OT

      // Verify day meta contains API holiday info
      const dayMeta = userResult.days.get('2025-01-20').meta;
      expect(dayMeta.isHoliday).toBe(true);
      expect(dayMeta.holidayName).toBe('National Day (API)'); // Not "detected from entry"
    });
  });

  describe('API time-off takes precedence over entry-based detection', () => {
    it('should use API time-off data when both API and entry exist', () => {
      // Enable API-based time-off
      mockStore.config.applyTimeOff = true;

      // Add time-off to API map (6h from API)
      mockStore.timeOff.set('user0', new Map([
        ['2025-01-20', {
          id: 'timeoff_api',
          userId: 'user0',
          hours: 6,
          isFullDay: false
        }]
      ]));

      const entries = [
        {
          id: 'timeoff_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
            duration: 'PT4H' // Entry says 4h
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T16:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // API says 6h time-off, so capacity = 8 - 6 = 2h
      // WORK: 4h → 2h regular, 2h OT (using API capacity reduction)
      expect(userResult.totals.regular).toBe(6); // 4h time-off entry + 2h work
      expect(userResult.totals.overtime).toBe(2);
    });
  });

  describe('Entry-based detection only when API disabled', () => {
    it('should NOT detect from entries when API is enabled (even if API returns no data)', () => {
      // Enable API but provide empty maps (simulating no holiday on this day)
      mockStore.config.applyHolidays = true;
      mockStore.holidays.set('user0', new Map()); // Empty map

      const entries = [
        {
          id: 'holiday_entry',
          userId: 'user0',
          userName: 'User 0',
          type: 'HOLIDAY',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T08:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T08:00:00Z',
            end: '2025-01-20T10:00:00Z',
            duration: 'PT2H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // With API enabled, entry-based detection should NOT activate
      // HOLIDAY entry counts as regular hours (PTO), WORK entry is regular (within capacity)
      expect(userResult.totals.vacationEntryHours).toBe(8);
      expect(userResult.totals.regular).toBe(10); // 8h holiday + 2h work
      expect(userResult.totals.overtime).toBe(0);

      const dayMeta = userResult.days.get('2025-01-20').meta;
      expect(dayMeta.isHoliday).toBe(false); // No API data, so not treated as holiday
    });
  });

  describe('Edge cases', () => {
    it('should handle day with no entries gracefully', () => {
      const entries = [];
      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      expect(userResult.totals.regular).toBe(0);
      expect(userResult.totals.overtime).toBe(0);
      expect(userResult.totals.vacationEntryHours).toBe(0);
    });

    it('should handle malformed TIME_OFF duration', () => {
      const entries = [
        {
          id: 'timeoff_bad',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
            duration: 'INVALID' // Bad duration
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T20:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Malformed duration in parseIsoDuration returns 0, so capacity reduction detection fails
      // But calculateDuration falls back to start/end, so entry still counts as 4h regular
      // TIME_OFF: 4h regular (from start/end fallback)
      // WORK: 8h regular (capacity not reduced, full 8h available)
      expect(userResult.totals.vacationEntryHours).toBe(4); // Entry still processed
      expect(userResult.totals.regular).toBe(12); // 4h + 8h
      expect(userResult.totals.overtime).toBe(0); // No capacity reduction, no OT
    });

    it('should handle BREAK and TIME_OFF on same day', () => {
      const entries = [
        {
          id: 'timeoff_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'TIME_OFF',
          timeInterval: {
            start: '2025-01-20T00:00:00Z',
            end: '2025-01-20T04:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: false
        },
        {
          id: 'break_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'BREAK',
          timeInterval: {
            start: '2025-01-20T12:00:00Z',
            end: '2025-01-20T13:00:00Z',
            duration: 'PT1H'
          },
          hourlyRate: { amount: 0 },
          billable: false
        },
        {
          id: 'work_1',
          userId: 'user0',
          userName: 'User 0',
          type: 'REGULAR',
          timeInterval: {
            start: '2025-01-20T13:00:00Z',
            end: '2025-01-20T18:00:00Z',
            duration: 'PT5H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const results = calculateAnalysis(entries, mockStore, dateRange);
      const userResult = results.find(u => u.userId === 'user0');

      // Capacity = 8 - 4 (time-off) = 4h
      // TIME_OFF: 4h regular
      // BREAK: 1h regular (doesn't accumulate toward capacity)
      // WORK: 5h → 4h regular, 1h OT
      expect(userResult.totals.vacationEntryHours).toBe(4);
      expect(userResult.totals.breaks).toBe(1);
      expect(userResult.totals.regular).toBe(9); // 4 + 1 + 4
      expect(userResult.totals.overtime).toBe(1);
      expect(userResult.totals.total).toBe(10);
    });
  });
});
