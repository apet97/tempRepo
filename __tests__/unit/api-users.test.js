/**
 * @jest-environment jsdom
 *
 * API Users Tests - fetchUsers, fetchUserProfile, fetchAllProfiles
 *
 * These tests focus on user-related API operations including:
 * - Fetching workspace users
 * - Fetching individual user profiles
 * - Batched profile fetching
 * - Error tracking for failed profiles
 *
 * @see js/api.ts - User API operations
 * @see docs/guide.md - API constraints
 */

import { jest } from '@jest/globals';
import { Api, resetRateLimiter } from '../../js/api.js';
import { store } from '../../js/state.js';
import { generateMockUsers, createMockTokenPayload } from '../helpers/mock-data.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('API Users', () => {
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

    it('should return empty array on 403 error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual([]);
    });

    it('should return empty array on 401 error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual([]);
    });

    it('should return empty array when data is null', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => null
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual([]);
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

    it('should return failed=true on 403 error', async () => {
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

    it('should return failed=true on 404 error', async () => {
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

    it('should handle empty users array', async () => {
      const users = [];

      fetch.mockImplementation(() => {
        throw new Error('Should not be called for empty users');
      });

      const profiles = await Api.fetchAllProfiles('workspace_123', users);

      expect(profiles.size).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

describe('API Users - Batch Processing Mutations', () => {
  beforeEach(async () => {
    const mockPayload = createMockTokenPayload();
    store.token = 'mock_jwt_token';
    store.claims = mockPayload;
    store.resetApiStatus();
    fetch.mockReset();
    resetRateLimiter();
  });

  afterEach(() => {
    fetch.mockReset();
  });

  describe('Loop Boundary Edge Cases - Kill Mutants', () => {
    it('should correctly slice batch at BATCH_SIZE boundary', async () => {
      // Kill: users.slice(i, i + BATCH_SIZE) → users
      // With 7 users (> BATCH_SIZE=5), if slice returns full array,
      // each batch would process all 7 instead of the correct subset
      const users = generateMockUsers(7);
      const fetchCalls = [];

      fetch.mockImplementation((url) => {
        fetchCalls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ workCapacity: 'PT8H', workingDays: [] })
        });
      });

      await Api.fetchAllProfiles('workspace_123', users);

      // Should make 7 calls total (processes each user)
      expect(fetchCalls.length).toBe(7);

      // Extract user IDs from URLs (pattern: /member-profile/{userId})
      const userIdsFromCalls = fetchCalls.map(url => {
        const match = url.match(/\/member-profile\/([^/]+)/);
        return match ? match[1] : null;
      }).filter(Boolean);

      // All 7 users should be called
      expect(userIdsFromCalls.length).toBe(7);
      // Each user should appear exactly once (not duplicated due to broken slice)
      const uniqueIds = new Set(userIdsFromCalls);
      expect(uniqueIds.size).toBe(7);
    });

    it('should process exactly BATCH_SIZE users without going out of bounds', async () => {
      // Kill: i < users.length → i <= users.length
      // With exactly 5 users (BATCH_SIZE), <= would cause an extra iteration
      const users = generateMockUsers(5);
      let callCount = 0;

      fetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            workCapacity: 'PT8H',
            workingDays: []
          })
        });
      });

      const results = await Api.fetchAllProfiles('workspace_123', users);

      // Should call fetch exactly 5 times (one per user)
      expect(callCount).toBe(5);
      expect(results.size).toBe(5);
    });

    it('should handle users.slice correctly at batch boundary', async () => {
      // Kill: users.slice(i, i + BATCH_SIZE) → users (full array)
      const users = generateMockUsers(6); // 6 users = 2 batches (5 + 1)
      const batchSizes = [];

      fetch.mockImplementation(async () => {
        batchSizes.push(1);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            workCapacity: 'PT8H',
            workingDays: []
          })
        };
      });

      await Api.fetchAllProfiles('workspace_123', users);

      // Should process 5 in first batch, 1 in second batch
      expect(batchSizes.length).toBe(6); // 5 + 1 calls
    });
  });

  describe('Failed Count Tracking Mutations', () => {
    // Kill: failedCount++ → failedCount-- or failedCount += 0

    it('should increment failed count exactly by 1 for each failure', async () => {
      const users = generateMockUsers(3);

      // All fail
      fetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      await Api.fetchAllProfiles('workspace_123', users);

      expect(store.apiStatus.profilesFailed).toBe(3);
    });

    it('should count exact number of failures (not more, not less)', async () => {
      const users = generateMockUsers(5);

      // 2 succeed, 3 fail
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
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({})
      });

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(store.apiStatus.profilesFailed).toBe(3);
      expect(results.size).toBe(2);
    });
  });

  describe('Map Operations Mutations', () => {
    // Kill: results.set(userId, data) → results.delete(userId)

    it('should store profile data in results map', async () => {
      const users = generateMockUsers(2);
      const profile1 = { workCapacity: 'PT8H', workingDays: ['MONDAY'] };
      const profile2 = { workCapacity: 'PT6H', workingDays: ['TUESDAY'] };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => profile1
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => profile2
      });

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results.has('user0')).toBe(true);
      expect(results.has('user1')).toBe(true);
      expect(results.get('user0')).toEqual(profile1);
      expect(results.get('user1')).toEqual(profile2);
    });

    it('should not store data for failed requests', async () => {
      const users = generateMockUsers(2);

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

      const results = await Api.fetchAllProfiles('workspace_123', users);

      expect(results.has('user0')).toBe(false);
      expect(results.has('user1')).toBe(true);
    });
  });
});
