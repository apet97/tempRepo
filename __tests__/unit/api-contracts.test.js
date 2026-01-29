/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Api, resetRateLimiter } from '../../js/api.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

// Mock global fetch
global.fetch = jest.fn();

describe('API Contracts (behavioral)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimiter();
    store.token = 'test-token';
    store.claims = {
      workspaceId: 'ws_test',
      backendUrl: 'https://api.clockify.me',
      reportsUrl: 'https://reports.api.clockify.me'
    };
    store.config.maxPages = undefined;
  });

  afterEach(() => {
    standardAfterEach();
    store.token = null;
    store.claims = null;
    store.config.maxPages = undefined;
  });

  it('fetchDetailedReport posts expected payload and headers', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ timeentries: [] }),
      headers: new Map()
    });

    await Api.fetchDetailedReport(
      'ws_test',
      '2025-01-01T00:00:00Z',
      '2025-01-31T23:59:59Z'
    );

    const [url, options] = fetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(url).toContain('/v1/workspaces/ws_test/reports/detailed');
    expect(options.method).toBe('POST');
    expect(options.headers['X-Addon-Token']).toBe('test-token');
    expect(options.headers.Accept).toBe('application/json');
    expect(body.amountShown).toBe('EARNED');
    expect(body.amounts).toEqual(['EARNED', 'COST', 'PROFIT']);
    expect(body.detailedFilter.pageSize).toBe(200);
    expect(body.detailedFilter.page).toBe(1);
  });

  it('fetchDetailedReport accepts timeEntries casing and normalizes duration', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        timeEntries: [
          {
            id: 'entry_1',
            userId: 'user_1',
            userName: 'User 1',
            billable: true,
            timeInterval: {
              start: '2025-01-10T09:00:00Z',
              end: '2025-01-10T10:00:00Z',
              duration: 3600
            },
            hourlyRate: { amount: 5000, currency: 'USD' }
          }
        ]
      }),
      headers: new Map()
    });

    const entries = await Api.fetchDetailedReport(
      'ws_test',
      '2025-01-01T00:00:00Z',
      '2025-01-31T23:59:59Z'
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].timeInterval.duration).toBe('PT3600S');
    expect(entries[0].hourlyRate.amount).toBe(5000);
  });

  it('fetchEntries paginates with page-size=500 in the request URL', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
      headers: new Map()
    });

    await Api.fetchEntries(
      'ws_test',
      [{ id: 'user_1', name: 'User 1' }],
      '2025-01-01T00:00:00Z',
      '2025-01-31T23:59:59Z'
    );

    const [url] = fetch.mock.calls[0];
    expect(url).toContain('page-size=500');
  });
});
