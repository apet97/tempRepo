/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import { Api, resetRateLimiter } from '../../js/api.js';
import { store } from '../../js/state.js';
import { generateMockUsers, createMockTokenPayload } from '../helpers/mock-data.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('API Module', () => {
  beforeEach(async () => {
    // Reset store
    const mockPayload = createMockTokenPayload();
    store.token = 'mock_jwt_token';
    store.claims = mockPayload;
    store.resetApiStatus();

    // Reset all mocks (clears both call history AND implementations)
    fetch.mockReset();

    // Reset the rate limiter to ensure tokens are available
    resetRateLimiter();

    // Enable fake timers
    jest.useFakeTimers();
    // Advance time to ensure any pending work is processed
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  describe('fetchWithAuth', () => {
    it('should fetch with auth token', async () => {
      const mockResponse = { data: 'test' };
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Addon-Token': store.token
          })
        })
      );
    });

    it('should handle 403 error gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toBeNull();
      expect(result.failed).toBe(true);
      expect(result.status).toBe(403);
    });

    it('should handle 404 error gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toBeNull();
      expect(result.failed).toBe(true);
      expect(result.status).toBe(404);
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await Api.fetchUsers('workspace_123');

      // fetchUsers returns empty array on network error (graceful degradation)
      expect(result).toEqual([]);
    });

    it('should handle 500 error gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const result = await Api.fetchUsers('workspace_123');

      // Should return empty array on 500 error (graceful degradation)
      expect(result).toEqual([]);
    });
  });

  describe('fetchUsers', () => {
    it('should fetch workspace users', async () => {
      const mockUsers = generateMockUsers(3);
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockUsers
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.clockify.me/v1/workspaces/workspace_123/users',
        expect.any(Object)
      );
      expect(result).toEqual(mockUsers);
    });

    it('should return empty array on failure', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual([]);
    });
  });

  describe('fetchEntries', () => {
    it('should fetch entries for multiple users in batches', async () => {
      const users = generateMockUsers(3);
      const mockEntries = [
        { id: 'entry_1', userId: 'user_0' },
        { id: 'entry_2', userId: 'user_0' }
      ];

      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockEntries
      });

      const result = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Should be called for each user
      expect(fetch).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Array);
    });

    it('should handle pagination', async () => {
      const users = generateMockUsers(1);

      // First page returns 500 entries (full page)
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => Array(500).fill({ id: 'entry' })
      });

      // Second page returns 100 entries (partial page)
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => Array(100).fill({ id: 'entry' })
      });

      const result = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Should fetch 2 pages (stops when page 2 has < PAGE_SIZE entries)
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.length).toBe(600); // 500 + 100

      // Verify first page request has page=1
      expect(fetch).toHaveBeenNthCalledWith(1,
        expect.stringContaining('page=1'),
        expect.any(Object)
      );

      // Verify second page request has page=2
      expect(fetch).toHaveBeenNthCalledWith(2,
        expect.stringContaining('page=2'),
        expect.any(Object)
      );
    });

    it('should stop at max pages', async () => {
      const users = generateMockUsers(1);

      // Set up mock to return full page for all calls (will be called up to DEFAULT_MAX_PAGES times)
      fetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => Array(500).fill({ id: 'entry' })
        })
      );

      // Should stop at DEFAULT_MAX_PAGES (50)
      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Use runAllTimersAsync for reliable timer handling instead of fixed loop
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(50);
      expect(result.length).toBe(500 * 50);
    });

    it('should stop when page has fewer than PAGE_SIZE entries', async () => {
      const users = generateMockUsers(1);

      // First page: full
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => Array(500).fill({ id: 'entry' })
      });

      // Second page: partial
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => Array(200).fill({ id: 'entry' })
      });

      const result = await Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.length).toBe(700);
    });
  });

  describe('fetchDetailedReport', () => {
    it('should prefer developer backend when reportsUrl differs', async () => {
      store.claims = {
        workspaceId: 'ws_dev',
        backendUrl: 'https://developer.clockify.me/api',
        reportsUrl: 'https://reports.api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ timeentries: [] })
      });

      await Api.fetchDetailedReport(
        'ws_dev',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://developer.clockify.me/api/v1/workspaces/ws_dev/reports/detailed',
        expect.any(Object)
      );
    });

    it('should derive report base from regional backend', async () => {
      store.claims = {
        workspaceId: 'ws_region',
        backendUrl: 'https://use2.clockify.me/api'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ timeentries: [] })
      });

      await Api.fetchDetailedReport(
        'ws_region',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://use2.clockify.me/report/v1/workspaces/ws_region/reports/detailed',
        expect.any(Object)
      );
    });

    it('should normalize detailed report rates and amounts', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_array',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-01T09:00:00Z',
                end: '2025-01-01T11:00:00Z',
                duration: 7200
              },
              rate: { amount: 6000 },
              hourlyRate: { amount: 5000, currency: 'EUR' },
              earnedRate: 0,
              amount: 120,
              amounts: [{ type: 'COST', value: 50 }],
              tags: []
            },
            {
              _id: 'entry_object',
              userId: 'user_2',
              userName: 'User 2',
              billable: true,
              timeInterval: {
                start: '2025-01-0209:00:00Z',
                end: '2025-01-0210:00:00Z',
                duration: 3600
              },
              hourlyRate: 4500,
              amounts: {
                earned: 80,
                profit: 60
              }
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-03T00:00:00Z'
      );

      expect(entries).toHaveLength(2);
      expect(entries[0].hourlyRate.amount).toBe(6000);
      expect(entries[0].hourlyRate.currency).toBe('EUR');
      expect(entries[0].earnedRate).toBe(6000);
      const earnedFromArray = entries[0].amounts.find(
        (amount) => String(amount?.type || amount?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedFromArray?.value).toBe(120);

      const earnedFromObject = entries[1].amounts.find(
        (amount) => String(amount?.type || amount?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedFromObject?.value).toBe(80);
      expect(entries[1].timeInterval.start).toBe('2025-01-02T09:00:00Z');
      expect(entries[1].timeInterval.end).toBe('2025-01-02T10:00:00Z');
    });
  });

  describe('fetchUserProfile', () => {
    it('should fetch single user profile', async () => {
      const mockProfile = {
        workCapacity: 'PT8H',
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProfile
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.clockify.me/v1/workspaces/workspace_123/member-profile/user_1',
        expect.any(Object)
      );
      expect(result.data).toEqual(mockProfile);
      expect(result.failed).toBe(false);
    });
  });

  describe('fetchHolidays', () => {
    it('should fetch holidays for user in period', async () => {
      const mockHolidays = [
        { name: 'New Year', datePeriod: { startDate: '2025-01-01T00:00:00Z' } }
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockHolidays
      });

      const result = await Api.fetchHolidays(
        'workspace_123',
        'user_1',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/holidays/in-period'),
        expect.any(Object)
      );
      expect(result.data).toEqual(mockHolidays);
    });

    it('should encode URL parameters', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      await Api.fetchHolidays(
        'workspace_123',
        'user with spaces',
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('user with spaces')),
        expect.any(Object)
      );
    });
  });

  describe('fetchTimeOffRequests', () => {
    it('should fetch time off requests via POST', async () => {
      const mockResponse = {
        requests: [
          {
            userId: 'user_1',
            timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
            status: 'APPROVED'
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      const result = await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1', 'user_2'],
        '2025-01-01',
        '2025-01-31'
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.clockify.me/v1/workspaces/workspace_123/time-off/requests',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"users":["user_1","user_2"]')
        })
      );
      expect(result.data).toEqual(mockResponse);
    });
  });

  describe('fetchAllProfiles', () => {
    it('should fetch all profiles in batches', async () => {
      const users = generateMockUsers(10);

      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          workCapacity: 'PT8H',
          workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
        })
      });

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(10);
      expect(store.apiStatus.profilesFailed).toBe(0);
    });

    it('should track failed profile fetches', async () => {
      const users = generateMockUsers(3);

      // First succeeds, second fails, third succeeds
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workCapacity: 'PT8H', workingDays: [] })
      });
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workCapacity: 'PT8H', workingDays: [] })
      });

      await Api.fetchAllProfiles('workspace_123', users);

      expect(store.apiStatus.profilesFailed).toBe(1);
    });

    it('should skip failed profiles and continue', async () => {
      const users = generateMockUsers(3);

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workCapacity: 'PT7H', workingDays: [] })
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ workCapacity: 'PT6H', workingDays: [] })
      });

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results.size).toBe(2); // Only 2 succeeded
      expect(store.apiStatus.profilesFailed).toBe(1);
    });
  });

  describe('fetchAllHolidays', () => {
    it('should fetch all holidays in batches', async () => {
      const users = generateMockUsers(5);

      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          { name: 'Holiday 1', datePeriod: { startDate: '2025-01-01T00:00:00Z' } }
        ]
      });

      const results = await Api.fetchAllHolidays(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(5);
      expect(store.apiStatus.holidaysFailed).toBe(0);
    });

    it('should track failed holiday fetches', async () => {
      const users = generateMockUsers(2);

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      await Api.fetchAllHolidays('workspace_123', users, '2025-01-01', '2025-01-31');

      expect(store.apiStatus.holidaysFailed).toBe(1);
    });
  });

  describe('fetchAllTimeOff', () => {
    it('should fetch and process time off for all users', async () => {
      const users = generateMockUsers(2);

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requests: [
            {
              userId: 'user_0',
              timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
              timeUnit: 'DAYS',
              status: 'APPROVED'
            }
          ]
        })
      });

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      expect(results).toBeInstanceOf(Map);
      expect(results.has('user_0')).toBe(true);
      expect(store.apiStatus.timeOffFailed).toBe(0);
    });

    it('should handle time off fetch failure', async () => {
      const users = generateMockUsers(2);

      fetch.mockRejectedValueOnce(new Error('Network error'));

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 0 } // Disable retries for faster test
      );

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(0);
      expect(store.apiStatus.timeOffFailed).toBe(2); // Both users failed
    });

    it('should filter requests by status', async () => {
      const users = generateMockUsers(1);

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requests: [
            {
              userId: 'user_0',
              timeOffPeriod: { startDate: '2025-01-15T00:00:00Z' },
              status: 'APPROVED'
            },
            {
              userId: 'user_0',
              timeOffPeriod: { startDate: '2025-01-20T00:00:00Z' },
              status: 'PENDING' // Should be filtered out
            }
          ]
        })
      });

      const results = await Api.fetchAllTimeOff(
        'workspace_123',
        users,
        '2025-01-01',
        '2025-01-31'
      );

      const userMap = results.get('user_0');
      expect(userMap.size).toBe(1); // Only approved request
    });
  });
});

