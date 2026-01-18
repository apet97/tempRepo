/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import { Api } from '../../js/api.js';
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

    // Clear all mocks
    fetch.mockClear();
    
    // Enable fake timers and advance time to ensure rate limit tokens are refilled
    jest.useFakeTimers();
    await jest.advanceTimersByTimeAsync(1000); 
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
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
    });

    it('should stop at max pages', async () => {
      const users = generateMockUsers(1);

      // Set up mock to return full page for all calls (will be called up to MAX_PAGES times)
      fetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => Array(500).fill({ id: 'entry' })
        })
      );

      // Should stop at MAX_PAGES (100)
      const promise = Api.fetchEntries(
        'workspace_123',
        users,
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      // Advance timers repeatedly to clear rate limit delays
      for (let i = 0; i < 110; i++) {
          await jest.advanceTimersByTimeAsync(1000);
      }

      const result = await promise;

      expect(fetch).toHaveBeenCalledTimes(100);
      expect(result.length).toBe(500 * 100);
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
