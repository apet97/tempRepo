/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Api } from '../../js/api.js';
import { store } from '../../js/state.js';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('API Module - Core Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      expect(userMap).toBeDefined();
      expect(userMap.has('2025-01-15')).toBe(true);
    });
  });
});
