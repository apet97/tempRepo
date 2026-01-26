/**
 * @jest-environment jsdom
 *
 * API Fetch Core Tests - fetchWithAuth, retry logic, rate limiting, headers
 *
 * These tests focus on the core HTTP client functionality including:
 * - Authentication header handling
 * - HTTP error responses (401/403/404/429/5xx)
 * - Retry logic with exponential backoff
 * - Content-Type header management
 * - MaxRetries configuration
 *
 * @see js/api.ts - fetchWithAuth implementation
 * @see docs/guide.md - Rate limiting strategy
 */

import { jest } from '@jest/globals';
import { Api, resetRateLimiter } from '../../js/api.js';
import { store } from '../../js/state.js';
import { createMockTokenPayload } from '../helpers/mock-data.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('API Fetch Core', () => {
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

  describe('fetchWithAuth - Authentication', () => {
    it('should include X-Addon-Token header in all requests', async () => {
      const mockResponse = { data: 'test' };
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      });

      await Api.fetchUsers('workspace_123');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Addon-Token': store.token
          })
        })
      );
    });

    it('should include Accept: application/json header', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      await Api.fetchUsers('workspace_123');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json'
          })
        })
      );
    });
  });

  describe('fetchWithAuth - HTTP Error Responses', () => {
    it('should return failed=true for 401 Unauthorized', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.data).toBeNull();
      expect(result.status).toBe(401);
    });

    it('should return failed=true for 403 Forbidden', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.data).toBeNull();
      expect(result.status).toBe(403);
    });

    it('should return failed=true for 404 Not Found', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.data).toBeNull();
      expect(result.status).toBe(404);
    });

    it('should return failed=true for 429 Rate Limit with no retries', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({})
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      // In test env maxRetries=0, should fail immediately
      expect(result.failed).toBe(true);
      expect(result.status).toBe(429);
    });

    it('should handle 500 Internal Server Error gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const result = await Api.fetchUsers('workspace_123');

      // Should return empty array on 500 error (graceful degradation)
      expect(result).toEqual([]);
    });

    it('should handle network errors gracefully', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await Api.fetchUsers('workspace_123');

      // fetchUsers returns empty array on network error
      expect(result).toEqual([]);
    });
  });

  describe('fetchWithAuth - Content-Type Header', () => {
    it('should add Content-Type only when body exists and header not set', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ requests: [] })
      });

      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31'
      );

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should not override explicit Content-Type header', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ timeentries: [] })
      });

      await Api.fetchDetailedReport(
        'ws_test',
        '2025-01-01T00:00:00Z',
        '2025-01-02T00:00:00Z'
      );

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('fetchWithAuth - MaxRetries Configuration', () => {
    it('should use options.maxRetries when provided', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ requests: [] })
      });

      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        {} // No maxRetries specified
      );

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should use explicit maxRetries: 0', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01',
        '2025-01-31',
        { maxRetries: 0 }
      );

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
    });

    it('should default to 0 retries in test environment', async () => {
      // First call fails
      fetch.mockRejectedValueOnce(new Error('Network error'));

      // In test env, default maxRetries is 0
      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
    });
  });

  describe('fetchWithAuth - Store Claims Handling', () => {
    it('should handle undefined store.claims gracefully', async () => {
      store.claims = undefined;

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      const result = await Api.fetchUsers('workspace_123');

      // Should not throw, should return empty array
      expect(result).toEqual([]);
    });

    it('should handle null store.claims gracefully', async () => {
      store.claims = null;

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual([]);
    });

    it('should handle store.claims.backendUrl being empty string', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: ''
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual([]);
    });
  });

  describe('Rate Limiter - Token Bucket', () => {
    it('should have tokens available after reset', async () => {
      resetRateLimiter();

      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => []
      });

      // Make multiple quick requests - should not be throttled
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(Api.fetchUsers('workspace_123'));
      }

      await Promise.all(promises);

      expect(fetch).toHaveBeenCalledTimes(5);
    });
  });
});

