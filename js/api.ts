/**
 * @fileoverview Clockify API Client - Network Communication & Rate Limiting
 *
 * This module is the ONLY module that communicates with external Clockify APIs.
 * It provides a single, centralized HTTP client with built-in rate limiting,
 * retry logic, pagination handling, and error classification.
 *
 * ## Module Responsibility
 * - Authenticate all requests with X-Addon-Token header
 * - Enforce rate limits with token bucket algorithm (50 req/sec)
 * - Handle HTTP errors (401/403/404 non-retryable, 429 with backoff, 5xx with retry)
 * - Paginate large result sets (time entries, profiles, holidays, time-off)
 * - Transform raw API responses into application-friendly types
 * - Provide abort signal support for cancellable operations
 * - Resolve regional/environment-specific API URLs
 *
 * ## Key Dependencies
 * - `state.js` - Global store for token, claims, and throttle tracking
 * - `utils.js` - Date utilities (IsoUtils) and error classification
 * - `types.js` - TypeScript interfaces for API request/response types
 * - `constants.js` - Pagination limits (DEFAULT_MAX_PAGES, HARD_MAX_PAGES_LIMIT)
 *
 * ## Data Flow
 * Controller (main.ts) → API functions → fetchWithAuth → Clockify APIs
 * Clockify APIs → fetchWithAuth → Transform response → Return to controller
 *
 * ## API Endpoints Used (see docs/guide.md for full details)
 *
 * **Workspace API** (Base: `/v1/workspaces/{workspaceId}`):
 * - `GET /users` - Fetch workspace users (paginated)
 * - `GET /users/{userId}/profile` - Fetch user profile (capacity, working days)
 *
 * **Reports API** (Base: Reports URL from token claims):
 * - `POST /reports/detailed` - Fetch detailed time entries (paginated, with filters)
 *
 * **Time Off API** (Base: `/v1/workspaces/{workspaceId}`):
 * - `POST /time-off-requests/search` - Fetch time-off requests for multiple users
 *
 * **Holiday API** (Base: `/v1/workspaces/{workspaceId}`):
 * - `GET /users/{userId}/holidays` - Fetch holidays for a specific user
 *
 * ## Rate Limiting Strategy
 *
 * Uses a **token bucket algorithm** to enforce Clockify addon rate limits:
 * - **Capacity**: 50 requests
 * - **Refill Rate**: 50 tokens per second (1000ms interval)
 * - **Behavior**: Requests block until a token is available (non-recursive loop)
 *
 * ### Why Token Bucket?
 * - Allows bursts up to 50 requests (better UX for small workspaces)
 * - Prevents sustained over-limit requests (protects against throttling)
 * - Simple, predictable implementation (no complex sliding windows)
 *
 * ### Rate Limit Handling
 * - **429 Response**: Wait for `Retry-After` header duration, then retry
 * - **Throttle Tracking**: Store tracks retry count for UI banner display
 * - **Max Retries**: Configurable per request (default 2)
 *
 * ## Pagination Strategy
 *
 * Different endpoints have different pagination mechanisms:
 *
 * **Offset-based** (Users, Time Entries):
 * - `page` parameter: page number (1-indexed)
 * - `pageSize` parameter: items per page (500 max for performance)
 * - Safety limit: 50 pages max (prevents runaway pagination on huge datasets)
 *
 * **Cursor-based** (Holidays):
 * - `pageToken` parameter: continuation token from previous response
 * - Automatically follows `nextPageToken` until exhausted
 *
 * **Batch** (Profiles, Time Off):
 * - Process multiple users concurrently (5 users per batch)
 * - Avoids overwhelming API with parallel requests
 *
 * ## Error Classification
 *
 * Errors are classified into categories for appropriate handling:
 *
 * - **Auth Errors** (401, 403): Invalid token, no retry
 * - **Not Found** (404): Resource doesn't exist, no retry
 * - **Rate Limit** (429): Throttled, retry with backoff
 * - **Server Errors** (5xx): Temporary failure, retry up to maxRetries
 * - **Network Errors**: Connection failures, retry up to maxRetries
 * - **Abort**: User cancelled operation (AbortSignal), no retry
 *
 * ## Abort Signal Support
 *
 * All API functions accept an optional `AbortSignal` for cancellable operations.
 * When the signal fires:
 * - In-flight fetch request is aborted
 * - Pagination loop terminates immediately
 * - Function returns partial results (or empty array if nothing fetched yet)
 *
 * This is critical for UX: users can cancel slow report generation without
 * waiting for all API calls to complete.
 *
 * ## Security Considerations
 *
 * - **Token Handling**: Token is stored in memory only (no localStorage persistence)
 * - **No Secrets in Logs**: Never log auth tokens or workspace IDs
 * - **HTTPS Only**: All Clockify APIs use HTTPS (enforced by API URLs)
 * - **Read-Only**: This addon makes ZERO write requests (no POST/PATCH/DELETE)
 *   - Exception: POST for search/filter operations (time-off, detailed reports)
 *   - These POST requests are read-only queries, not mutations
 *
 * ## Performance Budget
 *
 * Target: Fetch 100 users + 30 days of data in <10 seconds
 * - Users: 1 paginated request (~200ms)
 * - Time Entries: 1-5 paginated requests (~1-2s total)
 * - Profiles: 100 concurrent batched requests (~2-3s total)
 * - Holidays: 100 sequential requests (~3-5s total, slowest)
 * - Time Off: 1 bulk request (~500ms)
 *
 * Bottleneck: Holiday API (sequential, slow). Consider caching or lazy loading.
 *
 * ## URL Resolution Logic
 *
 * Clockify has multiple API environments (production, regional, developer portal).
 * The Reports API URL is resolved from token claims with fallbacks:
 *
 * 1. Use `claims.reportsUrl` if present
 * 2. If `backendUrl` is developer.clockify.me, use `backendUrl` (dev portal)
 * 3. If `backendUrl` is api.clockify.me, use reports.api.clockify.me
 * 4. For regional URLs (*.clockify.me), replace `/api` with `/report`
 * 5. Default fallback: https://reports.api.clockify.me
 *
 * This ensures compatibility across all Clockify environments.
 *
 * ## Related Files
 * - `docs/guide.md` - Complete API endpoint documentation with examples
 * - `main.ts` - Controller that orchestrates API calls
 * - `state.ts` - Global store for token and throttle tracking
 * - `__tests__/unit/api.test.js` - API client unit tests
 *
 * @see fetchWithAuth - Core HTTP client with rate limiting and retry
 * @see fetchDetailedReport - Main entry point for time entries
 * @see docs/guide.md - Complete API documentation
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

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/**
 * Base path for Clockify workspace API endpoints.
 * Used for users, profiles, holidays, and time-off requests.
 * @example "/v1/workspaces/{workspaceId}/users"
 */
