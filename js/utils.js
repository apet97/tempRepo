/**
 * @fileoverview Utility Functions
 * Generic helper functions for date manipulation, error handling, formatting,
 * and data sanitization. These functions are pure and stateless where possible.
 */

import { ERROR_MESSAGES, ERROR_TYPES } from './constants.js';

// ==================== TYPE VALIDATION ====================

/**
 * Creates a validation error.
 * @param {string} message - The error message.
 * @returns {import('./constants.js').FriendlyError} The structured error.
 * @private
 */
function createValidationError(message) {
    return createUserFriendlyError(new Error(message), ERROR_TYPES.VALIDATION);
}

/**
 * Validates that required fields exist in an object.
 * @param {Object} obj - Object to validate.
 * @param {Array<string>} requiredFields - Array of required field names.
 * @param {string} [context='Object'] - Context for error messages.
 * @returns {boolean} true if valid.
 * @throws {Error} with VALIDATION type if validation fails.
 */
export function validateRequiredFields(obj, requiredFields, context = 'Object') {
    if (!obj || typeof obj !== 'object') {
        throw createValidationError(`${context} is not an object`);
    }

    const missing = requiredFields.filter(field => !obj[field]);

    if (missing.length > 0) {
        throw createValidationError(`${context} missing required fields: ${missing.join(', ')}`);
    }

    return true;
}

/**
 * Validates that a value is a valid number.
 * @param {*} value - Value to validate.
 * @param {string} field - Field name for error messages.
 * @returns {number} The validated number.
 * @throws {Error} with VALIDATION type if invalid.
 */
