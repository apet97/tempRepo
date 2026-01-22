/**
 * @fileoverview State Management Module
 * Implements a centralized Store class acting as the single source of truth for the application.
 * Manages API data, configuration, user overrides, and UI state.
 * Implements a simple Publisher/Subscriber pattern for reactivity.
 */

import { safeJSONParse } from './utils.js';
import { STORAGE_KEYS, DEFAULT_MAX_PAGES, REPORT_CACHE_TTL } from './constants.js';
import type {
    User,
    UserProfile,
    Holiday,
    TimeOffInfo,
    TimeEntry,
    UserAnalysis,
    OvertimeConfig,
    CalculationParams,
    UserOverride,
    ApiStatus,
    UIState,
    DateRange,
    TokenClaims,
} from './types.js';

/**
 * Cache entry for report data stored in sessionStorage
 */
interface ReportCache {
    /** Cache key: `${workspaceId}-${start}-${end}` */
    key: string;
    /** Timestamp when cache was created */
    timestamp: number;
    /** Cached time entries */
    entries: TimeEntry[];
}

/**
 * Listener function type
 */
type StoreListener = (store: Store, event?: Record<string, unknown>) => void;

/**
 * Central state store for the application.
 */
class Store {
    /** Authentication token. */
    token: string | null = null;
    /** Decoded token claims (workspaceId, etc.). */
    claims: TokenClaims | null = null;
    /** List of users in the workspace. */
    users: User[] = [];
    /** Raw time entries from API. */
    rawEntries: TimeEntry[] | null = null;
    /** Processed analysis results. */
    analysisResults: UserAnalysis[] | null = null;
    /** Current date range for calculations. */
    currentDateRange: DateRange | null = null;

    /**
     * Feature flags and calculation behavior configuration.
     */
    config: OvertimeConfig = {
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: true,
        applyTimeOff: true,
        showBillableBreakdown: true,
        showDecimalTime: false,
        amountDisplay: 'earned',
        overtimeBasis: 'daily',
        maxPages: DEFAULT_MAX_PAGES,
    };

    /**
     * Numeric parameters for calculation logic.
     */
    calcParams: CalculationParams = {
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 0,
        tier2Multiplier: 2.0,
    };

    /** Cache of user profiles (Key: userId). */
    profiles: Map<string, UserProfile> = new Map();
    /** Cache of user holidays (Key: userId, Value: Map of dateKey -> Holiday). */
    holidays: Map<string, Map<string, Holiday>> = new Map();
    /** Cache of user time-off (Key: userId, Value: Map of dateKey -> TimeOffInfo). */
    timeOff: Map<string, Map<string, TimeOffInfo>> = new Map();

    /** User specific overrides (capacity/multiplier). */
    overrides: Record<string, UserOverride> = {};

    /**
     * API error tracking for partial failure reporting.
     */
    apiStatus: ApiStatus = {
        profilesFailed: 0,
        holidaysFailed: 0,
        timeOffFailed: 0,
    };

    /**
     * Throttle status tracking for rate limit retries.
     */
    throttleStatus: {
        retryCount: number;
        lastRetryTime: number | null;
    } = {
        retryCount: 0,
        lastRetryTime: null,
    };

    /**
     * Ephemeral UI state.
     */
    ui: UIState = {
        isLoading: false,
        summaryExpanded: false,
        summaryGroupBy: 'user',
        overridesCollapsed: true,
        activeTab: 'summary',
        detailedPage: 1,
        detailedPageSize: 50,
        activeDetailedFilter: 'all',
        hasCostRates: true,
    };

    /** Set of subscriber functions. */
    listeners: Set<StoreListener> = new Set();

    /**
     * Initializes the store with default configuration and empty data structures.
     */
    constructor() {
        // Load persisted config from LocalStorage
        this._loadConfig();
        this._loadUIState();
    }

