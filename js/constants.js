/**
 * @fileoverview Application Constants & Type Definitions
 * Contains global constants, configuration defaults, and JSDoc type definitions
 * shared across the application.
 */

/**
 * Keys used for LocalStorage persistence.
 * @enum {string}
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
    UI_STATE: 'otplus_ui_state'
};

/**
 * Global application constants.
 * @enum {number|string}
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
    DATE_FORMAT_ISO: 'YYYY-MM-DD'
};

/**
 * Definition of columns for the Summary Table.
 * @type {Array<{key: string, label: string, defaultVisible: boolean}>}
 */
export const SUMMARY_COLUMNS = [
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
    { key: 'profit', label: 'Profit', defaultVisible: true }
];

/**
 * Dynamically generated weekday labels using the browser's locale.
 * Maps API weekday keys (e.g., 'MONDAY') to localized short labels (e.g., 'Mon').
 * 
 * @type {Array<{key: string, label: string}>}
 */
export const WEEKDAYS = (() => {
    const days = [];
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

// ==================== TYPE DEFINITIONS ====================

/**
 * Represents a single time entry fetched from Clockify.
 * @typedef {Object} TimeEntry
 * @property {string} id - Unique identifier for the entry
 * @property {string} userId - User ID
 * @property {string} userName - User display name
 * @property {string} [userEmail] - User email address
 * @property {Object} timeInterval - Time period
 * @property {string} timeInterval.start - ISO 8601 start timestamp
 * @property {string} timeInterval.end - ISO 8601 end timestamp
 * @property {string} [timeInterval.duration] - ISO 8601 duration (e.g., PT8H30M)
 * @property {Object} [project] - Project information
 * @property {string} [project.name] - Project name
 * @property {string} [project.id] - Project ID
 * @property {Object} [hourlyRate] - Rate information
 * @property {number} [hourlyRate.amount] - Rate in cents
 * @property {number|Object} [earnedRate] - Earned/billable rate in cents
 * @property {number|Object} [costRate] - Cost rate in cents
 * @property {string} [currency] - Currency code (e.g., 'USD')
 * @property {string} [description] - Entry description
 * @property {Array<Object>} [tags] - Tags array
 * @property {boolean} [billable] - Whether entry is billable
 * @property {string} [type] - Entry type (e.g., 'BREAK')
 * @property {EntryAnalysis} [analysis] - Calculated analysis data attached during processing
 * @property {Object} [dayMeta] - Contextual data about the day (holiday, etc.) attached during processing
 */

/**
 * Represents a Clockify User.
 * @typedef {Object} User
 * @property {string} id - User ID
 * @property {string} name - User display name
 * @property {string} [email] - User email
 * @property {string} [status] - User status (e.g., 'ACTIVE')
 */

/**
 * Represents a user's workspace profile settings.
 * @typedef {Object} UserProfile
 * @property {string} userId - User ID
 * @property {number} workCapacityHours - Daily capacity in hours (e.g., 7.5)
 * @property {Array<string>} workingDays - Array of weekday keys ['MONDAY', 'TUESDAY', ...]
 * @property {string} [workCapacity] - ISO 8601 duration string (e.g., 'PT8H')
 */

/**
 * Represents a holiday.
 * @typedef {Object} Holiday
 * @property {string} name - Holiday name
 * @property {Object} datePeriod - Date range
 * @property {string} datePeriod.startDate - ISO 8601 start date
 * @property {string} [datePeriod.endDate] - ISO 8601 end date
 */

/**
 * Represents a time off request.
 * @typedef {Object} TimeOffRequest
 * @property {string} userId - User ID
 * @property {string} [requesterUserId] - Requester user ID
 * @property {Object} timeOffPeriod - Time off period
 * @property {string} timeOffPeriod.startDate - Start date in ISO format
 * @property {string} [timeOffPeriod.endDate] - End date in ISO format
 * @property {boolean} [timeOffPeriod.halfDay] - Whether it's a half day
 * @property {number} [timeOffPeriod.halfDayHours] - Hours for half day
 * @property {string} status - Request status (e.g., 'APPROVED', 'PENDING')
 * @property {string} [timeUnit] - Time unit ('DAYS' or 'HOURS')
 */

/**
 * Analysis data calculated for a specific time entry.
 * @typedef {Object} EntryAnalysis
 * @property {number} regular - Regular hours
 * @property {number} overtime - Overtime hours
 * @property {boolean} isBillable - Whether entry is billable
 * @property {boolean} isBreak - Whether entry is a break
 * @property {number} cost - Displayed total amount in currency
 * @property {number} profit - Total profit in currency
 * @property {Array<string>} tags - Array of tags like ['HOLIDAY', 'OFF-DAY']
 */

/**
 * Aggregated data for a single day for a user.
 * @typedef {Object} DayData
 * @property {Array<TimeEntry>} entries - Array of time entries for the day
 * @property {Object} meta - Metadata about the day's capacity context
 * @property {number} meta.capacity - Effective capacity
 * @property {boolean} meta.isHoliday - Whether the day is a holiday
 * @property {string} [meta.holidayName] - Holiday name if applicable
 * @property {boolean} meta.isNonWorking - Whether it's a non-working day
 * @property {boolean} meta.isTimeOff - Whether the user has time off
 */

/**
 * Aggregated totals for a user across the entire report period.
 * @typedef {Object} UserTotals
 * @property {number} regular - Total regular hours
 * @property {number} overtime - Total overtime hours
 * @property {number} total - Total hours (regular + overtime)
 * @property {number} breaks - Total break hours
 * @property {number} billableWorked - Total billable hours
 * @property {number} nonBillableWorked - Total non-billable hours
 * @property {number} billableOT - Total billable overtime hours
 * @property {number} nonBillableOT - Total non-billable overtime hours
 * @property {number} amount - Total amount in currency
 * @property {number} profit - Total profit in currency
 * @property {number} otPremium - Overtime premium amount
 * @property {number} expectedCapacity - Expected capacity across date range
 * @property {number} holidayCount - Number of holidays
 * @property {number} timeOffCount - Number of time off days
 */

/**
 * Complete analysis result for a user.
 * @typedef {Object} UserAnalysis
 * @property {string} userId - User ID
 * @property {string} userName - User display name
 * @property {Map<string, DayData>} days - Map of date keys to day data
 * @property {UserTotals} totals - Aggregated totals
 */

/**
 * Global configuration object for calculation settings.
 * @typedef {Object} OvertimeConfig
 * @property {boolean} useProfileCapacity - Use profile capacity if available
 * @property {boolean} useProfileWorkingDays - Respect profile working days
 * @property {boolean} applyHolidays - Apply holidays to capacity calculation
 * @property {boolean} applyTimeOff - Apply time off to capacity calculation
 * @property {boolean} showBillableBreakdown - Show billable breakdown in UI
 * @property {'earned'|'cost'} amountDisplay - Amount display mode
 * @property {string} overtimeBasis - 'daily' or 'weekly'
 */

/**
 * Parameters for calculations.
 * @typedef {Object} CalculationParams
 * @property {number} dailyThreshold - Default daily capacity in hours (e.g., 8)
 * @property {number} weeklyThreshold - Default weekly capacity in hours (e.g., 40)
 * @property {number} overtimeMultiplier - Overtime premium multiplier (e.g., 1.5)
 */

/**
 * User-specific overrides for calculation parameters.
 * @typedef {Object} UserOverride
 * @property {'global'|'perDay'} [mode='global'] - Override mode (global or per-day)
 * @property {string} [capacity] - Global capacity override in hours (stored as string from input)
 * @property {string} [multiplier] - Global overtime multiplier (stored as string from input)
 * @property {Object.<string, PerDayOverride>} [perDayOverrides] - Per-day overrides keyed by dateKey (YYYY-MM-DD)
 */

/**
 * Per-day override for a specific date.
 * @typedef {Object} PerDayOverride
 * @property {string|number} [capacity] - Capacity for specific day in hours
 * @property {string|number} [multiplier] - Multiplier for specific day
 */

/**
 * Tracking object for API failures.
 * @typedef {Object} ApiStatus
 * @property {number} profilesFailed - Count of failed profile fetches
 * @property {number} holidaysFailed - Count of failed holiday fetches
 * @property {number} timeOffFailed - Count of failed time off fetches
 */

/**
 * User-friendly error object.
 * @typedef {Object} FriendlyError
 * @property {string} type - Error type from ERROR_TYPES
 * @property {string} title - User-friendly error title
 * @property {string} message - User-friendly error message
 * @property {string} action - Suggested action ('retry', 'reload', 'none')
 * @property {Error} originalError - Original error object
 * @property {string} timestamp - ISO timestamp of when error occurred
 * @property {string} [stack] - Error stack trace for debugging
 */

// ==================== ERROR CONSTANTS ====================

/**
 * Classification of error types.
 * @enum {string}
 */
export const ERROR_TYPES = {
    NETWORK: 'NETWORK_ERROR',
    AUTH: 'AUTH_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    API: 'API_ERROR',
    UNKNOWN: 'UNKNOWN_ERROR'
};

/**
 * User-facing messages and actions for each error type.
 */
export const ERROR_MESSAGES = {
    [ERROR_TYPES.NETWORK]: {
        title: 'Network Error',
        message: 'Unable to connect to Clockify. Please check your internet connection and try again.',
        action: 'retry'
    },
    [ERROR_TYPES.AUTH]: {
        title: 'Authentication Error',
        message: 'Your session has expired or the authentication token is invalid. Please reload the addon.',
        action: 'reload'
    },
    [ERROR_TYPES.VALIDATION]: {
        title: 'Validation Error',
        message: 'Invalid data was received from Clockify. Please check your inputs and try again.',
        action: 'none'
    },
    [ERROR_TYPES.API]: {
        title: 'API Error',
        message: 'Clockify API returned an error. The service may be temporarily unavailable.',
        action: 'retry'
    },
    [ERROR_TYPES.UNKNOWN]: {
        title: 'Unexpected Error',
        message: 'An unexpected error occurred. Please try again or contact support if the issue persists.',
        action: 'none'
    }
};
