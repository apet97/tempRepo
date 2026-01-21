/**
 * @fileoverview Utility Functions
 * Generic helper functions for date manipulation, error handling, formatting,
 * and data sanitization. These functions are pure and stateless where possible.
 */

import { ERROR_MESSAGES, ERROR_TYPES, type ErrorType, type FriendlyError } from './constants.js';
// Types imported as needed by callers

// ==================== TYPE VALIDATION ====================

/**
 * Extended error with status code
 */
interface ErrorWithStatus extends Error {
    status?: number;
}

/**
 * Creates a validation error.
 * @param message - The error message.
 * @returns The structured error.
 */
function createValidationError(message: string): FriendlyError {
    return createUserFriendlyError(new Error(message), ERROR_TYPES.VALIDATION);
}

/**
 * Validates that required fields exist in an object.
 * @param obj - Object to validate.
 * @param requiredFields - Array of required field names.
 * @param context - Context for error messages.
 * @returns true if valid.
 * @throws Error with VALIDATION type if validation fails.
 */
export function validateRequiredFields(
    obj: unknown,
    requiredFields: string[],
    context = 'Object'
): boolean {
    if (!obj || typeof obj !== 'object') {
        throw createValidationError(`${context} is not an object`);
    }

    const record = obj as Record<string, unknown>;
    const missing = requiredFields.filter((field) => !record[field]);

    if (missing.length > 0) {
        throw createValidationError(`${context} missing required fields: ${missing.join(', ')}`);
    }

    return true;
}

/**
 * Validates that a value is a valid number.
 * @param value - Value to validate.
 * @param field - Field name for error messages.
 * @returns The validated number.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateNumber(value: unknown, field: string): number {
    if (value === null || value === undefined) {
        throw createValidationError(`${field} is required`);
    }
    const num = Number(value);
    if (isNaN(num)) {
        throw createValidationError(`${field} must be a number`);
    }
    return num;
}

/**
 * Validates that a value is a valid string.
 * @param value - Value to validate.
 * @param field - Field name for error messages.
 * @returns The validated string.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateString(value: unknown, field: string): string {
    if (value === null || value === undefined || typeof value !== 'string') {
        throw createValidationError(`${field} must be a non-empty string`);
    }
    const trimmed = value.trim();
    if (trimmed === '') {
        throw createValidationError(`${field} cannot be empty`);
    }
    return trimmed;
}

/**
 * Validates that a value is a valid ISO date string.
 * @param value - Value to validate.
 * @param field - Field name for error messages.
 * @returns The validated date string.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateISODateString(value: unknown, field: string): string {
    const str = validateString(value, field);

    // Basic ISO format check (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
    const isoRegex = /^\d{4}-\d{2}-\d{2}/;
    if (!isoRegex.test(str)) {
        throw createValidationError(`${field} must be in ISO format (YYYY-MM-DD)`);
    }

    const date = new Date(str);
    if (isNaN(date.getTime())) {
        throw createValidationError(`${field} is not a valid ISO date`);
    }

    return str;
}

/**
 * Time entry for validation
 */
interface TimeEntryLike {
    id?: string;
    userId?: string;
    timeInterval?: {
        start?: string;
        end?: string;
        duration?: string;
    };
    hourlyRate?: {
        amount?: number;
    };
    billable?: boolean;
}

/**
 * Validates a time entry object structure.
 * @param entry - Entry to validate.
 * @returns true if valid.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateTimeEntry(entry: unknown): boolean {
    if (!entry || typeof entry !== 'object') {
        throw createValidationError('Time entry must be an object');
    }

    const e = entry as TimeEntryLike;

    // Required fields
    validateString(e.id, 'Time entry ID');
    validateString(e.userId, 'Time entry user ID');

    // Validate timeInterval
    validateRequiredFields(e, ['timeInterval'], 'Time entry');
    const interval = e.timeInterval;
    validateRequiredFields(interval, ['start', 'end'], 'Time interval');

    validateISODateString(interval?.start, 'Time entry start time');
    validateISODateString(interval?.end, 'Time entry end time');

    // Optional fields validation
    if (interval?.duration) {
        validateString(interval.duration, 'Time entry duration');
    }

    if (e.hourlyRate) {
        validateRequiredFields(e.hourlyRate, ['amount'], 'Time entry hourly rate');
        validateNumber(e.hourlyRate.amount, 'Hourly rate amount');
    }

    if (e.billable !== undefined) {
        if (typeof e.billable !== 'boolean') {
            throw createValidationError('Time entry billable must be a boolean');
        }
    }

    return true;
}

/**
 * User-like object for validation
 */