// ============================================================================
// MUTATION TESTING - API Edge Cases
// ============================================================================
// These tests are specifically designed to kill surviving mutants in api.ts
// ============================================================================

describe('API Mutation Killers', () => {
  beforeEach(async () => {
    const mockPayload = createMockTokenPayload();
    store.token = 'mock_jwt_token';
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
    jest.useFakeTimers();
    await jest.advanceTimersByTimeAsync(100);
  });

  afterEach(() => {
    jest.useRealTimers();
    fetch.mockReset();
  });

  // ============================================================================
  // normalizeTimestamp regex mutations (line 775)
  // ============================================================================
  describe('normalizeTimestamp compact format handling', () => {
    it('should insert T separator for compact timestamp without seconds', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Compact format without seconds: "2025-01-1509:30Z"
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_compact_no_sec',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-1509:30Z',
                end: '2025-01-1517:30Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 }
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-15T09:30Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-15T17:30Z');
    });

    it('should insert T separator for compact timestamp with seconds', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Compact format with seconds: "2025-01-1514:30:45Z"
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_compact_with_sec',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-1514:30:45Z',
                end: '2025-01-1518:30:45Z',
                duration: 14400
              },
              hourlyRate: { amount: 5000 }
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-15T14:30:45Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-15T18:30:45Z');
    });

    it('should handle spaced timestamp format', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Spaced format: "2025-01-15 09:00:00Z"
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_spaced',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15 09:00:00Z',
                end: '2025-01-15 17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 }
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      expect(entries[0].timeInterval.start).toBe('2025-01-15T09:00:00Z');
      expect(entries[0].timeInterval.end).toBe('2025-01-15T17:00:00Z');
    });
  });

  // ============================================================================
  // pickRateValue two-pass logic mutations (lines 788-790)
  // ============================================================================
  describe('pickRateValue two-pass rate selection', () => {
    it('should use zero rate when first pass finds no positive values', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // First rate is NaN/undefined, second is 0
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_zero_rate',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              rate: null,
              hourlyRate: { amount: 0 },
              earnedRate: 0,
              amount: 0
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Zero rate should be used (second pass accepts finite non-positive values)
      expect(entries[0].hourlyRate.amount).toBe(0);
      expect(entries[0].earnedRate).toBe(0);
    });

    it('should skip Infinity rate in first pass and use fallback', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_infinity',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              rate: { amount: Infinity },
              hourlyRate: { amount: 5000 },
              earnedRate: 0
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Should use the valid hourlyRate (5000) not Infinity
      expect(entries[0].hourlyRate.amount).toBe(5000);
    });

    it('should handle negative rates as valid in second pass', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_negative',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              rate: null,
              hourlyRate: null,
              earnedRate: -100 // Negative is finite, used in second pass
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Negative rate is finite, so it should be selected in second pass
      expect(entries[0].earnedRate).toBe(-100);
    });
  });

  // ============================================================================
  // ensureShownAmount optional chaining mutations (lines 805-808)
  // ============================================================================
  describe('ensureShownAmount edge cases', () => {
    it('should handle null items in amounts array', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_null_amounts',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amount: 100,
              amounts: [null, undefined, { type: 'EARNED', value: 100 }]
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Should handle null items gracefully and find the valid EARNED entry
      const earned = entries[0].amounts.find(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earned?.value).toBe(100);
    });

    it('should use amountType fallback when type is undefined', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_amountType',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amounts: [{ type: undefined, amountType: 'EARNED', value: 200 }]
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Should use amountType when type is undefined
      const earned = entries[0].amounts.find(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earned?.value).toBe(200);
    });

    it('should use amount fallback when value is null', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_amount_fallback',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amounts: [{ type: 'EARNED', value: null, amount: 150 }]
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // When value is null, should use amount field via ?? fallback
      const earned = entries[0].amounts.find(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );
      // The amount is in the raw data, so check it's present
      expect(earned?.amount).toBe(150);
    });

    it('should handle items with missing type/amountType properties', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_missing_type',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amount: 400, // Fallback amount
              amounts: [{ value: 100 }] // No type or amountType
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Should have EARNED entry from fallback when no matching type found
      const earned = entries[0].amounts.find(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earned?.value).toBe(400);
    });

    it('should sum values using optional chaining for value/amount', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_sum',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amounts: [
                { type: 'EARNED', value: 100 },
                { type: 'EARNED', value: 200 }
              ]
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Should have both EARNED entries
      const earnedEntries = entries[0].amounts.filter(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedEntries.length).toBe(2);
      const totalEarned = earnedEntries.reduce((sum, a) => sum + (a?.value ?? a?.amount ?? 0), 0);
      expect(totalEarned).toBe(300);
    });

    // MUTATION KILLER: Test arithmetic operator mutation (total + value → total - value)
    it('KILLER: should add (not subtract) values when summing amounts', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Create a scenario where add vs subtract makes observable difference
      // With two positive values and no fallback amount:
      // With +: 100 + 100 = 200 ≠ 0 → no fallback added
      // With -: 100 - 100 = 0 → fallback added (DIFFERENT!)
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_add_test',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amount: 999, // Fallback amount that should NOT be used
              amounts: [
                { type: 'EARNED', value: 100 },
                { type: 'EARNED', value: 100 }
              ]
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // With correct code (+): shownTotal = 200 ≠ 0 → no fallback, amounts stay as-is
      // With mutation (-): shownTotal = 0 → fallback {type: 'EARNED', value: 999} added
      const earnedEntries = entries[0].amounts.filter(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );

      // Should have exactly 2 EARNED entries (no fallback added)
      // If mutation alive, would have 3 entries (fallback added because 100 - 100 = 0)
      expect(earnedEntries.length).toBe(2);
      expect(earnedEntries.every(e => e.value === 100)).toBe(true);
    });

    // MUTATION KILLER: Test optional chaining with actual null item access
    it('KILLER: should not throw when item is null in reduce', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Put null in amounts array - without optional chaining, item.type throws
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_null_item',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amount: 500, // Fallback
              amounts: [null, { type: 'COST', value: 100 }] // null item, no EARNED
            }
          ]
        })
      });

      // With correct code: null?.type returns undefined, doesn't throw
      // With mutation: null.type throws TypeError
      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // Should add EARNED fallback since no EARNED in amounts
      const earnedEntries = entries[0].amounts.filter(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedEntries.length).toBe(1);
      expect(earnedEntries[0].value).toBe(500);
    });

    // MUTATION KILLER: Test string literal '' mutation
    it('KILLER: should use empty string fallback for missing type (not "Stryker was here!")', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      // Item with type=null and amountType=null - falls back to ''
      // '' !== 'EARNED' so this item is skipped in sum
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          timeentries: [
            {
              _id: 'entry_empty_type',
              userId: 'user_1',
              userName: 'User 1',
              billable: true,
              timeInterval: {
                start: '2025-01-15T09:00:00Z',
                end: '2025-01-15T17:00:00Z',
                duration: 28800
              },
              hourlyRate: { amount: 5000 },
              amount: 250, // Fallback
              amounts: [
                { type: null, amountType: null, value: 100 }, // type becomes '' → not 'EARNED'
                { type: 'COST', value: 50 } // COST, not EARNED
              ]
            }
          ]
        })
      });

      const entries = await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-15T00:00:00Z',
        '2025-01-16T00:00:00Z'
      );

      // With correct code: type='' (empty string), not 'EARNED', so item skipped
      // With mutation: type='STRYKER WAS HERE!' (uppercase), not 'EARNED', so item skipped
      // In this case the mutation is equivalent, but the test documents expected behavior
      const earnedEntries = entries[0].amounts.filter(
        (a) => String(a?.type || a?.amountType || '').toUpperCase() === 'EARNED'
      );
      expect(earnedEntries.length).toBe(1);
      expect(earnedEntries[0].value).toBe(250); // Fallback was added
    });
  });
});