    /**
     * Subscribes a listener function to state changes.
     * @param listener - Function to call on notify.
     * @returns Unsubscribe function.
     */
    subscribe(listener: StoreListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Notifies all subscribers of a state change.
     * @param event - Optional event data describing the change.
     */
    notify(event: Record<string, unknown> = {}): void {
        this.listeners.forEach((listener) => listener(this, event));
    }

    /**
     * Loads configuration from LocalStorage.
     * Uses safeJSONParse to prevent crashes from malformed data.
     * @private
     */
    private _loadConfig(): void {
        // Load persisted configuration blob (calc params + toggles)
        const savedConfig = localStorage.getItem('otplus_config');
        if (savedConfig) {
            const parsed = safeJSONParse<{
                config?: Partial<OvertimeConfig>;
                calcParams?: Partial<CalculationParams>;
            } | null>(savedConfig, null);
            if (parsed && typeof parsed === 'object') {
                // Merge config with validation
                if (parsed.config && typeof parsed.config === 'object') {
                    this.config = { ...this.config, ...parsed.config };
                }
                const amountDisplay = String(this.config.amountDisplay || '').toLowerCase();
                const validAmountDisplays = new Set(['earned', 'cost', 'profit']);
                // Coerce amount display to a supported mode to keep the dropdown in sync
                this.config.amountDisplay = validAmountDisplays.has(amountDisplay)
                    ? (amountDisplay as 'earned' | 'cost' | 'profit')
                    : 'earned';
                // Validate and set maxPages
                const configMaxPages = parsed.config?.maxPages;
                if (typeof configMaxPages === 'number' && configMaxPages >= 0) {
                    this.config.maxPages = configMaxPages;
                }
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
                    if (
                        typeof cp.tier2ThresholdHours === 'number' &&
                        cp.tier2ThresholdHours >= 0
                    ) {
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
    saveConfig(): void {
        // Persist both config toggles and numeric parameters in one JSON blob for easy retrieval
        localStorage.setItem(
            'otplus_config',
            JSON.stringify({
                config: this.config,
                calcParams: this.calcParams,
            })
        );
    }

    /**
     * Sets authentication token and loads relevant persistent data.
     * Clears caches if switching workspaces to prevent data leak/corruption.
     *
     * @param token - The raw JWT token.
     * @param claims - Decoded payload of the token.
     */
    setToken(token: string, claims: TokenClaims): void {
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
     * @returns Storage key or null if no workspace.
     * @private
     */
    private _getOverrideKey(): string | null {
        // Each workspace has a unique override bucket to avoid collisions between tenants
        return this.claims?.workspaceId
            ? `${STORAGE_KEYS.OVERRIDES_PREFIX}${this.claims.workspaceId}`
            : null;
    }

    /**
     * Loads user overrides from LocalStorage.
     * @private
     */
    private _loadOverrides(): void {
        // Read per-workspace override data so we can rehydrate editor state
        const key = this._getOverrideKey();
        if (key) {
            const saved = localStorage.getItem(key);
            this.overrides = safeJSONParse<Record<string, UserOverride>>(saved, {});

            // Migrate old format: add mode if missing
            Object.keys(this.overrides).forEach((userId) => {
                if (!this.overrides[userId].mode) {
                    // Backfill legacy overrides that lacked a mode flag
                    this.overrides[userId].mode = 'global';
                }
            });
        }
    }

    /**
     * Saves user overrides to LocalStorage.
     */
    saveOverrides(): void {
        const key = this._getOverrideKey();
        if (key) {
            // Persist overrides separately so user-level changes survive reloads
            localStorage.setItem(key, JSON.stringify(this.overrides));
        }
    }

    /**
     * Updates a specific override field for a user.
     * Removes the key if value is empty/null.
     * Validates numeric values to prevent NaN propagation.
     *
     * @param userId - User ID.
     * @param field - Field to update (capacity/multiplier).
     * @param value - New value.
     * @returns True if update was successful, false if validation failed.
     */
    updateOverride(userId: string, field: string, value: string | number | null): boolean {
        if (!this.overrides[userId]) this.overrides[userId] = {};

        if (value === null || value === '') {
            delete (this.overrides[userId] as Record<string, unknown>)[field];
            if (Object.keys(this.overrides[userId]).length === 0) {
                delete this.overrides[userId];
            }
        } else {
            // Validate numeric value before persisting to avoid NaN propagation
            const numValue = parseFloat(String(value));
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

            (this.overrides[userId] as Record<string, unknown>)[field] = value;
        }
        this.saveOverrides();
        return true;
    }

    /**
     * Sets the override mode for a user (global, weekly, or perDay).
     * @param userId - User ID.
     * @param mode - Override mode.
     * @returns True if successful, false if invalid mode.
     */
    setOverrideMode(userId: string, mode: string): boolean {
        if (!['global', 'weekly', 'perDay'].includes(mode)) {
            console.warn(`Invalid override mode: ${mode}`);
            return false;
        }
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: mode as 'global' | 'weekly' | 'perDay' };
        } else {
            this.overrides[userId].mode = mode as 'global' | 'weekly' | 'perDay';
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
     * @param userId - User ID.
     * @param dateKey - Date in YYYY-MM-DD format.
     * @param field - Field to update (capacity/multiplier).
     * @param value - New value.
     * @returns True if update was successful, false if validation failed.
     */
    updatePerDayOverride(
        userId: string,
        dateKey: string,
        field: string,
        value: string | number | null
    ): boolean {
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: 'perDay', perDayOverrides: {} };
        }

        if (!this.overrides[userId].perDayOverrides) {
            this.overrides[userId].perDayOverrides = {};
        }

        const perDayOverrides = this.overrides[userId].perDayOverrides;

        if (!perDayOverrides[dateKey]) {
            perDayOverrides[dateKey] = {};
        }

        // Same validation logic as updateOverride()
        if (value === null || value === '') {
            delete (perDayOverrides[dateKey] as Record<string, unknown>)[field];

            // Cleanup empty day entries
            if (Object.keys(perDayOverrides[dateKey]).length === 0) {
                delete perDayOverrides[dateKey];
            }
        } else {
            // Validate per-day numeric inputs just like global overrides
            const numValue = parseFloat(String(value));
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

            (perDayOverrides[dateKey] as Record<string, unknown>)[field] = value;
        }

        this.saveOverrides();
        return true;
    }

    /**
     * Copies global override values to all days in the provided date range for per-day mode.
     * @param userId - User ID.
     * @param dates - Array of date keys (YYYY-MM-DD format).
     * @returns True if successful, false if preconditions not met.
     */
    copyGlobalToPerDay(userId: string, dates: string[]): boolean {
        const override = this.overrides[userId];
        if (!override || override.mode !== 'perDay') {
            console.warn(`Cannot copy: user ${userId} not in perDay mode`);
            return false;
        }

        if (!dates || dates.length === 0) {
            console.warn('Cannot copy: no dates provided');
            return false;
        }

        // Copy the user's global override values into each day for easier per-day editing
        const globalCapacity = override.capacity;
        const globalMultiplier = override.multiplier;
        const globalTier2Threshold = override.tier2Threshold;
        const globalTier2Multiplier = override.tier2Multiplier;

        if (!override.perDayOverrides) {
            override.perDayOverrides = {};
        }
        const perDayOverrides = override.perDayOverrides;

        // Copy the global override values to each date bucket so the per-day editor can show them
        dates.forEach((dateKey) => {
            if (!perDayOverrides[dateKey]) {
                perDayOverrides[dateKey] = {};
            }

            if (globalCapacity !== undefined && globalCapacity !== '') {
                perDayOverrides[dateKey].capacity = globalCapacity;
            }
            if (globalMultiplier !== undefined && globalMultiplier !== '') {
                perDayOverrides[dateKey].multiplier = globalMultiplier;
            }
            if (globalTier2Threshold !== undefined && globalTier2Threshold !== '') {
                perDayOverrides[dateKey].tier2Threshold = globalTier2Threshold;
            }
            if (globalTier2Multiplier !== undefined && globalTier2Multiplier !== '') {
                perDayOverrides[dateKey].tier2Multiplier = globalTier2Multiplier;
            }
        });

        this.saveOverrides();
        return true;
    }

    /**
     * Sets weekly override for specific weekday.
     * @param userId - User ID.
     * @param weekday - 'MONDAY', 'TUESDAY', etc.
     * @param field - 'capacity' or 'multiplier'.
     * @param value - The value to set.
     * @returns True if successful, false if invalid.
     */
    setWeeklyOverride(
        userId: string,
        weekday: string,
        field: string,
        value: string | number | null
    ): boolean {
        // Initialize structure
        if (!this.overrides[userId]) {
            this.overrides[userId] = { mode: 'weekly', weeklyOverrides: {} };
        }
        if (!this.overrides[userId].weeklyOverrides) {
            this.overrides[userId].weeklyOverrides = {};
        }
        const weeklyOverrides = this.overrides[userId].weeklyOverrides;
        if (!weeklyOverrides[weekday]) {
            weeklyOverrides[weekday] = {};
        }

        // Validation (same as updateOverride)
        if (value === null || value === '') {
            delete (weeklyOverrides[weekday] as Record<string, unknown>)[field];
            if (Object.keys(weeklyOverrides[weekday]).length === 0) {
                delete weeklyOverrides[weekday];
            }
        } else {
            const numValue = parseFloat(String(value));
            if (isNaN(numValue)) return false;
            if (field === 'capacity' && numValue < 0) return false;
            if (field === 'multiplier' && numValue < 1) return false;
            if (field === 'tier2Threshold' && numValue < 0) return false;
            if (field === 'tier2Multiplier' && numValue < 1) return false;
            (weeklyOverrides[weekday] as Record<string, unknown>)[field] = value;
        }

        this.saveOverrides();
        return true;
    }

    /**
     * Copies global values to all weekdays for a user in weekly mode.
     * @param userId - User ID.
     * @returns True if successful, false if not in weekly mode.
     */
    copyGlobalToWeekly(userId: string): boolean {
        const override = this.overrides[userId];
        if (!override || override.mode !== 'weekly') return false;

        const weekdays = [
            'MONDAY',
            'TUESDAY',
            'WEDNESDAY',
            'THURSDAY',
            'FRIDAY',
            'SATURDAY',
            'SUNDAY',
        ];

        if (!override.weeklyOverrides) {
            override.weeklyOverrides = {};
        }
        const weeklyOverrides = override.weeklyOverrides;

        weekdays.forEach((weekday) => {
            if (!weeklyOverrides[weekday]) {
                weeklyOverrides[weekday] = {};
            }
            // Mirror global override values across every weekday entry for convenience
            if (override.capacity !== undefined && override.capacity !== '') {
                weeklyOverrides[weekday].capacity = override.capacity;
            }
            if (override.multiplier !== undefined && override.multiplier !== '') {
                weeklyOverrides[weekday].multiplier = override.multiplier;
            }
            if (override.tier2Threshold !== undefined && override.tier2Threshold !== '') {
                weeklyOverrides[weekday].tier2Threshold = override.tier2Threshold;
            }
            if (override.tier2Multiplier !== undefined && override.tier2Multiplier !== '') {
                weeklyOverrides[weekday].tier2Multiplier = override.tier2Multiplier;
            }
        });

        this.saveOverrides();
        return true;
    }

    /**
     * Retrieves overrides for a specific user.
     * @param userId - User ID.
     * @returns Override object (empty if none).
     */
    getUserOverride(userId: string): UserOverride {
        return this.overrides[userId] || {};
    }

    /**
     * Resets API failure counters.
     */
    resetApiStatus(): void {
        this.apiStatus = { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 };
    }

    /**
     * Resets throttle status counters.
     */
    resetThrottleStatus(): void {
        this.throttleStatus = { retryCount: 0, lastRetryTime: null };
    }

    /**
     * Increments throttle retry count.
     */
    incrementThrottleRetry(): void {
        this.throttleStatus.retryCount++;
        this.throttleStatus.lastRetryTime = Date.now();
    }

    /**
     * Clears cached data maps (holidays, timeOff) before fetching new data.
     * Profiles are kept as they rarely change within a session.
     */
    clearFetchCache(): void {
        this.holidays.clear();
        this.timeOff.clear();
    }

    /**
     * Loads UI state from LocalStorage.
     * @private
     */
    private _loadUIState(): void {
        const saved = localStorage.getItem(STORAGE_KEYS.UI_STATE);
        if (saved) {
            const parsed = safeJSONParse<Partial<UIState> | null>(saved, null);
            if (parsed && typeof parsed === 'object') {
                this.ui = { ...this.ui, ...parsed };
            }
        }
    }

    /**
     * Saves UI state to LocalStorage.
     */
    saveUIState(): void {
        localStorage.setItem(
            STORAGE_KEYS.UI_STATE,
            JSON.stringify({
                summaryExpanded: this.ui.summaryExpanded,
                summaryGroupBy: this.ui.summaryGroupBy,
                overridesCollapsed: this.ui.overridesCollapsed,
            })
        );
    }

    /**
     * Generates a cache key for report data.
     * @param start - Start date (YYYY-MM-DD).
     * @param end - End date (YYYY-MM-DD).
     * @returns Cache key string or null if no workspace.
     */
    getReportCacheKey(start: string, end: string): string | null {
        if (!this.claims?.workspaceId) return null;
        return `${this.claims.workspaceId}-${start}-${end}`;
    }

    /**
     * Gets cached report data if it exists and is not expired.
     * @param key - Cache key.
     * @returns Cached entries or null if not found or expired.
     */
    getCachedReport(key: string): TimeEntry[] | null {
        try {
            const cached = sessionStorage.getItem(STORAGE_KEYS.REPORT_CACHE);
            if (!cached) return null;

            const cache = safeJSONParse<ReportCache | null>(cached, null);
            if (!cache) return null;

            // Check if cache matches the key and is not expired
            if (cache.key !== key) return null;
            if (Date.now() - cache.timestamp > REPORT_CACHE_TTL) return null;

            return cache.entries;
        } catch {
            return null;
        }
    }

    /**
     * Saves report data to cache.
     * @param key - Cache key.
     * @param entries - Time entries to cache.
     */
    setCachedReport(key: string, entries: TimeEntry[]): void {
        try {
            const cache: ReportCache = {
                key,
                timestamp: Date.now(),
                entries,
            };
            sessionStorage.setItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(cache));
        } catch (e) {
            // Silently fail if sessionStorage quota exceeded
            console.warn('Failed to cache report data:', e);
        }
    }

    /**
     * Clears the report cache.
     */
    clearReportCache(): void {
        try {
            sessionStorage.removeItem(STORAGE_KEYS.REPORT_CACHE);
        } catch {
            // Silently ignore
        }
    }

    /**
     * Clears all persisted data from localStorage.
     * Useful for privacy/security features.
     */
    clearAllData(): void {
        // Clear config
        localStorage.removeItem('otplus_config');

        // Clear UI state
        localStorage.removeItem(STORAGE_KEYS.UI_STATE);

        // Clear overrides for this workspace
        const overrideKey = this._getOverrideKey();
        if (overrideKey) {
            localStorage.removeItem(overrideKey);
        }

        // Clear all workspace-prefixed keys
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(STORAGE_KEYS.OVERRIDES_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));

        // Reset in-memory state
        this.overrides = {};
        this.profiles.clear();
        this.holidays.clear();
        this.timeOff.clear();
        this.rawEntries = null;
        this.analysisResults = null;
        this.currentDateRange = null;

        // Reset config to defaults
        this.config = {
            useProfileCapacity: true,
            useProfileWorkingDays: true,
            applyHolidays: true,
            applyTimeOff: true,
            showBillableBreakdown: true,
            showDecimalTime: false,
            amountDisplay: 'earned',
            overtimeBasis: 'daily',
            maxPages: DEFAULT_MAX_PAGES,
        };

        this.calcParams = {
            dailyThreshold: 8,
            weeklyThreshold: 40,
            overtimeMultiplier: 1.5,
            tier2ThresholdHours: 0,
            tier2Multiplier: 2.0,
        };

        this.ui = {
            isLoading: false,
            summaryExpanded: false,
            summaryGroupBy: 'user',
            overridesCollapsed: true,
            activeTab: 'summary',
            detailedPage: 1,
            detailedPageSize: 50,
            activeDetailedFilter: 'all',
            hasCostRates: true,
        };
    }
}

export const store = new Store();
export type { Store };
