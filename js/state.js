/**
 * @fileoverview State Management Module
 * Implements a centralized Store class acting as the single source of truth for the application.
 * Manages API data, configuration, user overrides, and UI state.
 * Implements a simple Publisher/Subscriber pattern for reactivity.
 */

import { safeJSONParse } from './utils.js';
import { STORAGE_KEYS } from './constants.js';

/**
 * Central state store for the application.
 */
class Store {
    /**
     * Initializes the store with default configuration and empty data structures.
     */
    constructor() {
        /** @type {string|null} Authentication token. */
        this.token = null;
        /** @type {Object|null} Decoded token claims (workspaceId, etc.). */
        this.claims = null;
        /** @type {Array<Object>} List of users in the workspace. */
        this.users = [];
        /** @type {Array<Object>|null} Raw time entries from API. */
        this.rawEntries = null;
        /** @type {Array<Object>|null} Processed analysis results. */
        this.analysisResults = null;
        /** @type {Object|null} Current date range for calculations (HIGH FIX #8). */
        this.currentDateRange = null;

        /** 
         * Feature flags and calculation behavior configuration. 
         * @type {Object}
         */
        this.config = {
            useProfileCapacity: true,
            useProfileWorkingDays: true,
            applyHolidays: true,
            applyTimeOff: true,
            showBillableBreakdown: true,
            showDecimalTime: false,
            amountDisplay: 'earned',
            overtimeBasis: 'daily'
        };

        /**
         * Numeric parameters for calculation logic.
         * @type {Object}
         */
        this.calcParams = {
            dailyThreshold: 8,
            weeklyThreshold: 40,
            overtimeMultiplier: 1.5,
            tier2ThresholdHours: 0,
            tier2Multiplier: 2.0
        };

        // Load persisted config from LocalStorage
        this._loadConfig();
        this._loadUIState();

        /** @type {Map<string, Object>} Cache of user profiles (Key: userId). */
        this.profiles = new Map();
        /** @type {Map<string, Object>} Cache of user holidays (Key: userId). */
        this.holidays = new Map();
        /** @type {Map<string, Object>} Cache of user time-off (Key: userId). */
        this.timeOff = new Map();

        /** @type {Object.<string, Object>} User specific overrides (capacity/multiplier). */
        this.overrides = {};

        /** 
         * API error tracking for partial failure reporting.
         * @type {Object} 
         */
        this.apiStatus = {
            profilesFailed: 0,
            holidaysFailed: 0,
            timeOffFailed: 0
        };

        /** 
         * Ephemeral UI state.
         * @type {Object}
         */
        this.ui = {
            isLoading: false,
            summaryExpanded: false,
            summaryGroupBy: 'user',
            overridesCollapsed: true,
            activeTab: 'summary',
            detailedPage: 1,
            detailedPageSize: 50,
            activeDetailedFilter: 'all',
            hasCostRates: true
        };

        /** @type {Set<Function>} Set of subscriber functions. */
        this.listeners = new Set();
    }

    /**
     * Subscribes a listener function to state changes.
     * @param {Function} listener - Function to call on notify.
     * @returns {Function} Unsubscribe function.
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Notifies all subscribers of a state change.
     * @param {Object} [event] - Optional event data describing the change.
     */
    notify(event = {}) {
        this.listeners.forEach(listener => listener(this, event));
    }

    /**
     * Loads configuration from LocalStorage.
     * Uses safeJSONParse to prevent crashes from malformed data.
     * @private
     */
    _loadConfig() {
        const savedConfig = localStorage.getItem('otplus_config');
        if (savedConfig) {
            const parsed = safeJSONParse(savedConfig, null);
            if (parsed && typeof parsed === 'object') {
                // Merge config with validation
                if (parsed.config && typeof parsed.config === 'object') {
                    this.config = { ...this.config, ...parsed.config };
                }
                const amountDisplay = String(this.config.amountDisplay || '').toLowerCase();
                const validAmountDisplays = new Set(['earned', 'cost']);
                this.config.amountDisplay = validAmountDisplays.has(amountDisplay)
                    ? amountDisplay
                    : 'earned';
                // Merge calcParams with validation
                if (parsed.calcParams && typeof parsed.calcParams === 'object') {
                    const cp = parsed.calcParams;
                    if (typeof cp.dailyThreshold === 'number' && cp.dailyThreshold >= 0) {
                        this.calcParams.dailyThreshold = cp.dailyThreshold;
                    }
                    if (typeof cp.weeklyThreshold === 'number' && cp.weeklyThreshold >= 0) {
                        this.calcParams.weeklyThreshold = cp.weeklyThreshold;
                    }
                    if (typeof cp.overtimeMultiplier === 'number' && cp.overtimeMultiplier >= 1) {
                        this.calcParams.overtimeMultiplier = cp.overtimeMultiplier;
                    }
                    if (typeof cp.tier2ThresholdHours === 'number' && cp.tier2ThresholdHours >= 0) {
                        this.calcParams.tier2ThresholdHours = cp.tier2ThresholdHours;
                    }
                    if (typeof cp.tier2Multiplier === 'number' && cp.tier2Multiplier >= 1) {
                        this.calcParams.tier2Multiplier = cp.tier2Multiplier;
                    }
                }
            }
        }
    }