interface UserLike {
    id?: string;
    name?: string;
}

/**
 * Validates a user object structure.
 * @param user - User to validate.
 * @returns true if valid.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateUser(user: unknown): boolean {
    if (!user || typeof user !== 'object') {
        throw createValidationError('User must be an object');
    }

    const u = user as UserLike;
    validateString(u.id, 'User ID');
    validateString(u.name, 'User name');

    return true;
}

/**
 * Profile-like object for validation
 */
interface ProfileLike {
    workCapacity?: string;
    workingDays?: unknown[];
}

/**
 * Validates a user profile object structure.
 * @param profile - Profile to validate.
 * @returns true if valid.
 * @throws Error with VALIDATION type if invalid.
 */
export function validateUserProfile(profile: unknown): boolean {
    if (!profile || typeof profile !== 'object') {
        throw createValidationError('User profile must be an object');
    }

    const p = profile as ProfileLike;

    if (p.workCapacity !== undefined) {
        validateString(p.workCapacity, 'Work capacity');
    }

    if (p.workingDays !== undefined) {
        if (!Array.isArray(p.workingDays)) {
            throw createValidationError('Working days must be an array');
        }
        p.workingDays.forEach((day, index) => {
            if (typeof day !== 'string' || (day as string).trim() === '') {
                throw createValidationError(
                    `Working day at index ${index} must be a non-empty string`
                );
            }
        });
    }

    return true;
}

/**
 * Validates a date range.
 * @param startDate - Start date in YYYY-MM-DD format.
 * @param endDate - End date in YYYY-MM-DD format.
 * @returns true if valid.
 * @throws Error with VALIDATION type if validation fails.
 */
export function validateDateRange(startDate: string, endDate: string): boolean {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw createValidationError('Invalid date format. Use YYYY-MM-DD.');
    }

    if (start > end) {
        throw createValidationError('Start date must be before end date');
    }

    return true;
}

// ==================== ERROR CLASSIFICATION ====================

/**
 * Classifies an error object into a predefined category.
 * Used to determine retry logic and user-facing error messages.
 *
 * @param error - The error object to classify.
 * @returns One of the ERROR_TYPES constants.
 */
export function classifyError(error: unknown): ErrorType {
    if (!error) return ERROR_TYPES.UNKNOWN;

    const err = error as ErrorWithStatus;

    // Network errors (fetch failures, timeouts)
    if (err.name === 'TypeError' && err.message?.includes('fetch')) {
        return ERROR_TYPES.NETWORK;
    }
    if (err.name === 'AbortError') {
        return ERROR_TYPES.NETWORK;
    }

    // HTTP status based errors (if attached to the error object)
    if (err.status === 401 || err.status === 403) {
        return ERROR_TYPES.AUTH;
    }
    if (err.status && err.status >= 400 && err.status < 500) {
        return ERROR_TYPES.VALIDATION;
    }
    if (err.status && err.status >= 500) {
        return ERROR_TYPES.API;
    }

    return ERROR_TYPES.UNKNOWN;
}

/**
 * Creates a structured, user-friendly error object from a raw error.
 *
 * @param error - The raw error or error message.
 * @param type - Optional explicit error type override.
 * @returns Structured error object.
 */
export function createUserFriendlyError(error: Error | string, type?: ErrorType): FriendlyError {
    const errorType = type || classifyError(error);
    const errorMessage = ERROR_MESSAGES[errorType] || ERROR_MESSAGES[ERROR_TYPES.UNKNOWN];
    const err = typeof error === 'string' ? new Error(error) : error;

    return {
        type: errorType,
        title: errorMessage.title,
        message: errorMessage.message,
        action: errorMessage.action,
        originalError: err,
        timestamp: new Date().toISOString(),
        stack: err?.stack,
    };
}

// ==================== GENERIC HELPERS ====================

/**
 * Rounds a number to a specific number of decimal places.
 * Crucial for avoiding floating point drift in currency and hour calculations.
 *
 * @param num - The number to round.
 * @param decimals - Number of decimal places.
 * @returns The rounded number.
 */
