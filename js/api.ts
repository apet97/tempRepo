/**
 * @fileoverview API Interaction Module
 * Handles all network communication with the Clockify API, including authentication,
 * rate limiting, pagination, and error handling.
 *
 * Implements a strict token bucket rate limiter to comply with API limits.
 */

import { store } from './state.js';
import { IsoUtils, classifyError } from './utils.js';
import { DEFAULT_MAX_PAGES, HARD_MAX_PAGES_LIMIT } from './constants.js';
import type {
    TimeEntry,
    User,
    Holiday,
    TimeOffRequest,
    TimeOffInfo,
    ApiResponse,
} from './types.js';

// ==================== CONSTANTS ====================

/** Base path for Clockify workspace API endpoints. */
const BASE_API = '/v1/workspaces';
/** Number of concurrent user requests to process in a batch. */
const BATCH_SIZE = 5;
/** Number of items to fetch per page. */
const PAGE_SIZE = 500;

// Rate Limiting State (Global)
/** Max requests allowed per refill interval. */
const RATE_LIMIT = 50;
/** Interval in ms to refill the token bucket. */
const REFILL_INTERVAL = 1000;
let tokens = RATE_LIMIT;
let lastRefill = Date.now();

// ==================== URL RESOLUTION ====================

/**
 * Resolve the Reports API base URL using token claims and backend URL defaults.
 * Handles developer portal and regional report prefixes when reportsUrl is absent.
 */
function resolveReportsBaseUrl(): string {
    const reportsUrlClaim = store.claims?.reportsUrl;
    const backendUrl = store.claims?.backendUrl || '';
    const normalizedBackend = backendUrl.replace(/\/+$/, '');
    let backendHost = '';
    let backendOrigin = '';
    let backendPath = '';

    if (normalizedBackend) {
        try {
            const backend = new URL(normalizedBackend);
            backendHost = backend.host.toLowerCase();
            backendOrigin = backend.origin;
            backendPath = backend.pathname.replace(/\/+$/, '');
        } catch {
            // Ignore parse errors and fall back to defaults.
        }
    }

    if (reportsUrlClaim) {
        const normalizedReports = reportsUrlClaim.replace(/\/+$/, '');
        if (backendHost === 'developer.clockify.me') {
            try {
                const reportsHost = new URL(normalizedReports).host.toLowerCase();
                if (reportsHost !== backendHost && normalizedBackend) {
                    return normalizedBackend;
                }
            } catch {
                if (normalizedBackend) return normalizedBackend;
            }
        }
        return normalizedReports;
    }

    if (backendHost === 'developer.clockify.me' && normalizedBackend) {
        return normalizedBackend;
    }

    if (backendHost === 'api.clockify.me') {
        return 'https://reports.api.clockify.me';
    }

    if (backendHost.endsWith('clockify.me') && backendOrigin) {
        if (backendPath.endsWith('/api')) {
            return `${backendOrigin}${backendPath.replace(/\/api$/, '/report')}`;
        }
        return `${backendOrigin}/report`;
    }

    return 'https://reports.api.clockify.me';
}

// ==================== TYPE DEFINITIONS ====================

/**
 * Fetch options with optional abort signal
 */
interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    maxRetries?: number;
}

/**
 * Raw API profile response
 */
interface RawProfileResponse {
    workCapacity?: string;
    workingDays?: string[];
}

/**
 * Raw holiday response from API
 */
interface RawHoliday {
    name?: string;
    datePeriod?: {
        startDate?: string;
        endDate?: string;
    };
    projectId?: string;
}

/**
 * Raw time off response
 */
interface RawTimeOffResponse {
    requests?: TimeOffRequest[];
    timeOffRequests?: TimeOffRequest[];
}

/**
 * Detailed report entry from API
 */
