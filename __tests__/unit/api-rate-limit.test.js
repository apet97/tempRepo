/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';

let Api;

describe('API Rate Limiting', () => {
    let originalEnv;

    beforeAll(async () => {
        // Mock State
        jest.unstable_mockModule('../../js/state.js', () => ({
            store: {
                token: 'test-token',
                claims: { backendUrl: 'https://api.test' },
                apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 }
            }
        }));

        // Import Api after mocking
        const apiModule = await import('../../js/api.js');
        Api = apiModule.Api;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn();
        jest.useFakeTimers();
        originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production'; // Enable retries by default
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        jest.useRealTimers();
    });

    it('should retry on 429 Too Many Requests', async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                headers: { get: () => '1' } // Retry-After: 1s
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ id: 'user1' })
            });

        const fetchPromise = Api.fetchUserProfile('ws1', 'user1');
        
        // Fast-forward time (1s)
        await jest.advanceTimersByTimeAsync(1000);
        
        await fetchPromise;

        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should use default wait time if Retry-After is missing', async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                headers: { get: () => null } // No Retry-After
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ id: 'user1' })
            });

        const fetchPromise = Api.fetchUserProfile('ws1', 'user1');
        
        // Advance timers by default wait time (5000ms)
        await jest.advanceTimersByTimeAsync(5000);
        
        await fetchPromise;
        
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});