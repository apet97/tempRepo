/**
 * @fileoverview Application Constants & Type Definitions
 * Contains global constants, configuration defaults, and shared constants
 * used across the application.
 */

import type { FriendlyError } from './types.js';

// ==================== ERROR TRACKING ====================

/**
 * Sentry DSN for error tracking.
 * Configure this with your Sentry project's DSN.
 * Set to empty string to disable error reporting.
 *
 * To get a DSN:
 * 1. Create a project at https://sentry.io
 * 2. Go to Settings > Projects > [Your Project] > Client Keys (DSN)
 * 3. Copy the DSN and replace the placeholder below
 */
export const SENTRY_DSN = '__SENTRY_DSN__';

/**
 * Keys used for LocalStorage persistence.
 */
export const STORAGE_KEYS = {
    /** Stores user preference for density/layout (compact vs spacious). */
    DENSITY: 'overtime_density',
    /** Debug flag. */
    DEBUG: 'otplus_debug',
    /** Prefix for user-specific capacity/multiplier overrides. */
    OVERRIDES_PREFIX: 'overtime_overrides_',
    /** Prefix for UI state persistence. */
    OVERRIDES_UI_PREFIX: 'overtime_overrides_ui_',
    /** UI state persistence (summary grouping, expand/collapse states). */
    UI_STATE: 'otplus_ui_state',
    /** Report cache in sessionStorage. */
    REPORT_CACHE: 'otplus_report_cache',
} as const;

/**
 * Report cache TTL in milliseconds (5 minutes).
 */
export const REPORT_CACHE_TTL = 5 * 60 * 1000;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

/**
 * Global application constants.
 */
export const CONSTANTS = {
    /** Default daily working hours if no profile/override exists. */
    DEFAULT_DAILY_CAPACITY: 8,
    /** Default weekly capacity (not currently used in main logic but reserved). */
    DEFAULT_WEEKLY_CAPACITY: 40,
    /** Default overtime multiplier (1.5x). */
    DEFAULT_MULTIPLIER: 1.5,
    /** Default tier 2 threshold in OT hours (0 = disabled). */
    DEFAULT_TIER2_THRESHOLD: 0,
    /** Default tier 2 multiplier (2.0x). */
    DEFAULT_TIER2_MULTIPLIER: 2.0,
    /** Standard ISO date format used by API. */
    DATE_FORMAT_ISO: 'YYYY-MM-DD',
} as const;

// ==================== API CONSTANTS ====================

/**
 * Default maximum number of pages to fetch from the Reports API.
 * Each page contains up to 200 entries, so 50 pages = 10,000 entries max.
 * Set to 0 for unlimited (will fetch until API returns empty).
 */
export const DEFAULT_MAX_PAGES = 50;

/**
 * Hard limit on pages to prevent runaway fetches.
 * This is the absolute maximum regardless of configuration.
 */
export const HARD_MAX_PAGES_LIMIT = 500;

/**
 * Summary column definition
 */
export interface SummaryColumn {
    key: string;
    label: string;
    defaultVisible: boolean;
}

/**
 * Definition of columns for the Summary Table.
 */
export const SUMMARY_COLUMNS: SummaryColumn[] = [
    { key: 'capacity', label: 'Capacity (expected)', defaultVisible: true },
    { key: 'regular', label: 'Regular', defaultVisible: true },
    { key: 'overtime', label: 'Overtime', defaultVisible: true },
    { key: 'total', label: 'Total', defaultVisible: true },
    { key: 'breaks', label: 'Break', defaultVisible: true },
    { key: 'billableWorked', label: 'Billable Worked', defaultVisible: true },
    { key: 'billableOT', label: 'Billable OT', defaultVisible: true },
    { key: 'nonBillableOT', label: 'Non-Billable OT', defaultVisible: true },
    { key: 'timeOff', label: 'Time off', defaultVisible: true },
    { key: 'amount', label: 'Amount', defaultVisible: true },
    { key: 'profit', label: 'Profit', defaultVisible: true },
];

/**
 * Weekday definition
 */
export interface Weekday {
    key: string;
    label: string;
}

/**
 * Dynamically generated weekday labels using the browser's locale.
 * Maps API weekday keys (e.g., 'MONDAY') to localized short labels (e.g., 'Mon').
 */
export const WEEKDAYS: Weekday[] = (() => {
    const days: Weekday[] = [];
    // Generate localized labels for each weekday key to keep UI text consistent with user locale.
    // 2024-01-01 was a Monday. We use this anchor to generate sequential weekdays.
    const monday = new Date(Date.UTC(2024, 0, 1));
    const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    const keys = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + i);
        days.push({ key: keys[i], label: formatter.format(d) });
    }
    return days;
})();

// ==================== ERROR CONSTANTS ====================

/**
 * Classification of error types.
 */
export const ERROR_TYPES = {
    NETWORK: 'NETWORK_ERROR',
    AUTH: 'AUTH_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    API: 'API_ERROR',
    UNKNOWN: 'UNKNOWN_ERROR',
} as const;

export type ErrorType = typeof ERROR_TYPES[keyof typeof ERROR_TYPES];

/**
 * Error message configuration
 */
export interface ErrorMessageConfig {
    title: string;
    message: string;
    action: 'retry' | 'reload' | 'none';
}

/**
 * User-facing messages and actions for each error type.
 */
export const ERROR_MESSAGES: Record<ErrorType, ErrorMessageConfig> = {
    [ERROR_TYPES.NETWORK]: {
        title: 'Network Error',
        message: 'Unable to connect to Clockify. Please check your internet connection and try again.',
        action: 'retry',
    },
    [ERROR_TYPES.AUTH]: {
        title: 'Authentication Error',
        message: 'Your session has expired or the authentication token is invalid. Please reload the addon.',
        action: 'reload',
    },
    [ERROR_TYPES.VALIDATION]: {
        title: 'Validation Error',
        message: 'Invalid data was received from Clockify. Please check your inputs and try again.',
        action: 'none',
    },
    [ERROR_TYPES.API]: {
        title: 'API Error',
        message: 'Clockify API returned an error. The service may be temporarily unavailable.',
        action: 'retry',
    },
    [ERROR_TYPES.UNKNOWN]: {
        title: 'Unexpected Error',
        message: 'An unexpected error occurred. Please try again or contact support if the issue persists.',
        action: 'none',
    },
};

// Re-export types for convenience
export type { FriendlyError };