export function round(num: number, decimals = 4): number {
    if (!Number.isFinite(num)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
}

/**
 * Safely parses a JSON string, returning a fallback value on failure.
 *
 * @param text - The JSON string to parse.
 * @param fallback - Value to return if parsing fails.
 * @returns Parsed object or fallback.
 */
export function safeJSONParse<T>(text: string | null, fallback: T): T {
    if (!text) return fallback;
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

/**
 * Escapes HTML special characters to prevent XSS.
 *
 * @param str - The input string.
 * @returns Escaped string safe for HTML insertion.
 */
export function escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Escapes a value for inclusion in a CSV file.
 * Handles quotes, commas, and newlines by wrapping in double quotes.
 * Escapes existing double quotes by doubling them.
 *
 * @param str - The value to escape.
 * @returns The CSV-safe string.
 */
export function escapeCsv(str: unknown): string {
    if (str === null || str === undefined) return '';
    const stringValue = String(str);
    if (/[",\n\r]/.test(stringValue)) {
        return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    return stringValue;
}

/**
 * Parses an ISO 8601 duration string (e.g., "PT8H30M" or "PT8.5H") into decimal hours.
 * Supports fractional hours, minutes, and seconds.
 *
 * @param durationStr - ISO duration string.
 * @returns Duration in decimal hours.
 */
export function parseIsoDuration(durationStr: string | null | undefined): number {
    if (!durationStr) return 0;
    // Support fractional values: PT8.5H, PT30.5M, PT45.5S
    const match = durationStr.match(
        /PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/
    );
    if (!match) return 0;
    const hours = parseFloat(match[1] || '0');
    const minutes = parseFloat(match[2] || '0');
    const seconds = parseFloat(match[3] || '0');
    return hours + minutes / 60 + seconds / 3600;
}

/**
 * Creates a debounced version of a function.
 *
 * @param fn - The function to debounce.
 * @param waitMs - Delay in milliseconds.
 * @returns Debounced function.
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
    fn: T,
    waitMs = 0
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), waitMs);
    };
}

/**
 * Formats a number as a currency string.
 *
 * @param amount - The amount to format.
 * @param currency - Currency code.
 * @returns Formatted currency string.
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(safeAmount);
    } catch {
        return `${currency} ${safeAmount.toFixed(2)}`;
    }
}

/**
 * Formats decimal hours into a readable string (e.g., "8h 30m").
 * Handles edge case where rounding causes 60 minutes.
 *
 * @param hours - Decimal hours.
 * @returns Formatted string.
 */
export function formatHours(hours: number | null | undefined): string {
    if (hours == null || isNaN(hours)) return '0h';
    const h = parseFloat(String(hours));
    let whole = Math.floor(h);
    let mins = Math.round((h - whole) * 60);

    // Handle edge case: 1.9999h rounds to 60 mins -> should be 2h 0m
    if (mins === 60) {
        whole += 1;
        mins = 0;
    }

    return mins === 0 ? `${whole}h` : `${whole}h ${mins}m`;
}

/**
 * Formats decimal hours into a fixed two-decimal string (e.g., "8.50").
 *
 * @param hours - Decimal hours.
 * @param decimals - Decimal places.
 * @returns Formatted decimal string.
 */
export function formatHoursDecimal(hours: number | null | undefined, decimals = 2): string {
    if (hours == null || isNaN(hours)) return '0.00';
    const rounded = round(parseFloat(String(hours)), decimals);
    return rounded.toFixed(decimals);
}

// --- Timezone / Date Integrity Helpers (Antigravity Standard) ---

export const IsoUtils = {
    /**
     * Converts a Date object to an ISO date string (YYYY-MM-DD).
     * Uses UTC methods to prevent local timezone shifts from changing the date.
     *
     * @param date - The date object.
     * @returns YYYY-MM-DD string.
     */
    toISODate(date: Date | null | undefined): string {
        if (!date) return '';
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    /**
     * Parses a YYYY-MM-DD string into a Date object (at UTC midnight).
     *
     * @param dateStr - YYYY-MM-DD string.
     * @returns Date object or null if invalid.
     */
    parseDate(dateStr: string | null | undefined): Date | null {
        if (!dateStr) return null;
        return new Date(`${dateStr}T00:00:00Z`);
    },

    /**
     * Extracts the date portion (YYYY-MM-DD) from an ISO timestamp string.
     * Uses LOCAL time interpretation to ensure that entries created in the user's
     * local evening (e.g., 11 PM) are grouped under that calendar day, even if
     * they are technically the next day in UTC.
     *
     * @param isoString - ISO 8601 timestamp.
     * @returns YYYY-MM-DD string.
     */
    extractDateKey(isoString: string | null | undefined): string | null {
        if (!isoString) return null;
        // If it's already a date string (YYYY-MM-DD), return it
        if (isoString.length === 10) return isoString;

        const date = new Date(isoString);
        if (isNaN(date.getTime())) return null;

        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        // Use local calendar day so entries recorded late at night align with the user's intended day
        return `${y}-${m}-${d}`;
    },

    /**
     * Gets the weekday name (e.g., 'MONDAY') for a given date key.
     *
     * @param dateKey - YYYY-MM-DD string.
     * @returns Uppercase weekday name.
     */
    getWeekdayKey(dateKey: string): string {
        const date = this.parseDate(dateKey);
        if (!date) return '';
        const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        return days[date.getUTCDay()];
    },

    /**
     * Checks if a date falls on a weekend (Sat/Sun).
     *
     * @param dateKey - YYYY-MM-DD string.
     * @returns True if weekend.
     */
    isWeekend(dateKey: string): boolean {
        const date = this.parseDate(dateKey);
        if (!date) return false;
        const day = date.getUTCDay(); // 0=Sun, 6=Sat
        return day === 0 || day === 6;
    },

    /**
     * Generates an array of date strings between start and end (inclusive).
     *
     * @param startIso - Start date YYYY-MM-DD.
     * @param endIso - End date YYYY-MM-DD.
     * @returns Array of date strings.
     */
    generateDateRange(startIso: string, endIso: string): string[] {
        const dates: string[] = [];
        const current = this.parseDate(startIso);
        const end = this.parseDate(endIso);
        if (!current || !end) return [];

        // Iterate inclusive so we represent both the start and end dates
        while (current <= end) {
            dates.push(this.toISODate(current));
            current.setUTCDate(current.getUTCDate() + 1);
        }
        return dates;
    },
};

/**
 * Calculates the ISO week number for a given date.
 * ISO week 1 is the week containing the first Thursday of the year.
 *
 * @param date - The date object.
 * @returns ISO week number (1-53).
 */
export function getISOWeek(date: Date): number {
    const target = new Date(date.valueOf());
    const dayNumber = (date.getDay() + 6) % 7; // Mon=0, Sun=6
    target.setDate(target.getDate() - dayNumber + 3); // Thursday of the week
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const diff = target.getTime() - firstThursday.getTime();
    const weekNumber = 1 + Math.round(diff / 604800000); // 604800000ms = 1 week
    return weekNumber;
}

/**
 * Formats a date key (YYYY-MM-DD) to a human-readable string (e.g., "Jan 20, 2025").
 *
 * @param dateKey - Date string in YYYY-MM-DD format.
 * @returns Formatted date string.
 */
export function formatDate(dateKey: string): string {
    const date = IsoUtils.parseDate(dateKey);
    if (!date) return dateKey;

    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    };
    return date.toLocaleDateString(undefined, options);
}

/**
 * Generates a week key (YYYY-W##) for a given date string.
 *
 * @param dateKey - Date string in YYYY-MM-DD format.
 * @returns Week key in format YYYY-W##.
 */
export function getWeekKey(dateKey: string): string {
    const date = IsoUtils.parseDate(dateKey);
    if (!date) return '';

    // Find Thursday of this week to determine which year the week belongs to
    const target = new Date(date.valueOf());
    const dayNumber = (date.getUTCDay() + 6) % 7; // Mon=0, Sun=6
    target.setUTCDate(target.getUTCDate() - dayNumber + 3); // Thursday

    const year = target.getUTCFullYear();
    const week = getISOWeek(date);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Formats a week key (YYYY-W##) to a human-readable string (e.g., "Week 3, 2025").
 *
 * @param weekKey - Week key in format YYYY-W##.
 * @returns Formatted week string.
 */
export function formatWeekKey(weekKey: string): string {
    const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return weekKey;

    const [, year, week] = match;
    return `Week ${parseInt(week)}, ${year}`;
}

/**
 * Entry classification result
 */
export type EntryClassification = 'break' | 'pto' | 'work';

/**
 * Entry-like object for classification
 */
interface EntryLike {
    type?: string;
}

/**
 * Classifies a time entry for overtime calculation.
 * Determines if an entry should be treated as BREAK, PTO, or WORK.
 *
 * @param entry - Time entry object with a `type` field.
 * @returns Entry classification.
 */
export function classifyEntryForOvertime(entry: EntryLike | null | undefined): EntryClassification {
    if (!entry || !entry.type) return 'work';

    const type = entry.type;

    if (type === 'BREAK') return 'break';
    if (type === 'HOLIDAY' || type === 'TIME_OFF') return 'pto';

    return 'work';
}
