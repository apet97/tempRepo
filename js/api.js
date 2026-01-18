/**
 * @fileoverview API Interaction Module
 * Handles all network communication with the Clockify API, including authentication,
 * rate limiting, pagination, and error handling.
 * 
 * Implements a strict token bucket rate limiter to comply with API limits.
 */

import { store } from './state.js';
import { IsoUtils, classifyError, createUserFriendlyError } from './utils.js';

// ==================== TYPE DEFINITIONS ====================

/**
 * @typedef {import('./constants.js').TimeEntry} TimeEntry
 * @typedef {import('./constants.js').User} User
 * @typedef {import('./constants.js').UserProfile} UserProfile
 * @typedef {import('./constants.js').Holiday} Holiday
 * @typedef {import('./constants.js').TimeOffRequest} TimeOffRequest
 * @typedef {import('./constants.js').FriendlyError} FriendlyError
 */

/** Base path for Clockify workspace API endpoints. */
const BASE_API = '/v1/workspaces';
/** Number of concurrent user requests to process in a batch. */
const BATCH_SIZE = 5;
/** Number of items to fetch per page. */
const PAGE_SIZE = 500;
/** Hard limit on pages to prevent infinite loops on massive datasets. */
const MAX_PAGES = 100;

// Rate Limiting State (Global)
/** Max requests allowed per refill interval. */
const RATE_LIMIT = 50;
/** Interval in ms to refill the token bucket. */
const REFILL_INTERVAL = 1000;
let tokens = RATE_LIMIT;
let lastRefill = Date.now();

/**
 * MEDIUM FIX #17: Reset rate limiter state.
 * Call this when switching workspaces or starting fresh.
 */
export function resetRateLimiter() {
    tokens = RATE_LIMIT;
    lastRefill = Date.now();
}

/**
 * Base fetch wrapper with authentication, rate limiting, and retry logic.
 * Implements a token bucket algorithm for rate limiting and exponential backoff for retries.
 * 
 * @param {string} url - Fully qualified URL to fetch.
 * @param {Object} options - Fetch options (method, headers, body, signal).
 * @param {number} [maxRetries] - Maximum retry attempts. Defaults to 2 in production, 0 in tests.
 * @returns {Promise<{data: any, failed: boolean, status: number}>} Response object containing data or error status.
 */
async function fetchWithAuth(url, options = {}, maxRetries) {
    // Default: 2 retries in production, 0 in tests
    const defaultMaxRetries = (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') ? 0 : 2;
    const retries = maxRetries !== undefined ? maxRetries : defaultMaxRetries;

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * Waits until a rate limit token is available.
     * Uses a non-recursive loop to prevent stack overflow during heavy throttling.
     */
    async function waitForToken() {
        while (true) {
            const now = Date.now();
            if (now - lastRefill >= REFILL_INTERVAL) {
                tokens = RATE_LIMIT;
                lastRefill = now;
            }

            if (tokens > 0) {
                tokens--;
                return;
            }

            const waitTime = REFILL_INTERVAL - (now - lastRefill);
            await delay(waitTime);
        }
    }

    await waitForToken();

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const headers = {
                'X-Addon-Token': store.token,
                'Content-Type': 'application/json',
                ...options.headers
            };

            const response = await fetch(url, { ...options, headers, signal: options.signal });

            // HIGH FIX #9: 401/403/404 are non-retryable errors
            if (response.status === 401 || response.status === 403 || response.status === 404) {
                return { data: null, failed: true, status: response.status };
            }

            // CRITICAL FIX #2: Handle Rate Limiting (429) with proper attempt tracking
            if (response.status === 429) {
                const retryAfterHeader = response.headers.get('Retry-After');
                let waitMs = 5000; // Default wait time if header is missing
                if (retryAfterHeader) {
                    const seconds = parseInt(retryAfterHeader, 10);
                    if (!isNaN(seconds)) {
                        waitMs = seconds * 1000;
                    }
                }
                // Check if we have retries left before continuing
                if (attempt < retries) {
                    console.warn(`Rate limit exceeded (attempt ${attempt + 1}/${retries + 1}). Retrying after ${waitMs}ms`);
                    await delay(waitMs);
                    continue;
                } else {
                    console.error('Rate limit exceeded, no retries left');
                    return { data: null, failed: true, status: 429 };
                }
            }

            if (!response.ok) {
                const error = new Error(`API Error: ${response.status}`);
                error.status = response.status;
                throw error;
            }

            return { data: await response.json(), failed: false, status: response.status };
        } catch (error) {
            const errorType = classifyError(error);

            // Don't retry auth errors (invalid token) or validation errors (bad request)
            if (errorType === 'AUTH_ERROR' || errorType === 'VALIDATION_ERROR') {
                console.error(`Fetch error (not retryable): ${errorType}`, error);
                return { data: null, failed: true, status: error.status || 0 };
            }

            // CRITICAL FIX #3: Use 'retries' (resolved value) instead of 'maxRetries'
            // Retry network/API errors with exponential backoff
            if (attempt < retries) {
                const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
                console.warn(`Retry ${attempt + 1}/${retries} after ${backoffTime}ms: ${url}`);
                await delay(backoffTime);
                continue;
            }

            // Final attempt failed
            console.error('Fetch error after retries:', error);
            return { data: null, failed: true, status: error.status || 0 };
        }
    }
    
    return { data: null, failed: true, status: 0 };
}