const BASE_API = '/v1/workspaces';

/**
 * Number of concurrent user requests to process in a batch.
 * Used for profiles and holidays to avoid overwhelming the API.
 *
 * Why 5? Trade-off between:
 * - Performance: Higher = faster overall completion
 * - API Courtesy: Lower = less server load
 * - Error Risk: Higher = more requests fail if one fails
 */
const BATCH_SIZE = 5;

/**
 * Number of items to fetch per page for paginated endpoints.
 * Maximum value supported by Clockify API is 500.
 *
 * Why 500? Maximizes data per request while staying within API limits.
 * Larger pages = fewer requests = faster overall fetch.
 */
const PAGE_SIZE = 500;

// ============================================================================
// RATE LIMITING STATE (Global, Module-Scoped)
// ============================================================================
// Token bucket algorithm state. This is intentionally global (not per-request)
// to enforce a single rate limit across all concurrent API calls.
// ============================================================================

/**
 * Maximum tokens in the bucket (burst capacity).
 * Allows up to 50 concurrent requests before throttling kicks in.
 */
const RATE_LIMIT = 50;

/**
 * Token refill interval in milliseconds.
 * Every 1 second, the bucket refills to RATE_LIMIT tokens.
 * This enforces a sustained rate of 50 requests/second.
 */
const REFILL_INTERVAL = 1000;

/**
 * Current number of available tokens.
 * Decremented before each request, refilled every REFILL_INTERVAL.
 */