export function validateNumber(value, field) {
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
 * @param {*} value - Value to validate.
 * @param {string} field - Field name for error messages.
 * @returns {string} The validated string.
 * @throws {Error} with VALIDATION type if invalid.
 */
export function validateString(value, field) {
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
 * @param {*} value - Value to validate.
 * @param {string} field - Field name for error messages.
 * @returns {string} The validated date string.
 * @throws {Error} with VALIDATION type if invalid.
 */
export function validateISODateString(value, field) {
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
 * Validates a time entry object structure.
 * @param {*} entry - Entry to validate.
 * @returns {boolean} true if valid.
 * @throws {Error} with VALIDATION type if invalid.
 */
export function validateTimeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        throw createValidationError('Time entry must be an object');
    }

    // Required fields
    validateString(entry.id, 'Time entry ID');
    validateString(entry.userId, 'Time entry user ID');

    // Validate timeInterval
    validateRequiredFields(entry, ['timeInterval'], 'Time entry');
    const interval = entry.timeInterval;
    validateRequiredFields(interval, ['start', 'end'], 'Time interval');

    validateISODateString(interval.start, 'Time entry start time');
    validateISODateString(interval.end, 'Time entry end time');

    // Optional fields validation
    if (interval.duration) {
        validateString(interval.duration, 'Time entry duration');
    }

    if (entry.hourlyRate) {
        validateRequiredFields(entry.hourlyRate, ['amount'], 'Time entry hourly rate');
        validateNumber(entry.hourlyRate.amount, 'Hourly rate amount');
    }

    if (entry.billable !== undefined) {
        if (typeof entry.billable !== 'boolean') {
            throw createValidationError('Time entry billable must be a boolean');
        }
    }

    return true;
}

/**
 * Validates a user object structure.
 * @param {*} user - User to validate.
 * @returns {boolean} true if valid.
 * @throws {Error} with VALIDATION type if invalid.
 */
export function validateUser(user) {
    if (!user || typeof user !== 'object') {
        throw createValidationError('User must be an object');
    }

    validateString(user.id, 'User ID');
    validateString(user.name, 'User name');

    return true;
}

/**
 * Validates a user profile object structure.
 * @param {*} profile - Profile to validate.
 * @returns {boolean} true if valid.
 * @throws {Error} with VALIDATION type if invalid.
 */
export function validateUserProfile(profile) {
    if (!profile || typeof profile !== 'object') {
        throw createValidationError('User profile must be an object');
    }

    if (profile.workCapacity !== undefined) {
        validateString(profile.workCapacity, 'Work capacity');
    }

    if (profile.workingDays !== undefined) {
        if (!Array.isArray(profile.workingDays)) {
            throw createValidationError('Working days must be an array');
        }
        profile.workingDays.forEach((day, index) => {
            if (typeof day !== 'string' || day.trim() === '') {
                throw createValidationError(`Working day at index ${index} must be a non-empty string`);
            }
        });
    }

    return true;
}

/**
 * Validates a date range.
 * @param {string} startDate - Start date in YYYY-MM-DD format.
 * @param {string} endDate - End date in YYYY-MM-DD format.
 * @returns {boolean} true if valid.
 * @throws {Error} with VALIDATION type if validation fails.
 */
export function validateDateRange(startDate, endDate) {
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
 * @param {Error} error - The error object to classify.
 * @returns {string} One of the ERROR_TYPES constants.
 */
export function classifyError(error) {
    if (!error) return ERROR_TYPES.UNKNOWN;

    // Network errors (fetch failures, timeouts)
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return ERROR_TYPES.NETWORK;
    }
    if (error.name === 'AbortError') {
        return ERROR_TYPES.NETWORK;
    }

    // HTTP status based errors (if attached to the error object)
    if (error.status === 401 || error.status === 403) {
        return ERROR_TYPES.AUTH;
    }
    if (error.status >= 400 && error.status < 500) {
        return ERROR_TYPES.VALIDATION;
    }
    if (error.status >= 500) {
        return ERROR_TYPES.API;
    }

    return ERROR_TYPES.UNKNOWN;
}

/**
 * Creates a structured, user-friendly error object from a raw error.
 * 
 * @param {Error|string} error - The raw error or error message.
 * @param {string} [type] - Optional explicit error type override.
 * @returns {import('./constants.js').FriendlyError} Structured error object.
 */
export function createUserFriendlyError(error, type) {
    const errorType = type || classifyError(error);
    const errorMessage = ERROR_MESSAGES[errorType] || ERROR_MESSAGES[ERROR_TYPES.UNKNOWN];

    return {
        type: errorType,
        title: errorMessage.title,
        message: errorMessage.message,
        action: errorMessage.action,
        originalError: error,
        timestamp: new Date().toISOString(),
        stack: error?.stack
    };
}

// ==================== GENERIC HELPERS ====================

/**
 * Rounds a number to a specific number of decimal places.
 * Crucial for avoiding floating point drift in currency and hour calculations.
 * 
 * @param {number} num - The number to round.
 * @param {number} [decimals=4] - Number of decimal places.
 * @returns {number} The rounded number.
 */
export function round(num, decimals = 4) {
    if (!Number.isFinite(num)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
}

/**
 * Safely parses a JSON string, returning a fallback value on failure.
 * 
 * @param {string|null} text - The JSON string to parse.
 * @param {*} fallback - Value to return if parsing fails.
 * @returns {*} Parsed object or fallback.
 */
export function safeJSONParse(text, fallback) {
    if (!text) return fallback;
    try { return JSON.parse(text); } catch (e) { return fallback; }
}

/**
 * Escapes HTML special characters to prevent XSS.
 * 
 * @param {string} str - The input string.
 * @returns {string} Escaped string safe for HTML insertion.
 */
export function escapeHtml(str) {
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
 * @param {*} str - The value to escape.
 * @returns {string} The CSV-safe string.
 */
export function escapeCsv(str) {
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
 * @param {string} durationStr - ISO duration string.
 * @returns {number} Duration in decimal hours.
 */
export function parseIsoDuration(durationStr) {
    if (!durationStr) return 0;
    // Support fractional values: PT8.5H, PT30.5M, PT45.5S
    const match = durationStr.match(/PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (!match) return 0;
    const hours = parseFloat(match[1] || 0);
    const minutes = parseFloat(match[2] || 0);
    const seconds = parseFloat(match[3] || 0);
    return hours + minutes / 60 + seconds / 3600;
}

/**
 * Creates a debounced version of a function.
 * 
 * @param {Function} fn - The function to debounce.
 * @param {number} [waitMs=0] - Delay in milliseconds.
 * @returns {Function} Debounced function.
 */
export function debounce(fn, waitMs = 0) {
    let timeoutId = null;
    return (...args) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), waitMs);
    };
}

/**
 * Formats a number as a currency string.
 * 
 * @param {number} amount - The amount to format.
 * @param {string} [currency='USD'] - Currency code.
 * @returns {string} Formatted currency string.
 */
export function formatCurrency(amount, currency = 'USD') {
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
 * @param {number} hours - Decimal hours.
 * @returns {string} Formatted string.
 */
export function formatHours(hours) {
    if (hours == null || isNaN(hours)) return '0h';
    const h = parseFloat(hours);
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
 * @param {number} hours - Decimal hours.
 * @param {number} [decimals=2] - Decimal places.
 * @returns {string} Formatted decimal string.
 */
export function formatHoursDecimal(hours, decimals = 2) {
    if (hours == null || isNaN(hours)) return '0.00';
    const rounded = round(parseFloat(hours), decimals);
    return rounded.toFixed(decimals);
}

// --- Timezone / Date Integrity Helpers (Antigravity Standard) ---

export const IsoUtils = {
    /**
     * Converts a Date object to an ISO date string (YYYY-MM-DD).
     * Uses UTC methods to prevent local timezone shifts from changing the date.
     * 
     * @param {Date} date - The date object.
     * @returns {string} YYYY-MM-DD string.
     */
    toISODate(date) {
        if (!date) return '';
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    /**
     * Parses a YYYY-MM-DD string into a Date object (at UTC midnight).
     * 
     * @param {string} dateStr - YYYY-MM-DD string.
     * @returns {Date|null} Date object or null if invalid.
     */
    parseDate(dateStr) {
        if (!dateStr) return null;
        return new Date(`${dateStr}T00:00:00Z`);
    },

    /**
     * Extracts the date portion (YYYY-MM-DD) from an ISO timestamp string.
     * Uses LOCAL time interpretation to ensure that entries created in the user's
     * local evening (e.g., 11 PM) are grouped under that calendar day, even if
     * they are technically the next day in UTC.
     * 
     * @param {string} isoString - ISO 8601 timestamp.
     * @returns {string|null} YYYY-MM-DD string.
     */
    extractDateKey(isoString) {
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
     * @param {string} dateKey - YYYY-MM-DD string.
     * @returns {string} Uppercase weekday name.
     */
    getWeekdayKey(dateKey) {
        const date = this.parseDate(dateKey);
        if (!date) return '';
        const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        return days[date.getUTCDay()];
    },

    /**
     * Checks if a date falls on a weekend (Sat/Sun).
     * 
     * @param {string} dateKey - YYYY-MM-DD string.
     * @returns {boolean} True if weekend.
     */
    isWeekend(dateKey) {
        const date = this.parseDate(dateKey);
        if (!date) return false;
        const day = date.getUTCDay(); // 0=Sun, 6=Sat
        return day === 0 || day === 6;
    },

    /**
     * Generates an array of date strings between start and end (inclusive).
     * 
     * @param {string} startIso - Start date YYYY-MM-DD.
     * @param {string} endIso - End date YYYY-MM-DD.
     * @returns {Array<string>} Array of date strings.
     */
    generateDateRange(startIso, endIso) {
        const dates = [];
        const current = this.parseDate(startIso);
        const end = this.parseDate(endIso);
        if (!current || !end) return [];

        // Iterate inclusive so we represent both the start and end dates
        while (current <= end) {
            dates.push(this.toISODate(current));
            current.setUTCDate(current.getUTCDate() + 1);
        }
        return dates;
    }
};

/**
 * Calculates the ISO week number for a given date.
 * ISO week 1 is the week containing the first Thursday of the year.
 *
 * @param {Date} date - The date object.
 * @returns {number} ISO week number (1-53).
 */
export function getISOWeek(date) {
    const target = new Date(date.valueOf());
    const dayNumber = (date.getDay() + 6) % 7; // Mon=0, Sun=6
    target.setDate(target.getDate() - dayNumber + 3); // Thursday of the week
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const diff = target - firstThursday;
    const weekNumber = 1 + Math.round(diff / 604800000); // 604800000ms = 1 week
    return weekNumber;
}

/**
 * Formats a date key (YYYY-MM-DD) to a human-readable string (e.g., "Jan 20, 2025").
 *
 * @param {string} dateKey - Date string in YYYY-MM-DD format.
 * @returns {string} Formatted date string.
 */
export function formatDate(dateKey) {
    const date = IsoUtils.parseDate(dateKey);
    if (!date) return dateKey;

    const options = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };
    return date.toLocaleDateString(undefined, options);
}

/**
 * Generates a week key (YYYY-W##) for a given date string.
 *
 * @param {string} dateKey - Date string in YYYY-MM-DD format.
 * @returns {string} Week key in format YYYY-W##.
 */
export function getWeekKey(dateKey) {
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
 * @param {string} weekKey - Week key in format YYYY-W##.
 * @returns {string} Formatted week string.
 */
export function formatWeekKey(weekKey) {
    const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return weekKey;

    const [, year, week] = match;
    return `Week ${parseInt(week)}, ${year}`;
}

/**
 * Classifies a time entry for overtime calculation.
 * Determines if an entry should be treated as BREAK, PTO, or WORK.
 *
 * @param {Object} entry - Time entry object with a `type` field.
 * @returns {'break' | 'pto' | 'work'} Entry classification.
 */
export function classifyEntryForOvertime(entry) {
    if (!entry || !entry.type) return 'work';

    const type = entry.type;

    if (type === 'BREAK') return 'break';
    if (type === 'HOLIDAY' || type === 'TIME_OFF') return 'pto';

    return 'work';
}