    /**
     * Persists current configuration to LocalStorage.
     */
    saveConfig() {
        localStorage.setItem('otplus_config', JSON.stringify({
            config: this.config,
            calcParams: this.calcParams
        }));
    }

    /**
     * Sets authentication token and loads relevant persistent data.
     * Clears caches if switching workspaces to prevent data leak/corruption.
     * 
     * @param {string} token - The raw JWT token.
     * @param {Object} claims - Decoded payload of the token.
     */
    setToken(token, claims) {
        // Clear cache if workspace changes to prevent stale profile data
        if (this.claims && this.claims.workspaceId !== claims.workspaceId) {
            this.profiles.clear();
            this.holidays.clear();
            this.timeOff.clear();
        }
        
        this.token = token;
        this.claims = claims;
        this._loadOverrides();
    }

    /**
     * Generates storage key for overrides based on workspace ID.
     * @returns {string|null} Storage key or null if no workspace.
     * @private
     */
    _getOverrideKey() {
        return this.claims?.workspaceId ? `${STORAGE_KEYS.OVERRIDES_PREFIX}${this.claims.workspaceId}` : null;
    }

    /**
     * Loads user overrides from LocalStorage.
     * @private
     */
    _loadOverrides() {
        const key = this._getOverrideKey();
        if (key) {
            const saved = localStorage.getItem(key);
            this.overrides = safeJSONParse(saved, {});

            // Migrate old format: add mode if missing
            Object.keys(this.overrides).forEach(userId => {
                if (!this.overrides[userId].mode) {
                    this.overrides[userId].mode = 'global';
                }
            });
        }
    }

    /**
     * Saves user overrides to LocalStorage.
     */
    saveOverrides() {
        const key = this._getOverrideKey();
        if (key) {
            localStorage.setItem(key, JSON.stringify(this.overrides));
        }
    }

    /**
     * Updates a specific override field for a user.
     * Removes the key if value is empty/null.
     * Validates numeric values to prevent NaN propagation.
     *
     * @param {string} userId - User ID.
     * @param {string} field - Field to update (capacity/multiplier).
     * @param {string|number} value - New value.
     * @returns {boolean} True if update was successful, false if validation failed.
     */
    updateOverride(userId, field, value) {
        if (!this.overrides[userId]) this.overrides[userId] = {};

        if (value === null || value === '') {
            delete this.overrides[userId][field];
            if (Object.keys(this.overrides[userId]).length === 0) {
                delete this.overrides[userId];
            }
        } else {
            // Validate numeric fields
            const numValue = parseFloat(value);
            if (isNaN(numValue)) {
                console.warn(`Invalid override value for ${field}: ${value}`);
                return false;
            }

            // Validate field-specific constraints
            if (field === 'capacity' && numValue < 0) {
                console.warn(`Capacity cannot be negative: ${value}`);
                return false;
            }
            if (field === 'multiplier' && numValue < 1) {
                console.warn(`Multiplier must be at least 1: ${value}`);
                return false;
            }
            if (field === 'tier2Threshold' && numValue < 0) {
                console.warn(`Tier2 threshold cannot be negative: ${value}`);
                return false;
            }
            if (field === 'tier2Multiplier' && numValue < 1) {
                console.warn(`Tier2 multiplier must be at least 1: ${value}`);
                return false;
            }

            this.overrides[userId][field] = value;
        }
        this.saveOverrides();
        return true;
    }