/**
 * Fetches all pages of time entries for a single user for a given date range.
 * Automatically handles pagination up to MAX_PAGES.
 * 
 * @param {string} workspaceId - The Clockify workspace ID.
 * @param {Object} user - The user object (must contain id and name).
 * @param {string} startIso - Start date in ISO format.
 * @param {string} endIso - End date in ISO format.
 * @param {Object} [options] - Fetch options (e.g. signal).
 * @returns {Promise<Array<TimeEntry>>} Flat list of all time entries for the user.
 */
async function fetchUserEntriesPaginated(workspaceId, user, startIso, endIso, options = {}) {
    const allEntries = [];
    let page = 1;

    while (page <= MAX_PAGES) {
        const url = `${store.claims.backendUrl}${BASE_API}/${workspaceId}/user/${user.id}/time-entries?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&hydrated=true&page=${page}&page-size=${PAGE_SIZE}`;

        const { data: entries, failed, status } = await fetchWithAuth(url, options);

        // HIGH FIX #10: Log pagination failures instead of silently breaking
        if (failed) {
            console.warn(`Failed to fetch entries for user ${user.name} (page ${page}), status: ${status}`);
            break;
        }

        if (!entries || !Array.isArray(entries) || entries.length === 0) break;

        // Enrich entries with user metadata immediately
        allEntries.push(...entries.map(e => ({ ...e, userId: user.id, userName: user.name })));

        if (entries.length < PAGE_SIZE) break; // Reached last page
        page++;
    }

    return allEntries;
}