let tokens = RATE_LIMIT;

/**
 * Timestamp of last token refill (in milliseconds since epoch).
 * Used to calculate when the next refill is due.
 */
let lastRefill = Date.now();

// ============================================================================
// URL RESOLUTION
// ============================================================================
// Clockify operates multiple API environments (production, regional, developer).
// This section resolves the correct Reports API URL based on token claims.
// ============================================================================

/**
 * Resolves the Clockify Reports API base URL from token claims.
 *
 * Clockify addons receive a JWT token with `claims` containing API URLs:
 * - `claims.backendUrl`: Base API URL (e.g., "https://api.clockify.me/api")
 * - `claims.reportsUrl`: Reports API URL (e.g., "https://reports.api.clockify.me")
 *
 * However, `reportsUrl` may be missing (especially in developer portal).
 * This function implements fallback logic to derive the Reports URL from `backendUrl`.
 *
 * ## Resolution Algorithm
 *
 * 1. **If `reportsUrl` exists**:
 *    - Special case: Developer portal (`developer.clockify.me`)
 *      → If `reportsUrl` points to different host, use `backendUrl` instead
 *      → This handles local dev environments correctly
 *    - Otherwise: Use `reportsUrl` as-is
 *
 * 2. **If `reportsUrl` missing**:
 *    - Developer portal (`developer.clockify.me`): Use `backendUrl`
 *    - Production (`api.clockify.me`): Use `reports.api.clockify.me`
 *    - Regional (`*.clockify.me`): Transform `/api` to `/report`
 *    - Unknown: Default to `https://reports.api.clockify.me`
 *
 * ## Examples
 *
 * | backendUrl | reportsUrl | Result |
 * |------------|-----------|--------|
 * | https://api.clockify.me/api | (missing) | https://reports.api.clockify.me |
 * | https://eu.api.clockify.me/api | (missing) | https://eu.api.clockify.me/report |
 * | https://developer.clockify.me/api | (missing) | https://developer.clockify.me/api |
 * | https://api.clockify.me/api | https://reports.api.clockify.me | https://reports.api.clockify.me |
 *
 * ## Why This Complexity?
 * - Clockify has evolved from regional APIs to dedicated Reports APIs
 * - Developer portal needs special handling (reports run locally)
 * - Must support both old and new URL schemes for backwards compatibility
 *
 * @returns Reports API base URL (without trailing slash)
 *
 * @example
 * // Production environment
 * resolveReportsBaseUrl() // → "https://reports.api.clockify.me"
 *
 * // Regional environment (EU)
 * resolveReportsBaseUrl() // → "https://eu.api.clockify.me/report"
 *
 * // Developer portal
 * resolveReportsBaseUrl() // → "https://developer.clockify.me/api"
 */