interface DetailedReportEntry {
    _id?: string;
    id?: string;
    description?: string;
    userId?: string;
    userName?: string;
    billable?: boolean;
    projectId?: string;
    projectName?: string;
    clientId?: string | null;
    clientName?: string | null;
    taskId?: string;
    taskName?: string;
    type?: string;
    timeInterval?: {
        start?: string;
        end?: string;
        duration?: number;
    };
    rate?: number | { amount?: number };
    hourlyRate?: number | { amount?: number; currency?: string };
    earnedRate?: number;
    costRate?: number;
    amount?: number;
    amounts?: Array<{ type?: string; amountType?: string; value?: number; amount?: number }>;
    tags?: Array<{ id?: string; name?: string }>;
}

/**
 * Detailed report API response
 */
interface DetailedReportResponse {
    timeentries?: DetailedReportEntry[];
    timeEntries?: DetailedReportEntry[];
}

// ==================== RATE LIMITER ====================

/**
 * Reset rate limiter state.
 * Call this when switching workspaces or starting fresh.
 */
export function resetRateLimiter(): void {
    tokens = RATE_LIMIT;
    lastRefill = Date.now();
}

// ==================== FETCH WITH AUTH ====================

/**
 * Base fetch wrapper with authentication, rate limiting, and retry logic.
 * Implements a token bucket algorithm for rate limiting and exponential backoff for retries.
 *
 * @param url - Fully qualified URL to fetch.
 * @param options - Fetch options (method, headers, body, signal).
 * @param maxRetries - Maximum retry attempts. Defaults to 2 in production, 0 in tests.
 * @returns Response object containing data or error status.
 */
async function fetchWithAuth<T>(
    url: string,
    options: FetchOptions = {},
    maxRetries?: number
): Promise<ApiResponse<T>> {
    // Default: 2 retries in production, 0 in tests
    const defaultMaxRetries =
        typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 0 : 2;
    const retries = maxRetries !== undefined ? maxRetries : defaultMaxRetries;

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * Waits until a rate limit token is available.
     * Uses a non-recursive loop to prevent stack overflow during heavy throttling.
     */
    async function waitForToken(): Promise<void> {
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
            // Merge auth headers with any caller-provided overrides, ensuring JSON responses are accepted
            const headers: Record<string, string> = {
                'X-Addon-Token': store.token || '',
                Accept: 'application/json',
                ...options.headers,
            };

            // Only add Content-Type for requests with a body
            if (options.body && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }

            // Fire the HTTP request using the Clockify backend proxy defined in the addon claims
            const response = await fetch(url, { ...options, headers, signal: options.signal });

            // 401/403/404 are non-retryable errors
            // These status codes indicate invalid tokens/permissions or missing resources—do not retry
            if (response.status === 401 || response.status === 403 || response.status === 404) {
                return { data: null, failed: true, status: response.status };
            }

            // Handle Rate Limiting (429) with proper attempt tracking
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
                    console.warn(
                        `Rate limit exceeded (attempt ${attempt + 1}/${retries + 1}). Retrying after ${waitMs}ms`
                    );
                    await delay(waitMs);
                    continue;
                } else {
                    console.error('Rate limit exceeded, no retries left');
                    return { data: null, failed: true, status: 429 };
                }
            }

            // Treat any other non-success status as a failure; log validation payload for easier debugging
            if (!response.ok) {
                const error = new Error(`API Error: ${response.status}`) as Error & {
                    status: number;
                };
                error.status = response.status;
                // Log the response body for debugging purposes if it's a validation error
                try {
                    const errorData = await response.json();
                    console.error('API Validation Error details:', errorData);
                } catch {
                    // Ignore parsing errors
                }
                throw error;
            }

            return { data: (await response.json()) as T, failed: false, status: response.status };
        } catch (error) {
            const err = error as Error & { status?: number };
            const errorType = classifyError(error);

            // Don't retry auth errors (invalid token) or validation errors (bad request)
            if (errorType === 'AUTH_ERROR' || errorType === 'VALIDATION_ERROR') {
                console.error(`Fetch error (not retryable): ${errorType}`, error);
                return { data: null, failed: true, status: err.status || 0 };
            }

            // Retry network/API errors with exponential backoff
            if (attempt < retries) {
                const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
                console.warn(`Retry ${attempt + 1}/${retries} after ${backoffTime}ms: ${url}`);
                await delay(backoffTime);
                continue;
            }

            // Final attempt failed
            console.error('Fetch error after retries:', error);
            return { data: null, failed: true, status: err.status || 0 };
        }
    }

    return { data: null, failed: true, status: 0 };
}

