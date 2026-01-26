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

