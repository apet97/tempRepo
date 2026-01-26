/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Api, resetRateLimiter } from '../../js/api.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('API Module - Core Coverage', () => {
  afterEach(() => {
    standardAfterEach();
    // Reset store state
    store.token = null;
    store.claims = null;
    global.fetch = mockFetch; // Restore mock fetch
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimiter(); // Reset rate limiter before each test
    store.resetThrottleStatus(); // Reset throttle tracking
    store.token = 'test-token';
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.com'
    };
  });

  describe('fetchUsers', () => {
    it('should fetch users successfully', async () => {
      const mockUsers = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockUsers)
      });

      const result = await Api.fetchUsers('ws_test');
      expect(result).toEqual(mockUsers);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return empty array on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      });

      const result = await Api.fetchUsers('ws_test');
      expect(result).toEqual([]);
    });
  });

  describe('fetchEntries', () => {
    it('should fetch entries for multiple users', async () => {
      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([])
      });

      const result = await Api.fetchEntries('ws_test', users, '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');
      expect(Array.isArray(result)).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should attach user metadata to entries', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            id: 'entry1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z' }
          }
        ])
      });

      const result = await Api.fetchEntries('ws_test', users, '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');
      expect(result[0].userId).toBe('user1');
      expect(result[0].userName).toBe('Alice');
    });
  });

  describe('fetchUserProfile', () => {
    it('should fetch user profile successfully', async () => {
      const mockProfile = {
        workCapacity: 'PT8H',
        workingDays: ['MONDAY']
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockProfile)
      });

      const result = await Api.fetchUserProfile('ws_test', 'user1');
      expect(result.data).toEqual(mockProfile);
      expect(result.failed).toBe(false);
    });

    it('should handle 404 error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await Api.fetchUserProfile('ws_test', 'user1');
      expect(result.failed).toBe(true);
      expect(result.status).toBe(404);
    });

    it('should handle 403 forbidden', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403
      });

      const result = await Api.fetchUserProfile('ws_test', 'user1');
      expect(result.failed).toBe(true);
    });
  });

  describe('fetchHolidays', () => {
    it('should fetch holidays successfully', async () => {
      const mockHolidays = [
        { name: 'New Year', datePeriod: { startDate: '2025-01-01' } }
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockHolidays)
      });

      const result = await Api.fetchHolidays('ws_test', 'user1', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z');
      expect(result.data).toEqual(mockHolidays);
      expect(result.failed).toBe(false);
    });

    it('should handle empty holidays list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([])
      });

      const result = await Api.fetchHolidays('ws_test', 'user1', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z');
      expect(result.data).toEqual([]);
    });
  });

  describe('fetchTimeOffRequests', () => {
    it('should fetch time off via POST', async () => {
      const mockResponse = {
        requests: [
          {
            id: 'req1',
            userId: 'user1',
            status: 'APPROVED',
            timeOffPeriod: { startDate: '2025-01-15' }
          }
        ]
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await Api.fetchTimeOffRequests('ws_test', ['user1'], '2025-01-01', '2025-01-31');
      expect(result.data).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
  });

  describe('fetchAllProfiles', () => {
    it('should fetch all profiles in batches', async () => {
      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' },
        { id: 'user3', name: 'Charlie' },
        { id: 'user4', name: 'David' },
        { id: 'user5', name: 'Eve' },
        { id: 'user6', name: 'Frank' }
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          workCapacity: 'PT8H',
          workingDays: ['MONDAY']
        })
      });

      const profiles = await Api.fetchAllProfiles('ws_test', users);
      expect(profiles.size).toBe(6);
      expect(store.apiStatus.profilesFailed).toBe(0);
    });

    it('should track failed profile fetches', async () => {
      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ workCapacity: 'PT8H' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403
        });

      const profiles = await Api.fetchAllProfiles('ws_test', users);
      expect(profiles.size).toBe(1);
      expect(store.apiStatus.profilesFailed).toBe(1);
    });
  });

  describe('fetchAllHolidays', () => {
    it('should fetch all holidays in batches', async () => {
      const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { name: 'Holiday 1', datePeriod: { startDate: '2025-01-01' } }
        ])
      });

      const holidays = await Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31');
      expect(holidays.size).toBe(2);
      expect(store.apiStatus.holidaysFailed).toBe(0);
    });
  });

  describe('fetchAllTimeOff', () => {
    it('should build per-user per-date map', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          requests: [
            {
              id: 'req1',
              userId: 'user1',
              status: 'APPROVED',
              timeOffPeriod: { startDate: '2025-01-15' }
            }
          ]
        })
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');
      const userMap = timeOff.get('user1');
      expect(userMap).toBeInstanceOf(Map);
      expect(userMap.size).toBeGreaterThan(0);
      expect(userMap.has('2025-01-15')).toBe(true);
    });

    it('should handle timeOffRequests response format (line 1199)', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeOffRequests: [
            {
              id: 'req1',
              userId: 'user1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                period: { start: '2025-01-15', end: '2025-01-15' }
              }
            }
          ]
        })
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');
      expect(timeOff.get('user1')).toBeInstanceOf(Map);
    });

    it('should handle direct array response format (line 1196)', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            id: 'req1',
            userId: 'user1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {
              period: { start: '2025-01-15', end: '2025-01-15' }
            }
          }
        ])
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');
      expect(timeOff.get('user1')).toBeInstanceOf(Map);
    });

    it('should handle requesterUserId fallback (line 1219)', async () => {
      const users = [{ id: 'user2', name: 'Bob' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          requests: [
            {
              id: 'req1',
              requesterUserId: 'user2', // Using requesterUserId instead of userId
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                period: { start: '2025-01-20', end: '2025-01-20' }
              }
            }
          ]
        })
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');
      expect(timeOff.get('user2')).toBeInstanceOf(Map);
      expect(timeOff.get('user2').size).toBeGreaterThan(0);
      expect(timeOff.get('user2').has('2025-01-20')).toBe(true);
    });

    it('should expand multi-day time off (lines 1247-1250)', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          requests: [
            {
              id: 'req1',
              userId: 'user1',
              status: { statusType: 'APPROVED' },
              timeOffPeriod: {
                period: {
                  start: '2025-01-15',
                  end: '2025-01-17' // Multi-day
                }
              }
            }
          ]
        })
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');
      const userMap = timeOff.get('user1');
      expect(userMap).toBeInstanceOf(Map);
      // Should have entries for all 3 days
      expect(userMap.has('2025-01-15')).toBe(true);
      expect(userMap.has('2025-01-16')).toBe(true);
      expect(userMap.has('2025-01-17')).toBe(true);
    });

    it('should skip non-APPROVED requests', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          requests: [
            {
              id: 'req1',
              userId: 'user1',
              status: { statusType: 'PENDING' },
              timeOffPeriod: { period: { start: '2025-01-15' } }
            }
          ]
        })
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');
      expect(timeOff.get('user1')).toBeUndefined();
    });

    it('should handle requests without userId', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          requests: [
            {
              id: 'req1',
              // No userId or requesterUserId
              status: { statusType: 'APPROVED' },
              timeOffPeriod: { period: { start: '2025-01-15' } }
            }
          ]
        })
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');
      expect(timeOff.size).toBe(0);
    });

    it('should return empty map when fetch fails', async () => {
      resetRateLimiter();
      const users = [{ id: 'user1', name: 'Alice' }];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      });

      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31', { maxRetries: 0 });
      expect(timeOff.size).toBe(0);
      expect(store.apiStatus.timeOffFailed).toBe(1);
    });
  });

  describe('fetchDetailedReport - Response Normalization', () => {
    it('should normalize timestamp with space separator (line 738)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: {
                start: '2025-01-15 09:00:00Z', // Space separator instead of T
                end: '2025-01-15 17:00:00Z',
                duration: 28800
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].timeInterval.start).toBe('2025-01-15T09:00:00Z');
    });

    it('should normalize compact timestamp format (line 746)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: {
                start: '2025-01-1509:00:00Z', // Compact format (missing T)
                end: '2025-01-1517:00:00Z',
                duration: 28800
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].timeInterval.start).toBe('2025-01-15T09:00:00Z');
    });

    it('should pick rate value from nested object (lines 753-757)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              hourlyRate: { amount: 5000, currency: 'USD' }, // Nested rate object
              rate: 0,
              earnedRate: 0
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].hourlyRate.amount).toBe(5000);
    });

    it('should handle null/undefined rate values gracefully (lines 770-771)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              // All rate fields are null/undefined
              hourlyRate: null,
              rate: null,
              earnedRate: null,
              costRate: null
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].hourlyRate.amount).toBe(0);
    });

    it('should normalize amounts from object format (lines 788, 804-807)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              hourlyRate: 5000,
              // amounts as object instead of array
              amounts: {
                EARNED: 400,
                COST: 300,
                PROFIT: 100
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(Array.isArray(result[0].amounts)).toBe(true);
      expect(result[0].amounts.length).toBe(3);
    });

    it('should enforce page limit (lines 915-924)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };
      store.config.maxPages = 2; // Set low limit for test

      // Return full pages to trigger pagination
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: Array(200).fill({
            _id: 'entry',
            userId: 'user1',
            userName: 'Alice',
            timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
          })
        })
      }));

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      // Should stop at page limit
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Reached page limit'));
      consoleSpy.mockRestore();

      // Reset maxPages
      store.config.maxPages = 50;
    });

    it('should handle both timeentries and timeEntries keys', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      // Use timeEntries (camelCase) instead of timeentries
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeEntries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
    });

    it('should break on fetch failure during pagination (line 841-842)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('URL Resolution - Edge Cases', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });
    });

    it('should handle malformed reportsUrl (lines 313-318)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'not-a-valid-url'
      };
      store.token = 'test-token';

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result).toEqual([]);
    });

    it('should use backendUrl for developer portal without reportsUrl (line 325)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://developer.clockify.me/api'
        // No reportsUrl
      };
      store.token = 'test-token';

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('developer.clockify.me'),
        expect.any(Object)
      );
    });

    it('should handle regional URL without /api path (line 340)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://eu.clockify.me' // No /api path
        // No reportsUrl
      };
      store.token = 'test-token';

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('eu.clockify.me/report'),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling - Rate Limiting', () => {
    beforeEach(() => {
      resetRateLimiter();
      store.resetThrottleStatus();
    });

    it('should fail after exhausting rate limit retries (line 579-580)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      // Always return 429
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: {
          get: () => '0' // Immediate retry
        }
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31', { maxRetries: 0 });

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('should increment throttle status on 429 (lines 561-562)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      // Return 429 with no retry
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: {
          get: () => null
        }
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31', { maxRetries: 0 });

      // Should have incremented throttle retry count
      expect(store.throttleStatus.retryCount).toBeGreaterThan(0);
      consoleSpy.mockRestore();
    });
  });

  describe('Pagination Failure Handling', () => {
    it('should log warning and break on pagination failure (lines 662-665)', async () => {
      const users = [{ id: 'user1', name: 'Alice' }];

      // First page succeeds with full page, second page fails
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(Array(500).fill({
            id: 'entry',
            timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z' }
          }))
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500
        });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await Api.fetchEntries('ws_test', users, '2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch entries')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('Error Classification', () => {
    it('should handle response.json() parse failure (lines 593-596)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('should handle AUTH_ERROR without retry (lines 607-608)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31', { maxRetries: 2 });

      // Should only call fetch once (no retries for 401)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe('Store Claims Edge Cases', () => {
    it('should handle null store.claims (line 277)', async () => {
      store.claims = null;
      store.token = 'test-token';

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      // Should not crash with null claims
      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result).toEqual([]);
    });

    it('should handle null store.token (line 539)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };
      store.token = null;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      // Should pass empty string for token
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Addon-Token': ''
          })
        })
      );
    });

    it('should handle undefined store.token (line 539)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };
      store.token = undefined;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Addon-Token': ''
          })
        })
      );
    });

    it('should handle empty response data (line 849)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}) // Neither timeentries nor timeEntries
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result).toEqual([]);
    });
  });

  describe('Entry Transformation Edge Cases', () => {
    beforeEach(() => {
      resetRateLimiter();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };
    });

    it('should use REGULAR type when entry.type is missing (line 877-880)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [{
            _id: 'entry1',
            userId: 'user1',
            userName: 'Alice',
            // No type field
            timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
          }]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].type).toBe('REGULAR');
    });

    it('should handle null duration (line 894)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [{
            _id: 'entry1',
            userId: 'user1',
            userName: 'Alice',
            timeInterval: {
              start: '2025-01-15T09:00:00Z',
              end: '2025-01-15T17:00:00Z',
              duration: null
            }
          }]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].timeInterval.duration).toBeNull();
    });

    it('should handle undefined duration (line 894)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [{
            _id: 'entry1',
            userId: 'user1',
            userName: 'Alice',
            timeInterval: {
              start: '2025-01-15T09:00:00Z',
              end: '2025-01-15T17:00:00Z'
              // duration undefined
            }
          }]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].timeInterval.duration).toBeNull();
    });

    it('should handle billable with zero earnedRate (line 901)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [{
            _id: 'entry1',
            userId: 'user1',
            userName: 'Alice',
            billable: true,
            earnedRate: 0,
            hourlyRate: 5000, // Fallback to hourlyRate
            timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
          }]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].earnedRate).toBe(5000);
    });

    it('should handle hourlyRate currency extraction (line 868)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [{
            _id: 'entry1',
            userId: 'user1',
            userName: 'Alice',
            hourlyRate: { amount: 5000, currency: 'EUR' },
            timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
          }]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].hourlyRate.currency).toBe('EUR');
    });

    it('should default to USD when hourlyRate has no currency (line 868)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [{
            _id: 'entry1',
            userId: 'user1',
            userName: 'Alice',
            hourlyRate: { amount: 5000 }, // No currency
            timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
          }]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].hourlyRate.currency).toBe('USD');
    });
  });

  describe('Holiday/TimeOff Processing Edge Cases', () => {
    beforeEach(() => {
      resetRateLimiter();
    });

    it('should handle holiday with null datePeriod (line 1137-1139)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            name: 'Mystery Holiday',
            datePeriod: null // null datePeriod
          }
        ])
      });

      const users = [{ id: 'user1', name: 'Alice' }];
      const holidays = await Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31');

      const userHolidays = holidays.get('user1');
      expect(Array.isArray(userHolidays)).toBe(true);
      expect(userHolidays.length).toBe(1);
      expect(userHolidays[0].datePeriod.startDate).toBe('');
    });

    it('should handle holiday with empty datePeriod object (line 1137-1139)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            name: 'Partial Holiday',
            datePeriod: {} // empty object
          }
        ])
      });

      const users = [{ id: 'user1', name: 'Alice' }];
      const holidays = await Api.fetchAllHolidays('ws_test', users, '2025-01-01', '2025-12-31');

      const userHolidays = holidays.get('user1');
      expect(userHolidays[0].datePeriod.startDate).toBe('');
    });

    it('should handle time-off request with missing timeOffPeriod (line 1232)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          requests: [{
            id: 'req1',
            userId: 'user1',
            status: { statusType: 'APPROVED' }
            // timeOffPeriod is missing
          }]
        })
      });

      const users = [{ id: 'user1', name: 'Alice' }];
      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');

      // User map is created but no time-off entries added due to missing dates
      expect(timeOff.size).toBe(1);
      expect(timeOff.get('user1').size).toBe(0);
    });

    it('should handle time-off request with empty timeOffPeriod (line 1232)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          requests: [{
            id: 'req1',
            userId: 'user1',
            status: { statusType: 'APPROVED' },
            timeOffPeriod: {} // empty object
          }]
        })
      });

      const users = [{ id: 'user1', name: 'Alice' }];
      const timeOff = await Api.fetchAllTimeOff('ws_test', users, '2025-01-01', '2025-12-31');

      // User map is created but no time-off entries added due to missing dates
      expect(timeOff.size).toBe(1);
      expect(timeOff.get('user1').size).toBe(0);
    });
  });

  describe('Additional Response Normalization', () => {
    beforeEach(() => {
      resetRateLimiter();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };
    });

    it('should handle empty/whitespace-only timestamps (line 729)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: {
                start: '   ', // Whitespace only
                end: '',      // Empty
                duration: 28800
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].timeInterval.start).toBe('');
      expect(result[0].timeInterval.end).toBe('');
    });

    it('should handle timestamp with T already present (line 729 early return)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: {
                start: '2025-01-15T09:00:00.000Z', // Already has T
                end: '2025-01-15T17:00:00.000Z',
                duration: 28800
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].timeInterval.start).toBe('2025-01-15T09:00:00.000Z');
    });

    it('should handle all rate values being zero (line 757)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              billable: false, // Non-billable
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              earnedRate: 0,
              rate: 0,
              hourlyRate: { amount: 0 },
              costRate: 0
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].hourlyRate.amount).toBe(0);
    });

    it('should handle amounts as single object (lines 788)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              hourlyRate: 5000,
              amounts: { type: 'EARNED', value: 400 } // Single object, not array
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].amounts.length).toBeGreaterThan(0);
    });

    it('should use fallback amount when amounts is null (line 805)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              hourlyRate: 5000,
              amounts: null,
              amount: 400 // Fallback amount
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      expect(result[0].amounts.length).toBeGreaterThan(0);
      expect(result[0].amounts[0].value).toBe(400);
    });

    it('should call onProgress callback during pagination (line 814)', async () => {
      let progressCalled = false;
      const onProgress = (page, phase) => {
        progressCalled = true;
        expect(phase).toBe('entries');
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31', { onProgress });
      expect(progressCalled).toBe(true);
    });

    it('should handle regional URL with /api path transformation (line 344)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://eu.api.clockify.me/api' // Regional with /api path
        // No reportsUrl - should derive from backendUrl
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      // Should call reports endpoint at /report path
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('eu.api.clockify.me/report'),
        expect.any(Object)
      );
    });

    it('should fallback to production URL for unknown environment (line 344)', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://some.unknown.host/api' // Not clockify.me
        // No reportsUrl
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      // Should fallback to production reports URL
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('reports.api.clockify.me'),
        expect.any(Object)
      );
    });

    it('should handle resolveRateValue with string value (line 729)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              // String value should return 0
              hourlyRate: 'invalid-string',
              rate: 'not-a-number',
              earnedRate: undefined
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].hourlyRate.amount).toBe(0);
    });

    it('should handle normalizeTimestamp with unrecognized format (line 746)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: {
                start: 'just-some-random-string', // Neither space nor compact format
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      // Should return the string as-is
      expect(result[0].timeInterval.start).toBe('just-some-random-string');
    });

    it('should handle pickRateValue when all values are not positive (line 757)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              // All rate values are NaN, null, or undefined
              earnedRate: NaN,
              rate: null,
              hourlyRate: undefined
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      // pickRateValue returns 0 when no finite values are found
      expect(result[0].hourlyRate.amount).toBe(0);
    });

    it('should handle amounts item with only amountType/amount keys (lines 770-771)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              hourlyRate: 5000,
              amounts: [
                { amountType: 'EARNED', amount: 400 }, // Using amountType and amount instead of type and value
                { type: 'COST', value: 300 }
              ]
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].amounts.length).toBeGreaterThanOrEqual(2);
    });

    it('should log validation error details when response has json body (line 593)', async () => {
      resetRateLimiter();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 422, // Validation error
        json: () => Promise.resolve({ error: 'Validation failed', details: ['field1 required'] })
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31', { maxRetries: 0 });

      expect(consoleSpy).toHaveBeenCalledWith('API Validation Error details:', expect.any(Object));
      consoleSpy.mockRestore();
    });

    it('should handle amounts with NaN values in ensureShownAmount (lines 772-773)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              hourlyRate: 5000,
              amount: 500, // Fallback amount
              amounts: [
                { type: 'EARNED', value: NaN }, // NaN value - should not contribute to total
                { type: 'COST', amount: undefined } // undefined amount
              ]
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result.length).toBe(1);
      // Should have added fallback because NaN values don't count
      expect(result[0].amounts.some(a => a.type === 'EARNED' && a.value === 500)).toBe(true);
    });

    it('should return 0 from pickRateValue when all values are undefined/null/NaN (line 759)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              // All rate fields are undefined, null, or NaN - none are finite numbers > 0
              earnedRate: undefined,
              rate: null,
              hourlyRate: undefined
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      // pickRateValue returns 0 when all values resolve to non-finite numbers
      expect(result[0].hourlyRate.amount).toBe(0);
    });

    it('should handle space-separated date format (line 729-734)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: {
                start: '2025-01-15 09:00:00.000Z', // Space instead of T
                end: '2025-01-15 17:00:00.000Z',
                duration: 28800
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      // Should normalize to T format
      expect(result[0].timeInterval.start).toBe('2025-01-15T09:00:00.000Z');
      expect(result[0].timeInterval.end).toBe('2025-01-15T17:00:00.000Z');
    });

    it('should handle compact date format without T (line 742-746)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: {
                start: '2025-01-1509:00:00.000Z', // Compact format
                end: '2025-01-1517:00:00.000Z',
                duration: 28800
              }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      // Should normalize to T format
      expect(result[0].timeInterval.start).toBe('2025-01-15T09:00:00.000Z');
      expect(result[0].timeInterval.end).toBe('2025-01-15T17:00:00.000Z');
    });

    it('should handle amounts with NaN values in type check (line 773-776)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 },
              hourlyRate: 5000,
              amounts: [
                { type: 'EARNED', value: NaN }, // NaN value
                { type: 'COST', value: 'not-a-number' } // Invalid string
              ],
              amount: 500 // Fallback
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      // Should still process but add fallback due to invalid amounts
      expect(Array.isArray(result[0].amounts)).toBe(true);
    });

    it('should use earnedRate when billable and earnedRate is positive (line 901)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              billable: true,
              earnedRate: 7500, // Should use this
              rate: 5000,
              hourlyRate: 5000,
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      // Should use earnedRate for billable entries
      expect(result[0].earnedRate).toBe(7500);
    });

    it('should handle currency extraction from hourlyRate object (line 868)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          timeentries: [
            {
              _id: 'entry1',
              userId: 'user1',
              userName: 'Alice',
              hourlyRate: { amount: 5000, currency: 'GBP' },
              timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
            }
          ]
        })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');
      expect(result[0].hourlyRate.currency).toBe('GBP');
    });
  });

  describe('Auth Error Handling (line 609)', () => {
    beforeEach(() => {
      resetRateLimiter();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };
    });

    it('should not retry on 401 auth error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.reject(new Error('Unauthorized'))
      });

      const result = await Api.fetchUsers('ws_test');

      // Should return empty without retrying
      expect(result).toEqual([]);
      // Should only call once (no retries)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 403 forbidden error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.reject(new Error('Forbidden'))
      });

      const result = await Api.fetchUsers('ws_test');

      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Detailed Report Pagination (lines 648-653, 920-921)', () => {
    beforeEach(() => {
      resetRateLimiter();
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };
    });

    it('should handle maxPages = 0 (line 648-653)', async () => {
      store.config.maxPages = 0;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      // When maxPages is 0, should still fetch at least one page
      expect(mockFetch).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should use configured maxPages for pagination', async () => {
      store.config.maxPages = 5;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timeentries: [] })
      });

      await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle multiple pages of results (lines 920-921)', async () => {
      store.config.maxPages = 2;

      // Mock 200 entries per page (full page triggers continuation)
      const fullPage = Array(200).fill(null).map((_, i) => ({
        _id: `entry${i}`,
        userId: 'user1',
        userName: 'Alice',
        timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 }
      }));

      // First call returns full page, second call returns partial (end pagination)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ timeentries: fullPage })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ timeentries: [{ _id: 'final', userId: 'user1', userName: 'Alice', timeInterval: { start: '2025-01-15T09:00:00Z', end: '2025-01-15T17:00:00Z', duration: 28800 } }] })
        });

      const result = await Api.fetchDetailedReport('ws_test', '2025-01-01', '2025-01-31');

      // Should have entries from multiple pages
      expect(result.length).toBe(201);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