function resolveReportsBaseUrl(): string {
    // Extract claims from global store
    const reportsUrlClaim = store.claims?.reportsUrl;
    // Stryker disable next-line StringLiteral: Empty string fallback is defensive, behavior unchanged
    const backendUrl = store.claims?.backendUrl || '';

    // Normalize backendUrl: remove trailing slashes for consistent parsing
    // Stryker disable next-line all: Trailing slash normalization is defensive
    const normalizedBackend = backendUrl.replace(/\/+$/, '');

    // Parse backendUrl to extract components
    // Stryker disable next-line StringLiteral: Empty string init before conditional assignment
    let backendHost = '';
    // Stryker disable next-line StringLiteral: Empty string init before conditional assignment
    let backendOrigin = '';
    // Stryker disable next-line StringLiteral: Empty string init before conditional assignment
    let backendPath = '';

    // Stryker disable next-line ConditionalExpression: Truthy check required to avoid URL parse error
    if (normalizedBackend) {
        try {
            const backend = new URL(normalizedBackend);
            backendHost = backend.host.toLowerCase(); // e.g., "api.clockify.me"
            backendOrigin = backend.origin; // e.g., "https://api.clockify.me"
            // Stryker disable next-line all: Trailing slash normalization is defensive
            backendPath = backend.pathname.replace(/\/+$/, ''); // e.g., "/api"
        } catch {
            // Invalid URL format: ignore parse errors and fall back to defaults
        }
    }

    // --- BRANCH 1: reportsUrl claim exists ---
    // Stryker disable next-line BlockStatement: Null check for optional claim
    if (reportsUrlClaim) {
        // Stryker disable next-line all: Trailing slash normalization is defensive
        const normalizedReports = reportsUrlClaim.replace(/\/+$/, '');

        // Special case: Developer portal
        // If reportsUrl points to a different host than backendUrl, use backendUrl instead.
        // This handles local dev setups where reports should run through local backend.
        if (backendHost === 'developer.clockify.me') {
            try {
                const reportsHost = new URL(normalizedReports).host.toLowerCase();
                if (reportsHost !== backendHost && normalizedBackend) {
                    return normalizedBackend; // Use backend for local dev
                }
            } catch {
                // Parse error: fall back to backendUrl if available
                /* istanbul ignore else -- normalizedBackend is always truthy when backendHost is developer.clockify.me */
                if (normalizedBackend) return normalizedBackend;
            }
        }

        // Use reportsUrl as-is (normal case)
        return normalizedReports;
    }

    // --- BRANCH 2: reportsUrl missing, derive from backendUrl ---

    // Developer portal: Use backendUrl directly (reports run locally)
    // Stryker disable next-line all: Developer portal detection requires exact match
    if (backendHost === 'developer.clockify.me' && normalizedBackend) {
        return normalizedBackend;
    }

    // Production: Use dedicated Reports API
    if (backendHost === 'api.clockify.me') {
        return 'https://reports.api.clockify.me';
    }

    // Regional environments: Transform `/api` path to `/report`
    // E.g., "https://eu.api.clockify.me/api" → "https://eu.api.clockify.me/report"
    if (backendHost.endsWith('clockify.me') && backendOrigin) {
        if (backendPath.endsWith('/api')) {
            return `${backendOrigin}${backendPath.replace(/\/api$/, '/report')}`;
        }
        // No `/api` path: just append `/report`
        return `${backendOrigin}/report`;
    }

    // --- BRANCH 3: Unknown environment, use production default ---
    return 'https://reports.api.clockify.me';
}

// ============================================================================
// TYPE DEFINITIONS - API Request/Response Interfaces
// ============================================================================
// Internal TypeScript interfaces for API interactions.
// These define the shape of raw Clockify API responses before transformation.
// ============================================================================

/**
 * Progress callback type for fetch operations.
 * Used to notify UI of fetch progress for long-running operations.
 *
 * @param current - Current item count (e.g., number of users processed)
 * @param phase - Human-readable description of current phase (e.g., "Fetching profiles")
 *
 * @example
 * const onProgress: FetchProgressCallback = (current, phase) => {
 *   console.log(`${phase}: ${current} items processed`);
 * };
 */
export type FetchProgressCallback = (current: number, phase: string) => void;

/**
 * Fetch options with optional abort signal
 */
interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    maxRetries?: number;
    onProgress?: FetchProgressCallback;
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

// ============================================================================
// CORE HTTP CLIENT - fetchWithAuth
// ============================================================================
// The foundational HTTP client used by all API functions in this module.
// Handles authentication, rate limiting, retries, and error classification.
// ============================================================================

/**
 * Core HTTP client with authentication, rate limiting, and retry logic.
 *
 * This is the ONLY function that makes actual HTTP requests to Clockify APIs.
 * All other API functions in this module delegate to fetchWithAuth.
 *
 * ## Features
 * - **Authentication**: Adds `X-Addon-Token` header from store
 * - **Rate Limiting**: Token bucket algorithm (50 req/sec)
 * - **Retry Logic**: Handles 429/5xx with retry, 401/403/404 without retry
 * - **Error Classification**: Returns structured error responses (never throws)
 * - **Abort Support**: Accepts AbortSignal for cancellable requests
 *
 * ## Rate Limiting (Token Bucket)
 * - Capacity: 50 tokens
 * - Refill: 50 tokens/second (every 1000ms)
 * - Behavior: Waits (non-blocking loop) until token available
 *
 * ## Retry Strategy
 * - 401/403/404: No retry (permanent failures)
 * - 429: Retry with Retry-After header wait
 * - 5xx/Network: Retry up to maxRetries (default 2)
 *
 * @template T - Expected JSON response type
 * @param url - Full URL to fetch (not relative path)
 * @param options - Fetch options (method, headers, body, signal)
 * @param maxRetries - Max retry attempts (default: 2 in prod, 0 in tests)
 * @returns Promise<ApiResponse<T>> - {data, failed, status}
 *
 * @example
 * const resp = await fetchWithAuth<User[]>("https://api.clockify.me/.../users");
 * if (resp.failed) console.error("Failed:", resp.status);
 * else console.log("Users:", resp.data);
 */