    /**
     * Sets the override mode for a user (global, weekly, or perDay).
     * @param {string} userId - User ID.
     * @param {'global'|'weekly'|'perDay'} mode - Override mode.
     * @returns {boolean} True if successful, false if invalid mode.
     */
    setOverrideMode(userId, mode) {
        if (!['global', 'weekly', 'perDay'].includes(mode)) {
            console.warn(`Invalid override mode: ${mode}`);
            return false;
        }
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode };
        } else {
            this.overrides[userId].mode = mode;
        }

        // Initialize perDayOverrides if switching to perDay mode
        if (mode === 'perDay' && !this.overrides[userId].perDayOverrides) {
            this.overrides[userId].perDayOverrides = {};
        }
        // Initialize weeklyOverrides if switching to weekly mode
        if (mode === 'weekly' && !this.overrides[userId].weeklyOverrides) {
            this.overrides[userId].weeklyOverrides = {};
        }

        this.saveOverrides();
        return true;
    }

    /**
     * Updates a per-day override for a specific user and date.
     * @param {string} userId - User ID.
     * @param {string} dateKey - Date in YYYY-MM-DD format.
     * @param {string} field - Field to update (capacity/multiplier).
     * @param {string|number} value - New value.
     * @returns {boolean} True if update was successful, false if validation failed.
     */
    updatePerDayOverride(userId, dateKey, field, value) {
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: 'perDay', perDayOverrides: {} };
        }

        if (!this.overrides[userId].perDayOverrides) {
            this.overrides[userId].perDayOverrides = {};
        }

        if (!this.overrides[userId].perDayOverrides[dateKey]) {
            this.overrides[userId].perDayOverrides[dateKey] = {};
        }

        // Same validation logic as updateOverride()
        if (value === null || value === '') {
            delete this.overrides[userId].perDayOverrides[dateKey][field];

            // Cleanup empty day entries
            if (Object.keys(this.overrides[userId].perDayOverrides[dateKey]).length === 0) {
                delete this.overrides[userId].perDayOverrides[dateKey];
            }
        } else {
            const numValue = parseFloat(value);
            if (isNaN(numValue)) {
                console.warn(`Invalid per-day override value for ${field}: ${value}`);
                return false;
            }

            if (field === 'capacity' && numValue < 0) {
                console.warn(`Capacity cannot be negative: ${value}`);
                return false;
            }
            if (field === 'multiplier' && numValue < 1) {
                console.warn(`Multiplier must be at least 1: ${value}`);
                return false;
            }
            if (field === 'tier2Threshold' && numValue < 0) {
                console.warn(`Per-day tier2Threshold cannot be negative: ${value}`);
                return false;
            }
            if (field === 'tier2Multiplier' && numValue < 1) {
                console.warn(`Per-day tier2Multiplier must be at least 1: ${value}`);
                return false;
            }

            this.overrides[userId].perDayOverrides[dateKey][field] = value;
        }

        this.saveOverrides();
        return true;
    }

    /**
     * Copies global override values to all days in the provided date range for per-day mode.
     * @param {string} userId - User ID.
     * @param {Array<string>} dates - Array of date keys (YYYY-MM-DD format).
     * @returns {boolean} True if successful, false if preconditions not met.
     */
    copyGlobalToPerDay(userId, dates) {
        const override = this.overrides[userId];
        if (!override || override.mode !== 'perDay') {
            console.warn(`Cannot copy: user ${userId} not in perDay mode`);
            return false;
        }

        if (!dates || dates.length === 0) {
            console.warn('Cannot copy: no dates provided');
            return false;
        }

        const globalCapacity = override.capacity;
        const globalMultiplier = override.multiplier;
        const globalTier2Threshold = override.tier2Threshold;
        const globalTier2Multiplier = override.tier2Multiplier;

        // Copy global values to all days in range
        dates.forEach(dateKey => {
            if (!override.perDayOverrides[dateKey]) {
                override.perDayOverrides[dateKey] = {};
            }

            if (globalCapacity !== undefined && globalCapacity !== '') {
                override.perDayOverrides[dateKey].capacity = globalCapacity;
            }
            if (globalMultiplier !== undefined && globalMultiplier !== '') {
                override.perDayOverrides[dateKey].multiplier = globalMultiplier;
            }
            if (globalTier2Threshold !== undefined && globalTier2Threshold !== '') {
                override.perDayOverrides[dateKey].tier2Threshold = globalTier2Threshold;
            }
            if (globalTier2Multiplier !== undefined && globalTier2Multiplier !== '') {
                override.perDayOverrides[dateKey].tier2Multiplier = globalTier2Multiplier;
            }
        });

        this.saveOverrides();
        return true;
    }

    /**
     * Sets weekly override for specific weekday.
     * @param {string} userId - User ID.
     * @param {string} weekday - 'MONDAY', 'TUESDAY', etc.
     * @param {string} field - 'capacity' or 'multiplier'.
     * @param {string|number} value - The value to set.
     * @returns {boolean} True if successful, false if invalid.
     */
    setWeeklyOverride(userId, weekday, field, value) {
        // Initialize structure
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: 'weekly', weeklyOverrides: {} };
        }
        if (!this.overrides[userId].weeklyOverrides) {
            this.overrides[userId].weeklyOverrides = {};
        }
        if (!this.overrides[userId].weeklyOverrides[weekday]) {
            this.overrides[userId].weeklyOverrides[weekday] = {};
        }

        // Validation (same as updateOverride)
        if (value === null || value === '') {
            delete this.overrides[userId].weeklyOverrides[weekday][field];
            if (Object.keys(this.overrides[userId].weeklyOverrides[weekday]).length === 0) {
                delete this.overrides[userId].weeklyOverrides[weekday];
            }
        } else {
            const numValue = parseFloat(value);
            if (isNaN(numValue)) return false;
            if (field === 'capacity' && numValue < 0) return false;
            if (field === 'multiplier' && numValue < 1) return false;
            if (field === 'tier2Threshold' && numValue < 0) return false;
            if (field === 'tier2Multiplier' && numValue < 1) return false;
            this.overrides[userId].weeklyOverrides[weekday][field] = value;
        }

        this.saveOverrides();
        return true;
    }

    /**
     * Copies global values to all weekdays for a user in weekly mode.
     * @param {string} userId - User ID.
     * @returns {boolean} True if successful, false if not in weekly mode.
     */
    copyGlobalToWeekly(userId) {
        const override = this.overrides[userId];
        if (!override || override.mode !== 'weekly') return false;

        const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        weekdays.forEach(weekday => {
            if (!override.weeklyOverrides[weekday]) {
                override.weeklyOverrides[weekday] = {};
            }
            if (override.capacity !== undefined && override.capacity !== '') {
                override.weeklyOverrides[weekday].capacity = override.capacity;
            }
            if (override.multiplier !== undefined && override.multiplier !== '') {
                override.weeklyOverrides[weekday].multiplier = override.multiplier;
            }
            if (override.tier2Threshold !== undefined && override.tier2Threshold !== '') {
                override.weeklyOverrides[weekday].tier2Threshold = override.tier2Threshold;
            }
            if (override.tier2Multiplier !== undefined && override.tier2Multiplier !== '') {
                override.weeklyOverrides[weekday].tier2Multiplier = override.tier2Multiplier;
            }
        });

        this.saveOverrides();
        return true;
    }

    /**
     * Retrieves overrides for a specific user.
     * @param {string} userId - User ID.
     * @returns {Object} Override object (empty if none).
     */
    getUserOverride(userId) {
        return this.overrides[userId] || {};
    }

    /**
     * Resets API failure counters.
     */
    resetApiStatus() {
        this.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
    }

    /**
     * Clears cached data maps (holidays, timeOff) before fetching new data.
     * Profiles are kept as they rarely change within a session.
     */
    clearFetchCache() {
        this.holidays.clear();
        this.timeOff.clear();
    }

    /**
     * Loads UI state from LocalStorage.
     * @private
     */
    _loadUIState() {
        const saved = localStorage.getItem(STORAGE_KEYS.UI_STATE);
        if (saved) {
            const parsed = safeJSONParse(saved, null);
            if (parsed && typeof parsed === 'object') {
                this.ui = { ...this.ui, ...parsed };
            }
        }
    }

    /**
     * Saves UI state to LocalStorage.
     */
    saveUIState() {
        localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({
            summaryExpanded: this.ui.summaryExpanded,
            summaryGroupBy: this.ui.summaryGroupBy,
            overridesCollapsed: this.ui.overridesCollapsed
        }));
    }
}

export const store = new Store();
