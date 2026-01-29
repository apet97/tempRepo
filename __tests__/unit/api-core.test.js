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

describe('API Module - Core Behaviors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimiter();
    store.resetThrottleStatus();
    store.token = 'test-token';
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.com',
      reportsUrl: 'https://reports.api.clockify.me'
    };
  });

  afterEach(() => {
    standardAfterEach();
    store.token = null;
    store.claims = null;
    global.fetch = mockFetch;
  });

  it('fetchUsers returns data and includes auth header', async () => {
    const users = [
      { id: 'user1', name: 'Alice' },
      { id: 'user2', name: 'Bob' }
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(users)
    });

    const result = await Api.fetchUsers('ws_test');
    expect(result).toEqual(users);
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['X-Addon-Token']).toBe('test-token');
  });

  it('fetchUsers returns empty array on failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500
    });

    const result = await Api.fetchUsers('ws_test');
    expect(result).toEqual([]);
  });

  it('fetchEntries attaches user metadata to entries', async () => {
    const users = [{ id: 'user1', name: 'Alice' }];

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            id: 'entry1',
            timeInterval: { start: '2025-01-01T09:00:00Z', end: '2025-01-01T17:00:00Z' }
          }
        ])
    });

    const result = await Api.fetchEntries(
      'ws_test',
      users,
      '2025-01-01T00:00:00Z',
      '2025-01-31T23:59:59Z'
    );
    expect(result[0].userId).toBe('user1');
    expect(result[0].userName).toBe('Alice');
  });

  it('fetchUserProfile marks non-OK responses as failed', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404
    });

    const result = await Api.fetchUserProfile('ws_test', 'user1');
    expect(result.failed).toBe(true);
    expect(result.status).toBe(404);
  });

  it('fetchTimeOffRequests uses POST and passes users list', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ requests: [] })
    });

    await Api.fetchTimeOffRequests('ws_test', ['user1'], '2025-01-01', '2025-01-31');
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.users).toEqual(['user1']);
  });
});