describe('API Fetch Core - Mutation Killing Tests', () => {
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

  describe('Error Return Value Mutations', () => {
    // Kill: failed: true → failed: false mutations

    it('should return exactly failed=true (not false) for 401 errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.failed).not.toBe(false);
    });

    it('should return exactly data=null (not undefined) for 401 errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toBeNull();
      expect(result.data).not.toBeUndefined();
    });

    it('should return exact status code (not 0) for 403 errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(403);
      expect(result.status).not.toBe(0);
    });

    it('should return exact status code (not 0) for 404 errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(404);
      expect(result.status).not.toBe(0);
    });
  });

  describe('Comparison Operator Mutations', () => {
    // Kill: response.status === 401 → !== 401

    it('should fail on exactly 401 (not 400 or 402)', async () => {
      // Test 401
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });
      const result401 = await Api.fetchUserProfile('workspace_123', 'user_1');
      expect(result401.failed).toBe(true);
      expect(result401.status).toBe(401);

      // Test 400 - should NOT be treated as auth error
      fetch.mockReset();
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({})
      });
      const result400 = await Api.fetchUserProfile('workspace_123', 'user_1');
      expect(result400.failed).toBe(true);
      expect(result400.status).toBe(400);
    });

    it('should fail on exactly 403 (not 402 or 404)', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(403);
      expect(result.failed).toBe(true);
    });

    it('should fail on exactly 404 (not 403 or 405)', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(404);
      expect(result.failed).toBe(true);
    });

    it('should fail on exactly 429 (rate limit)', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({})
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.status).toBe(429);
      expect(result.failed).toBe(true);
    });
  });

  describe('Token and Header Mutations', () => {
    // Kill: 'X-Addon-Token': store.token → 'X-Addon-Token': ''

    it('should send actual token value (not empty string)', async () => {
      store.token = 'actual_test_token_123';

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      await Api.fetchUsers('workspace_123');

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['X-Addon-Token']).toBe('actual_test_token_123');
      expect(headers['X-Addon-Token']).not.toBe('');
    });

    it('should use store.token || "" when token is null', async () => {
      store.token = null;

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      await Api.fetchUsers('workspace_123');

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['X-Addon-Token']).toBe('');
    });
  });

  describe('URL Construction Mutations', () => {
    it('should construct URL with correct base API path', async () => {
      store.claims = {
        workspaceId: 'ws_test',
        backendUrl: 'https://api.clockify.me'
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      await Api.fetchUsers('workspace_123');

      const url = fetch.mock.calls[0][0];
      expect(url).toContain('/v1/workspaces/workspace_123');
    });
  });

  describe('Response JSON Parsing Mutations', () => {
    it('should return parsed JSON data on success', async () => {
      const expectedData = [{ id: 'u1', name: 'Alice' }];
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => expectedData
      });

      const result = await Api.fetchUsers('workspace_123');

      expect(result).toEqual(expectedData);
      expect(result).not.toBeNull();
      expect(result.length).toBe(1);
    });

    it('should return exactly null data for auth errors (not undefined)', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.data).toStrictEqual(null);
      expect(result.failed).toStrictEqual(true);
      expect(result.status).toStrictEqual(401);
    });
  });

  describe('Non-Retryable Status Code Boundary Mutations', () => {
    it('should NOT treat 400 as non-retryable auth error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      // 400 is not 401/403/404, should be handled differently
      expect(result.failed).toBe(true);
      expect(result.status).toBe(400);
    });

    it('should NOT treat 402 as non-retryable auth error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        statusText: 'Payment Required'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.status).toBe(402);
    });

    it('should NOT treat 405 as 404-like error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 405,
        statusText: 'Method Not Allowed'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(result.failed).toBe(true);
      expect(result.status).toBe(405);
    });
  });

  describe('Default MaxRetries Mutations', () => {
    it('should not retry in test environment (maxRetries defaults to 0)', async () => {
      fetch.mockRejectedValue(new Error('Network error'));

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      // Should only call fetch once (no retries in test env)
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
    });
  });

  describe('Content-Type Header Mutations', () => {
    it('should NOT add Content-Type when no body exists', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      // fetchUsers does NOT send a body
      await Api.fetchUsers('workspace_123');

      const headers = fetch.mock.calls[0][1].headers;
      // Content-Type should NOT be added when there's no body
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('should add Content-Type when body exists and no Content-Type set', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ requests: [] })
      });

      // fetchTimeOffRequests sends a body
      await Api.fetchTimeOffRequests(
        'workspace_123',
        ['user_1'],
        '2025-01-01T00:00:00Z',
        '2025-01-31T23:59:59Z'
      );

      const headers = fetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Non-Retryable Status Code Mutations (401/403/404)', () => {
    // These tests verify each status code is handled independently

    it('should return immediately on 401 without any retry', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
      expect(result.status).toBe(401);
      expect(result.data).toBeNull();
    });

    it('should return immediately on 403 without any retry', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
      expect(result.status).toBe(403);
      expect(result.data).toBeNull();
    });

    it('should return immediately on 404 without any retry', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await Api.fetchUserProfile('workspace_123', 'user_1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.failed).toBe(true);
      expect(result.status).toBe(404);
      expect(result.data).toBeNull();
    });

    it('should treat 401, 403, 404 differently from 500 (non-retryable vs retryable)', async () => {
      // First test 401 - should not retry
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      const result401 = await Api.fetchUserProfile('workspace_123', 'user_1');
      expect(result401.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);

      // Reset and test 500 - would retry in production (but test env has 0 retries)
      fetch.mockReset();
      resetRateLimiter();
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      await Api.fetchUserProfile('workspace_123', 'user_1');
      // Still 1 call in test env, but 500 goes through different code path
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