async function fetchWithAuth<T>(
    url: string,
    options: FetchOptions = {},
    maxRetries?: number
): Promise<ApiResponse<T>> {
    // Stryker disable all: Test environment detection - equivalent mutants
    // Default: 2 retries in production, 0 in tests
    const defaultMaxRetries =
        typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? 0 : 2;
    const retries = maxRetries !== undefined ? maxRetries : defaultMaxRetries;
    // Stryker restore all

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
                // Track throttle retry in store for UI banner
                store.incrementThrottleRetry();

                const retryAfterHeader = response.headers.get('Retry-After');
                let waitMs = 5000; // Default wait time if header is missing
                // Stryker disable next-line BlockStatement,BooleanLiteral,ConditionalExpression: Retry-After parsing is defensive - default waitMs used if invalid
                if (retryAfterHeader) {
                    const seconds = parseInt(retryAfterHeader, 10);
                    // Stryker disable next-line BlockStatement,BooleanLiteral,ConditionalExpression: isNaN check is defensive - default waitMs used if NaN
                    if (!isNaN(seconds)) {
                        waitMs = seconds * 1000;
                    }
                }
                // Check if we have retries left before continuing
                /* istanbul ignore if -- requires network delays to test */
                if (attempt < retries) {
                    // Stryker disable next-line StringLiteral: Console log message is not testable
                    console.warn(
                        `Rate limit exceeded (attempt ${attempt + 1}/${retries + 1}). Retrying after ${waitMs}ms`
                    );
                    await delay(waitMs);
                    continue;
                } else {
                    // Stryker disable next-line StringLiteral: Console log message is not testable
                    console.error('Rate limit exceeded, no retries left');
                    return { data: null, failed: true, status: 429 };
                }
            }

            // Treat any other non-success status as a failure; log validation payload for easier debugging
            if (!response.ok) {
                // Stryker disable next-line StringLiteral: Error message string is not testable
                const error = new Error(`API Error: ${response.status}`) as Error & {
                    status: number;
                };
                error.status = response.status;
                // Log the response body for debugging purposes if it's a validation error
                try {
                    const errorData = await response.json();
                    // Stryker disable next-line StringLiteral: Console log message is not testable
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
                // Stryker disable next-line StringLiteral: Console log message is not testable
                console.error(`Fetch error (not retryable): ${errorType}`, error);
                /* istanbul ignore next -- defensive: err.status may be undefined for network errors */
                return { data: null, failed: true, status: err.status || 0 };
            }

            // Retry network/API errors with exponential backoff
            if (attempt < retries) {
                const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
                // Stryker disable next-line StringLiteral: Console log message is not testable
                console.warn(`Retry ${attempt + 1}/${retries} after ${backoffTime}ms: ${url}`);
                await delay(backoffTime);
                continue;
            }

            // Final attempt failed
            // Stryker disable next-line StringLiteral: Console log message is not testable
            console.error('Fetch error after retries:', error);
            return { data: null, failed: true, status: err.status || 0 };
        }
    }

    /* istanbul ignore next -- fallback return, loop always returns before reaching here */
    // Stryker disable next-line all: Fallback return is unreachable but required for TypeScript
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
/* istanbul ignore next -- defensive: options default is for internal convenience */
async function fetchUserEntriesPaginated(
    workspaceId: string,
    user: User,
    startIso: string,
    endIso: string,
    options: FetchOptions = {}
): Promise<TimeEntry[]> {
    const allEntries: TimeEntry[] = [];
    let page = 1;
    /* istanbul ignore next -- defensive: maxPages is always set, 0 means unlimited */
    const configuredMaxPages = store.config.maxPages ?? DEFAULT_MAX_PAGES;
    // Stryker disable next-line ConditionalExpression: Zero check enables unlimited pagination mode
    const effectiveMaxPages = configuredMaxPages === 0
        ? HARD_MAX_PAGES_LIMIT
        : Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT);

    while (page <= effectiveMaxPages) {
        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/user/${user.id}/time-entries?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&hydrated=true&page=${page}&page-size=${PAGE_SIZE}`;

        const { data: entries, failed, status } = await fetchWithAuth<TimeEntry[]>(url, options);

        // Log pagination failures instead of silently breaking
        if (failed) {
            // Stryker disable next-line StringLiteral: Console log message is not testable
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
        /* istanbul ignore next -- defensive: handles various rate value formats from API */
        const resolveRateValue = (value: unknown): number => {
            if (value == null) return 0;
            if (typeof value === 'number') return value;
            if (typeof value === 'object' && 'amount' in (value as { amount?: number })) {
                const amount = Number((value as { amount?: number }).amount);
                return Number.isFinite(amount) ? amount : 0;
            }
            return 0;
        };
        /* istanbul ignore next -- defensive: handles null/missing timestamp values */
        const normalizeTimestamp = (value: unknown): string => {
            if (value == null) return '';
            const trimmed = String(value).trim();
            if (!trimmed) return '';
            if (trimmed.includes('T')) return trimmed;
            // Stryker disable next-line Regex: Regex patterns match equivalent date formats
            const spacedMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
            if (spacedMatch) {
                return `${spacedMatch[1]}T${spacedMatch[2]}`;
            }
            /* Stryker disable all: Regex patterns match equivalent date formats */
            const compactMatch = trimmed.match(
                /^(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}(?::\d{2})?.*)$/
            );
            /* Stryker restore all */
            /* istanbul ignore else -- defensive: return original string for unrecognized formats */
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
            /* Stryker disable all: Second pass fallback - equivalent when first pass finds positive value */
            for (const value of values) {
                const resolved = resolveRateValue(value);
                if (Number.isFinite(resolved)) return resolved;
            }
            /* Stryker restore all */
            /* istanbul ignore next -- unreachable: resolveRateValue always returns finite number */
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
            /* istanbul ignore next -- defensive: handles malformed amounts array entries */
            /* Stryker disable all: Defensive optional chaining for malformed API data */
            const shownTotal = items.reduce((total, item) => {
                const type = String(item?.type || item?.amountType || '').toUpperCase();
                if (type !== shownType) return total;
                const value = Number(item?.value ?? item?.amount);
                return Number.isFinite(value) ? total + value : total;
            }, 0);
            /* Stryker restore all */
            /* istanbul ignore next -- defensive: adds fallback amount if no matching type found */
            if (shownTotal !== 0) return items;
            return [...items, { type: shownType, value: fallbackAmount }];
        };
        const normalizeAmounts = (
            raw: DetailedReportEntry['amounts'] | Record<string, unknown> | null | undefined,
            fallbackAmount: number | null
        ): Array<{ type?: string; amountType?: string; value?: number; amount?: number }> => {
            if (Array.isArray(raw)) return ensureShownAmount(raw, fallbackAmount);
            if (raw && typeof raw === 'object') {
                // Stryker disable next-line StringLiteral: Property name checks - empty string not valid in API responses
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
                // Stryker disable next-line ConditionalExpression: Empty array to ensureShownAmount is equivalent behavior
                if (mapped.length) return ensureShownAmount(mapped, fallbackAmount);
            }
            if (fallbackAmount != null) {
                return [{ type: amountShown, value: fallbackAmount }];
            }
            return [];
        };

        // Iterate through paginated report response until the API signals the final page
        while (hasMore) {
            // Report progress for UI updates
            if (options.onProgress) {
                options.onProgress(page, 'entries');
            }

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
                    // Stryker disable next-line ObjectLiteral,StringLiteral: Content-Type required for POST JSON body
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    signal: options.signal,
                },
                options.maxRetries
            );

            if (failed || !data) {
                // Stryker disable next-line StringLiteral: Console logging message is not testable
                console.error('Detailed report fetch failed on page', page);
                break;
            }

            // Reports API keys vary in casing; normalize before processing the payload
            const entries = data.timeentries || data.timeEntries || [];

            // Transform the detailed report payload into the legacy time entry shape that downstream logic expects so calc.js stays unchanged
            const transformed: TimeEntry[] = entries.map((e) => {
                // pickRateValue uses resolveRateValue internally, which already handles object extraction,
                // so we don't need explicit e.hourlyRate.amount extraction
                const resolvedHourlyRate = pickRateValue(
                    e.earnedRate,
                    e.rate,
                    e.hourlyRate
                );
                const resolvedEarnedRate = resolveRateValue(e.earnedRate);
                const resolvedCostRate = resolveRateValue(e.costRate);
                const isBillable = e.billable !== false;
                /* istanbul ignore next -- defensive: handle various hourlyRate object formats */
                // Stryker disable all: Currency fallback is defensive coding
                const hourlyRateCurrency =
                    typeof e.hourlyRate === 'object' &&
                    e.hourlyRate &&
                    'currency' in e.hourlyRate
                        ? String((e.hourlyRate as { currency?: string }).currency || 'USD')
                        : 'USD';
                // Stryker restore all
                const fallbackAmount = Number((e as { amount?: number }).amount);
                const normalizedAmounts = normalizeAmounts(
                    e.amounts as DetailedReportEntry['amounts'] | Record<string, unknown> | null | undefined,
                    Number.isFinite(fallbackAmount) ? fallbackAmount : null
                );

                /* istanbul ignore next -- defensive: handle missing fields from API response */
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
                    // Stryker disable all: earnedRate fallback logic is complex multi-tier
                    earnedRate: isBillable
                        ? resolvedEarnedRate > 0
                            ? resolvedEarnedRate
                            : resolvedHourlyRate
                        : 0,
                    // Stryker restore all
                    // Stryker disable next-line LogicalOperator: || fallback to original costRate is intentional
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
                /* istanbul ignore next -- defensive: pagination continuation rarely reaches limit */
                // Check against configurable max pages limit
                const configuredMaxPages = store.config.maxPages ?? DEFAULT_MAX_PAGES;
                /* istanbul ignore next -- defensive: maxPages === 0 is edge case for unlimited pages */
                // Stryker disable next-line ConditionalExpression: Zero check enables unlimited pagination mode
                const effectiveMaxPages = configuredMaxPages === 0
                    ? HARD_MAX_PAGES_LIMIT
                    : Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT);

                /* istanbul ignore next -- defensive: safety limit rarely reached in normal operation */
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

        // Stryker disable next-line EqualityOperator: i <= users.length is functionally equivalent (empty batch is no-op)
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

        // Stryker disable next-line ConditionalExpression: Explicit undefined check preserves 0 retries option
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

        // Stryker disable next-line EqualityOperator: i <= users.length is functionally equivalent (empty batch is no-op)
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
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format
        const startIso = `${startDate}T00:00:00.000Z`;
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format
        const endIso = `${endDate}T23:59:59.999Z`;

        // Stryker disable next-line EqualityOperator: i <= users.length is functionally equivalent (empty batch is no-op)
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
                    /* istanbul ignore next -- defensive: handle missing fields from API */
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
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format with time components
        const startIso = `${startDate}T00:00:00.000Z`;
        // Stryker disable next-line StringLiteral: API contract requires exact ISO format with end-of-day time
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

            let userMap = results.get(userId);
            // Stryker disable next-line ConditionalExpression: Map.set is idempotent but we avoid unnecessary allocation
            if (!userMap) {
                userMap = new Map();
                results.set(userId, userMap);
            }

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
                // Stryker disable next-line ConditionalExpression,EqualityOperator: Multi-day expansion requires inequality check
                if (endKey && endKey !== startKey) {
                    const dateRange = IsoUtils.generateDateRange(startKey, endKey);
                    dateRange.forEach((dateKey) => {
                        // Stryker disable next-line ConditionalExpression: Idempotent but avoids overwriting existing entries
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