export const Api = {
    /**
     * Fetch all users in the workspace.
     * @param {string} workspaceId - The Clockify workspace ID.
     * @returns {Promise<Array<User>>} List of users.
     */
    async fetchUsers(workspaceId) {
        const { data } = await fetchWithAuth(`${store.claims.backendUrl}${BASE_API}/${workspaceId}/users`);
        return data || [];
    },

    /**
     * Batched fetch of time entries for multiple users concurrently.
     * Processes users in chunks (BATCH_SIZE) to manage load.
     * 
     * @param {string} workspaceId - The Clockify workspace ID.
     * @param {Array<User>} users - List of users to fetch entries for.
     * @param {string} startIso - Start date ISO string.
     * @param {string} endIso - End date ISO string.
     * @param {Object} [options] - Fetch options including AbortSignal.
     * @returns {Promise<Array<TimeEntry>>} Combined list of all time entries.
     */
    async fetchEntries(workspaceId, users, startIso, endIso, options = {}) {
        const results = [];

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            console.log(`Fetching entries for users ${i + 1}-${Math.min(i + BATCH_SIZE, users.length)} of ${users.length}...`);

            const batchPromises = batch.map(user => fetchUserEntriesPaginated(workspaceId, user, startIso, endIso, options));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.flat());
        }

        return results;
    },

    /**
     * Fetch a single user's profile settings (capacity, working days).
     * @param {string} workspaceId - The workspace ID.
     * @param {string} userId - The user ID.
     * @param {Object} [options] - Fetch options.
     * @returns {Promise<{data: UserProfile, failed: boolean, status: number}>} Response object.
     */
    async fetchUserProfile(workspaceId, userId, options = {}) {
        const { data, failed, status } = await fetchWithAuth(`${store.claims.backendUrl}${BASE_API}/${workspaceId}/member-profile/${userId}`, options);
        return { data, failed, status };
    },

    /**
     * Fetch holidays assigned to a specific user within a date period.
     * @param {string} workspaceId 
     * @param {string} userId 
     * @param {string} startIso - Full ISO string, but API uses YYYY-MM-DD.
     * @param {string} endIso 
     * @param {Object} [options] 
     * @returns {Promise<{data: Array<Holiday>, failed: boolean, status: number}>}
     */
    async fetchHolidays(workspaceId, userId, startIso, endIso, options = {}) {
        // API expects YYYY-MM-DD for holiday endpoints
        const start = startIso.split('T')[0];
        const end = endIso.split('T')[0];
        
        const { data, failed, status } = await fetchWithAuth(
            `${store.claims.backendUrl}${BASE_API}/${workspaceId}/holidays/in-period?assigned-to=${encodeURIComponent(userId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
            options
        );
        return { data, failed, status };
    },

    /**
     * Fetch approved time off requests for multiple users via POST endpoint.
     * 
     * @param {string} workspaceId
     * @param {Array<string>} userIds
     * @param {string} startDate
     * @param {string} endDate
     * @param {Object} [options] - Options including retry configuration
     * @returns {Promise<{data: Object, failed: boolean, status: number}>} Data contains `requests` array.
     */
    async fetchTimeOffRequests(workspaceId, userIds, startDate, endDate, options = {}) {
        // Use POST endpoint for time-off requests to filter by specific users and status
        const url = `${store.claims.backendUrl}${BASE_API}/${workspaceId}/time-off/requests`;
        const body = {
            page: 1,
            pageSize: 200,
            users: userIds,
            statuses: ['APPROVED'],
            dateRangeStart: startDate,
            dateRangeEnd: endDate
        };

        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
        const { data, failed, status } = await fetchWithAuth(url, {
            method: 'POST',
            body: JSON.stringify(body),
            ...options
        }, maxRetries);

        return { data, failed, status };
    },

    /**
     * Batched fetch of all user profiles.
     * Updates `store.apiStatus.profilesFailed` to track partial failures.
     * 
     * @param {string} workspaceId
     * @param {Array<User>} users
     * @param {Object} [options]
     * @returns {Promise<Map<string, UserProfile>>} Map of userId -> profileData
     */
    async fetchAllProfiles(workspaceId, users, options = {}) {
        const results = new Map();
        let failedCount = 0;

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async user => {
                const { data, failed } = await this.fetchUserProfile(workspaceId, user.id, options);
                return { userId: user.id, data, failed };
            });
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ userId, data, failed }) => {
                if (failed) failedCount++;
                if (data) results.set(userId, data);
            });
        }

        store.apiStatus.profilesFailed = failedCount;
        return results;
    },

    /**
     * Batched fetch of all holidays for all users.
     * Updates `store.apiStatus.holidaysFailed`.
     * 
     * @param {string} workspaceId
     * @param {Array<User>} users
     * @param {string} startDate
     * @param {string} endDate
     * @param {Object} [options]
     * @returns {Promise<Map<string, Array<Holiday>>>} Map of userId -> Array of Holidays
     */
    async fetchAllHolidays(workspaceId, users, startDate, endDate, options = {}) {
        const results = new Map();
        let failedCount = 0;
        const startIso = `${startDate}T00:00:00Z`;
        const endIso = `${endDate}T23:59:59Z`;

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async user => {
                const { data, failed } = await this.fetchHolidays(workspaceId, user.id, startIso, endIso, options);
                return { userId: user.id, data, failed };
            });
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ userId, data, failed }) => {
                if (failed) failedCount++;
                if (data) results.set(userId, data);
            });
        }

        store.apiStatus.holidaysFailed = failedCount;
        return results;
    },

    /**
     * Fetches and processes time off for all users.
     * Returns a structured Map for easy lookup during calculation.
     * 
     * @param {string} workspaceId
     * @param {Array<User>} users
     * @param {string} startDate
     * @param {string} endDate
     * @param {Object} [options] - Options including retry configuration
     * @returns {Promise<Map<string, Map<string, {hours: number, isFullDay: boolean}>>>} 
     *          Map<userId, Map<dateKey, {hours, isFullDay}>>
     */
    async fetchAllTimeOff(workspaceId, users, startDate, endDate, options = {}) {
        const userIds = users.map(u => u.id);
        const fetchOptions = { maxRetries: options.maxRetries, signal: options.signal };
        const { data, failed } = await this.fetchTimeOffRequests(workspaceId, userIds, startDate, endDate, fetchOptions);

        if (failed) {
            store.apiStatus.timeOffFailed = users.length;
            return new Map();
        }

        // Build per-user per-date map
        const results = new Map();
        const requests = data?.requests || [];

        requests.forEach(request => {
            // Filter by status - only process approved requests
            if (request.status !== 'APPROVED') return;

            const userId = request.userId || request.requesterUserId;
            if (!userId) return;

            if (!results.has(userId)) results.set(userId, new Map());
            const userMap = results.get(userId);

            const period = request.timeOffPeriod || {};
            const startKey = IsoUtils.extractDateKey(period.start || period.startDate);
            const endKey = IsoUtils.extractDateKey(period.end || period.endDate);

            if (startKey) {
                const isFullDay = !period.halfDay && (request.timeUnit === 'DAYS' || !period.halfDayHours);
                // Initialize start date
                userMap.set(startKey, { isFullDay, hours: 0 });

                // Handle multi-day time off
                if (endKey && endKey !== startKey) {
                    const dateRange = IsoUtils.generateDateRange(startKey, endKey);
                    dateRange.forEach(dateKey => {
                        if (!userMap.has(dateKey)) {
                            userMap.set(dateKey, { isFullDay, hours: 0 });
                        }
                    });
                }
            }
        });

        store.apiStatus.timeOffFailed = 0;
        return results;
    }
};