// ==================== PAGINATED FETCH ====================

/**
 * Fetches all pages of time entries for a single user for a given date range.
 * Automatically handles pagination up to MAX_PAGES.
 *
 * @param workspaceId - The Clockify workspace ID.
 * @param user - The user object (must contain id and name).
 * @param startIso - Start date in ISO format.
 * @param endIso - End date in ISO format.
 * @param options - Fetch options (e.g. signal).
 * @returns Flat list of all time entries for the user.
 */
async function fetchUserEntriesPaginated(
    workspaceId: string,
    user: User,
    startIso: string,
    endIso: string,
    options: FetchOptions = {}
): Promise<TimeEntry[]> {
    const allEntries: TimeEntry[] = [];
    let page = 1;
    const configuredMaxPages = store.config.maxPages ?? DEFAULT_MAX_PAGES;
    const effectiveMaxPages = configuredMaxPages === 0
        ? HARD_MAX_PAGES_LIMIT
        : Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT);

    while (page <= effectiveMaxPages) {
        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/user/${user.id}/time-entries?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&hydrated=true&page=${page}&page-size=${PAGE_SIZE}`;

        const { data: entries, failed, status } = await fetchWithAuth<TimeEntry[]>(url, options);

        // Log pagination failures instead of silently breaking
        if (failed) {
            console.warn(
                `Failed to fetch entries for user ${user.name} (page ${page}), status: ${status}`
            );
            break;
        }

        if (!entries || !Array.isArray(entries) || entries.length === 0) break;

        // Enrich entries with user metadata immediately
        allEntries.push(
            ...entries.map((e) => ({ ...e, userId: user.id, userName: user.name }))
        );

        if (entries.length < PAGE_SIZE) break; // Reached last page
        page++;
    }

    return allEntries;
}

// ==================== API MODULE ====================

export const Api = {
    /**
     * Fetch all users in the workspace.
     * @param workspaceId - The Clockify workspace ID.
     * @returns List of users.
     */
    async fetchUsers(workspaceId: string): Promise<User[]> {
        const { data } = await fetchWithAuth<User[]>(
            `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/users`
        );
        return data || [];
    },

    /**
     * Fetch all time entries using the Detailed Report API (single request for all users).
     * This replaces per-user fetching with a single report request.
     *
     * @param workspaceId - The Clockify workspace ID.
     * @param startIso - Start date ISO string.
     * @param endIso - End date ISO string.
     * @param options - Fetch options including AbortSignal.
     * @returns Combined list of all time entries.
     */
    async fetchDetailedReport(
        workspaceId: string,
        startIso: string,
        endIso: string,
        options: FetchOptions = {}
    ): Promise<TimeEntry[]> {
        // Resolve reports base URL across developer/regional environments.
        const baseReportsUrl = resolveReportsBaseUrl();
        const reportsUrl = `${baseReportsUrl}/v1/workspaces/${workspaceId}/reports/detailed`;
        const allEntries: TimeEntry[] = [];
        let page = 1;
        const pageSize = 200; // Max allowed
        let hasMore = true;
        // Always request earned amounts for stable rates; cost/profit uses the amounts array.
        const amountShown = 'EARNED';
        const resolveRateValue = (value: unknown): number => {
            if (value == null) return 0;
            if (typeof value === 'number') return value;
            if (typeof value === 'object' && 'amount' in (value as { amount?: number })) {
                const amount = Number((value as { amount?: number }).amount);
                return Number.isFinite(amount) ? amount : 0;
            }
            return 0;
        };
        const normalizeTimestamp = (value: unknown): string => {
            if (value == null) return '';
            const trimmed = String(value).trim();
            if (!trimmed) return '';
            if (trimmed.includes('T')) return trimmed;
            const spacedMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
            if (spacedMatch) {
                return `${spacedMatch[1]}T${spacedMatch[2]}`;
            }
            const compactMatch = trimmed.match(
                /^(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}(?::\d{2})?.*)$/
            );
            if (compactMatch) {
                return `${compactMatch[1]}T${compactMatch[2]}`;
            }
            return trimmed;
        };
        const pickRateValue = (...values: unknown[]): number => {
            for (const value of values) {
                const resolved = resolveRateValue(value);
                if (resolved > 0) return resolved;
            }
            for (const value of values) {
                const resolved = resolveRateValue(value);
                if (Number.isFinite(resolved)) return resolved;
            }
            return 0;
        };
        const ensureShownAmount = (
            items: Array<{ type?: string; amountType?: string; value?: number; amount?: number }>,
            fallbackAmount: number | null
        ): Array<{ type?: string; amountType?: string; value?: number; amount?: number }> => {
            if (fallbackAmount == null || !Number.isFinite(fallbackAmount) || fallbackAmount === 0) {
                return items;
            }
            const shownType = amountShown.toUpperCase();
            const shownTotal = items.reduce((total, item) => {
                const type = String(item?.type || item?.amountType || '').toUpperCase();
                if (type !== shownType) return total;
                const value = Number(item?.value ?? item?.amount);
                return Number.isFinite(value) ? total + value : total;
            }, 0);
            if (shownTotal !== 0) return items;
            return [...items, { type: shownType, value: fallbackAmount }];
        };
        const normalizeAmounts = (
            raw: DetailedReportEntry['amounts'] | Record<string, unknown> | null | undefined,
            fallbackAmount: number | null
        ): Array<{ type?: string; amountType?: string; value?: number; amount?: number }> => {
            if (Array.isArray(raw)) return ensureShownAmount(raw, fallbackAmount);
            if (raw && typeof raw === 'object') {
                if (
                    'type' in raw ||
                    'amountType' in raw ||
                    'value' in raw ||
                    'amount' in raw
                ) {
                    return ensureShownAmount(
                        [raw as { type?: string; amountType?: string; value?: number; amount?: number }],
                        fallbackAmount
                    );
                }
                const mapped = Object.entries(raw).reduce<
                    Array<{ type?: string; amountType?: string; value?: number; amount?: number }>
                >((acc, [key, value]) => {
                    const numericValue = Number(value);
                    if (Number.isFinite(numericValue)) {
                        acc.push({ type: key.toUpperCase(), value: numericValue });
                    }
                    return acc;
                }, []);
                if (mapped.length) return ensureShownAmount(mapped, fallbackAmount);
            }
            if (fallbackAmount != null) {
                return [{ type: amountShown, value: fallbackAmount }];
            }
            return [];
        };

        // Iterate through paginated report response until the API signals the final page
        while (hasMore) {
            // Build the minimal report body; we always ask for all amount types so profit mode can stack values locally
            const requestBody = {
                dateRangeStart: startIso,
                dateRangeEnd: endIso,
                amountShown, // keep rate/amount fields stable when cost/profit is unavailable
                amounts: ['EARNED', 'COST', 'PROFIT'], // always request all amounts so profit mode can stack
                detailedFilter: {
                    page: page,
                    pageSize: pageSize,
                },
            };

            const { data, failed } = await fetchWithAuth<DetailedReportResponse>(
                reportsUrl,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    signal: options.signal,
                },
                options.maxRetries
            );

            if (failed || !data) {
                console.error('Detailed report fetch failed on page', page);
                break;
            }

            // Reports API keys vary in casing; normalize before processing the payload
            const entries = data.timeentries || data.timeEntries || [];

            // Transform the detailed report payload into the legacy time entry shape that downstream logic expects so calc.js stays unchanged
            const transformed: TimeEntry[] = entries.map((e) => {
                const resolvedHourlyRate = pickRateValue(
                    e.earnedRate,
                    e.rate,
                    e.hourlyRate,
                    e.hourlyRate && typeof e.hourlyRate === 'object'
                        ? (e.hourlyRate as { amount?: number }).amount
                        : undefined
                );
                const resolvedEarnedRate = resolveRateValue(e.earnedRate);
                const resolvedCostRate = resolveRateValue(e.costRate);
                const isBillable = e.billable !== false;
                const hourlyRateCurrency =
                    typeof e.hourlyRate === 'object' &&
                    e.hourlyRate &&
                    'currency' in e.hourlyRate
                        ? String((e.hourlyRate as { currency?: string }).currency || 'USD')
                        : 'USD';
                const fallbackAmount = Number((e as { amount?: number }).amount);
                const normalizedAmounts = normalizeAmounts(
                    e.amounts as DetailedReportEntry['amounts'] | Record<string, unknown> | null | undefined,
                    Number.isFinite(fallbackAmount) ? fallbackAmount : null
                );

                return {
                    id: e._id || e.id || '',
                    description: e.description,
                    userId: e.userId || '',
                    userName: e.userName || '',
                    billable: e.billable,
                    projectId: e.projectId,
                    projectName: e.projectName,
                    clientId: e.clientId || null,
                    clientName: e.clientName || null,
                    taskId: e.taskId,
                    taskName: e.taskName,
                    type: e.type || 'REGULAR',
                    timeInterval: {
                        start: normalizeTimestamp(e.timeInterval?.start),
                        end: normalizeTimestamp(e.timeInterval?.end),
                        // Duration from Reports API is in SECONDS (integer), convert to ISO format
                        duration:
                            e.timeInterval?.duration != null
                                ? `PT${e.timeInterval.duration}S`
                                : null,
                    },
                    // Rate from Reports API is direct field in cents (e.g., 15300 = $153.00)
                    hourlyRate: { amount: resolvedHourlyRate, currency: hourlyRateCurrency },
                    earnedRate: isBillable
                        ? resolvedEarnedRate > 0
                            ? resolvedEarnedRate
                            : resolvedHourlyRate
                        : 0,
                    costRate: resolvedCostRate || e.costRate,
                    amounts: normalizedAmounts,
                    tags: e.tags || [],
                };
            });

            allEntries.push(...transformed);

            // Check if more pages
            // If we receive less than a full page, assume there are no more pages
            if (entries.length < pageSize) {
                hasMore = false;
            } else {
                page++;
                // Check against configurable max pages limit
                const configuredMaxPages = store.config.maxPages ?? DEFAULT_MAX_PAGES;
                const effectiveMaxPages = configuredMaxPages === 0
                    ? HARD_MAX_PAGES_LIMIT
                    : Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT);

                if (page > effectiveMaxPages) {
                    console.warn(`Reached page limit (${effectiveMaxPages}), stopping pagination. Total entries fetched: ${allEntries.length}`);
                    hasMore = false;
                }
            }
        }

        return allEntries;
    },

    /**
     * Batched fetch of time entries for multiple users concurrently.
     * Processes users in chunks (BATCH_SIZE) to manage load.
     * DEPRECATED: Use fetchDetailedReport for better performance.
     *
     * @param workspaceId - The Clockify workspace ID.
     * @param users - List of users to fetch entries for.
     * @param startIso - Start date ISO string.
     * @param endIso - End date ISO string.
     * @param options - Fetch options including AbortSignal.
     * @returns Combined list of all time entries.
     */
    async fetchEntries(
        workspaceId: string,
        users: User[],
        startIso: string,
        endIso: string,
        options: FetchOptions = {}
    ): Promise<TimeEntry[]> {
        const results: TimeEntry[] = [];

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            // This approach is the legacy per-user fetch flow; kept for backwards compatibility in tests.

            const batchPromises = batch.map((user) =>
                fetchUserEntriesPaginated(workspaceId, user, startIso, endIso, options)
            );
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.flat());
        }

        return results;
    },

    /**
     * Fetch a single user's profile settings (capacity, working days).
     * @param workspaceId - The workspace ID.
     * @param userId - The user ID.
     * @param options - Fetch options.
     * @returns Response object.
     */
    async fetchUserProfile(
        workspaceId: string,
        userId: string,
        options: FetchOptions = {}
    ): Promise<ApiResponse<RawProfileResponse>> {
        const { data, failed, status } = await fetchWithAuth<RawProfileResponse>(
            `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/member-profile/${userId}`,
            options
        );
        return { data, failed, status };
    },

    /**
     * Fetch holidays assigned to a specific user within a date period.
     * WARNING: The API requires FULL ISO 8601 datetime format (e.g., 2022-12-03T00:00:00Z).
     * Despite legacy Clockify docs suggesting YYYY-MM-DD, simple date format returns 400 error.
     * @param workspaceId
     * @param userId
     * @param startIso - Full ISO 8601 datetime string (e.g., 2022-12-03T00:00:00Z)
     * @param endIso - Full ISO 8601 datetime string (e.g., 2022-12-05T23:59:59Z)
     * @param options
     * @returns
     */
    async fetchHolidays(
        workspaceId: string,
        userId: string,
        startIso: string,
        endIso: string,
        options: FetchOptions = {}
    ): Promise<ApiResponse<RawHoliday[]>> {
        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/holidays/in-period?assigned-to=${encodeURIComponent(userId)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;

        const { data, failed, status } = await fetchWithAuth<RawHoliday[]>(url, options);
        return { data, failed, status };
    },

    /**
     * Fetch approved time off requests for multiple users via POST endpoint.
     *
     * @param workspaceId
     * @param userIds
     * @param startDate - Full ISO 8601 string
     * @param endDate - Full ISO 8601 string
     * @param options - Options including retry configuration
     * @returns Data contains `requests` array.
     */
    async fetchTimeOffRequests(
        workspaceId: string,
        userIds: string[],
        startDate: string,
        endDate: string,
        options: FetchOptions = {}
    ): Promise<ApiResponse<RawTimeOffResponse | TimeOffRequest[]>> {
        // Use POST endpoint for time-off requests to filter by specific users and status
        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/time-off/requests`;
        const body = {
            page: 1,
            pageSize: 200,
            users: userIds,
            statuses: ['APPROVED'],
            start: startDate,
            end: endDate,
        };

        const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
        const { data, failed, status } = await fetchWithAuth<
            RawTimeOffResponse | TimeOffRequest[]
        >(
            url,
            {
                method: 'POST',
                body: JSON.stringify(body),
                ...options,
            },
            maxRetries
        );

        return { data, failed, status };
    },

    /**
     * Batched fetch of all user profiles.
     * Updates `store.apiStatus.profilesFailed` to track partial failures.
     *
     * @param workspaceId
     * @param users
     * @param options
     * @returns Map of userId -> profileData
     */
    async fetchAllProfiles(
        workspaceId: string,
        users: User[],
        options: FetchOptions = {}
    ): Promise<Map<string, RawProfileResponse>> {
        const results = new Map<string, RawProfileResponse>();
        let failedCount = 0;

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user) => {
                const { data, failed } = await this.fetchUserProfile(
                    workspaceId,
                    user.id,
                    options
                );
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
     * @param workspaceId
     * @param users
     * @param startDate
     * @param endDate
     * @param options
     * @returns Map of userId -> Array of Holidays
     */
    async fetchAllHolidays(
        workspaceId: string,
        users: User[],
        startDate: string,
        endDate: string,
        options: FetchOptions = {}
    ): Promise<Map<string, Holiday[]>> {
        const results = new Map<string, Holiday[]>();
        let failedCount = 0;
        const startIso = `${startDate}T00:00:00.000Z`;
        const endIso = `${endDate}T23:59:59.999Z`;

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user) => {
                const { data, failed } = await this.fetchHolidays(
                    workspaceId,
                    user.id,
                    startIso,
                    endIso,
                    options
                );
                return { userId: user.id, data, failed };
            });
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ userId, data, failed }) => {
                if (failed) failedCount++;
                if (data) {
                    results.set(
                        userId,
                        data.map((h) => ({
                            name: h.name || '',
                            datePeriod: {
                                startDate: h.datePeriod?.startDate || '',
                                endDate: h.datePeriod?.endDate,
                            },
                            projectId: h.projectId,
                        }))
                    );
                }
            });
        }

        store.apiStatus.holidaysFailed = failedCount;
        return results;
    },

    /**
     * Fetches and processes time off for all users.
     * Returns a structured Map for easy lookup during calculation.
     *
     * @param workspaceId
     * @param users
     * @param startDate
     * @param endDate
     * @param options - Options including retry configuration
     * @returns Map<userId, Map<dateKey, {hours, isFullDay}>>
     */
    async fetchAllTimeOff(
        workspaceId: string,
        users: User[],
        startDate: string,
        endDate: string,
        options: FetchOptions = {}
    ): Promise<Map<string, Map<string, TimeOffInfo>>> {
        const userIds = users.map((u) => u.id);
        const fetchOptions = { maxRetries: options.maxRetries, signal: options.signal };

        // Ensure dates are in full ISO 8601 format for the Time-Off API
        const startIso = `${startDate}T00:00:00.000Z`;
        const endIso = `${endDate}T23:59:59.999Z`;

        const { data, failed } = await this.fetchTimeOffRequests(
            workspaceId,
            userIds,
            startIso,
            endIso,
            fetchOptions
        );

        if (failed) {
            store.apiStatus.timeOffFailed = users.length;
            return new Map();
        }

        // Build per-user per-date map
        const results = new Map<string, Map<string, TimeOffInfo>>();

        // Try multiple possible response formats to tolerate backend variations (array vs object wrapper)
        let requests: TimeOffRequest[] = [];
        if (data && typeof data === 'object') {
            if ('requests' in data && Array.isArray(data.requests)) {
                requests = data.requests;
            } else if (Array.isArray(data)) {
                // API might return array directly
                requests = data;
            } else if ('timeOffRequests' in data && Array.isArray(data.timeOffRequests)) {
                requests = data.timeOffRequests;
            }
        }

        // Process each approved request and expand multi-day periods into per-date records
        requests.forEach((request) => {
            // Status is an object with statusType property, not a string
            const statusType =
                typeof request.status === 'object'
                    ? request.status.statusType
                    : request.status;

            // Filter by status - only process approved requests
            if (statusType !== 'APPROVED') {
                return;
            }

            const userId = request.userId || request.requesterUserId;
            if (!userId) {
                return;
            }

            if (!results.has(userId)) results.set(userId, new Map());
            const userMap = results.get(userId)!;

            // The period dates are nested under timeOffPeriod.period, not timeOffPeriod directly
            const timeOffPeriod = request.timeOffPeriod || {};
            const innerPeriod = timeOffPeriod.period || {};
            const startKey = IsoUtils.extractDateKey(
                innerPeriod.start || timeOffPeriod.start || timeOffPeriod.startDate
            );
            const endKey = IsoUtils.extractDateKey(
                innerPeriod.end || timeOffPeriod.end || timeOffPeriod.endDate
            );

            if (startKey) {
                const isFullDay =
                    !timeOffPeriod.halfDay &&
                    (request.timeUnit === 'DAYS' || !timeOffPeriod.halfDayHours);
                // Initialize start date
                userMap.set(startKey, { isFullDay, hours: 0 });

                // Handle multi-day time off
                if (endKey && endKey !== startKey) {
                    const dateRange = IsoUtils.generateDateRange(startKey, endKey);
                    dateRange.forEach((dateKey) => {
                        if (!userMap.has(dateKey)) {
                            userMap.set(dateKey, { isFullDay, hours: 0 });
                        }
                    });
                }
            }
        });

        store.apiStatus.timeOffFailed = 0;
        return results;
    },
};
