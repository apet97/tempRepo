/**
 * @fileoverview Main Entry Point / Controller
 * Orchestrates the application lifecycle, including initialization, event binding,
 * data fetching orchestration, and triggering calculations/renders.
 *
 * ## Data Flow Diagram
 *
 * ```
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                           INITIALIZATION                               │
 * │  URL params ──► JWT decode ──► store.setToken() ──► loadInitialData() │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                         DATA FETCHING (Parallel)                       │
 * │                                                                        │
 * │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
 * │  │ fetchEntries │  │fetchProfiles │  │fetchHolidays │  │fetchTimeOff│ │
 * │  │ (Reports API)│  │  (per user)  │  │  (per user)  │  │ (per user) │ │
 * │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
 * │         │                 │                 │                │        │
 * │         ▼                 ▼                 ▼                ▼        │
 * │  store.rawEntries    store.profiles    store.holidays   store.timeOff │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                          CALCULATION                                   │
 * │                                                                        │
 * │  workerManager.calculateAsync() OR calculateAnalysis() (fallback)     │
 * │                                                                        │
 * │  Input: entries, store (profiles, holidays, timeOff, config, params)  │
 * │  Output: UserAnalysis[] with daily OT breakdowns                       │
 * │                                                                        │
 * │  ┌─────────────────────────────────────────────────────────────────┐  │
 * │  │ For each user:                                                   │  │
 * │  │   1. Group entries by dateKey                                    │  │
 * │  │   2. Determine effective capacity (overrides > profile > global) │  │
 * │  │   3. Apply holiday/time-off/non-working day adjustments          │  │
 * │  │   4. Tail attribution: sort by start, assign OT to tail          │  │
 * │  │   5. Split billable/non-billable, apply tiered multipliers       │  │
 * │  └─────────────────────────────────────────────────────────────────┘  │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                           RENDERING                                    │
 * │                                                                        │
 * │  store.analysisResults ──► UI.renderSummaryStrip()                    │
 * │                        ──► UI.renderSummaryTable()                     │
 * │                        ──► UI.renderDetailedTable() (paginated)        │
 * │                        ──► UI.renderOverridesTable()                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │                            EXPORT                                      │
 * │                                                                        │
 * │  User clicks Export ──► downloadCsv(analysisResults)                  │
 * │                         - Formula injection protection                 │
 * │                         - Decimal hours column                         │
 * └────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Key Functions
 * - `init()` - Entry point, parses JWT and starts data load
 * - `loadInitialData()` - Fetches users, triggers report generation
 * - `generateReport()` - Main orchestrator: fetch → calc → render
 * - `runCalculation()` - Delegates to worker or main thread
 */

import { store } from './state.js';
import { Api } from './api.js';
import { calculateAnalysis } from './calc.js';
import { downloadCsv } from './export.js';
import * as UI from './ui/index.js';
import { IsoUtils, debounce, parseIsoDuration } from './utils.js';
import { initErrorReporting, reportError } from './error-reporting.js';
import { SENTRY_DSN } from './constants.js';
import type { DateRange, TimeEntry, TokenClaims } from './types.js';

// --- Initialization ---

/**
 * Sets default date range (last 30 days) in the UI inputs on startup.
 */
export function setDefaultDates(): void {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);

    const startEl = document.getElementById('startDate') as HTMLInputElement | null;
    const endEl = document.getElementById('endDate') as HTMLInputElement | null;

    if (startEl) startEl.value = IsoUtils.toISODate(start);
    if (endEl) endEl.value = IsoUtils.toISODate(end);
}

/**
 * Main application initialization.
 * Parses auth token from URL, sets up state, and starts initial data load.
 */
export function init(): void {
    // Initialize error reporting (Sentry) early
    initErrorReporting({
        dsn: SENTRY_DSN,
        environment: typeof process !== 'undefined' && process.env.NODE_ENV === 'production' ? 'production' : 'development',
        release: `otplus@2.0.0`,
        sampleRate: 1.0,
    }).catch(() => {
        // Silent fail - error reporting is optional
    });

    const params = new URLSearchParams(window.location.search);
    const token = params.get('auth_token');

    if (!token) {
        console.error('No auth token');
        reportError(new Error('No auth token provided'), {
            module: 'main',
            operation: 'init',
            level: 'warning',
        });
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent =
                'Error: No authentication token provided. Please access this addon through Clockify.';
            emptyState.classList.remove('hidden');
        }
        return;
    }

    try {
        const payload = JSON.parse(atob(token.split('.')[1])) as TokenClaims;
        if (!payload || !payload.workspaceId) {
            throw new Error('Invalid token payload');
        }

        // Apply Theme based on JWT claim
        if (payload.theme === 'DARK') {
            document.body.classList.add('cl-theme-dark');
        }

        store.setToken(token, payload);
        setDefaultDates();
        loadInitialData();
    } catch (e) {
        console.error('Invalid token', e);
        reportError(e instanceof Error ? e : new Error('Invalid token'), {
            module: 'main',
            operation: 'init',
            level: 'error',
        });
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent =
                'Error: Invalid authentication token. Please try accessing the addon again.';
            emptyState.classList.remove('hidden');
        }
    }
}

/**
 * Loads initial metadata (users) and prepares the UI.
 */
export async function loadInitialData(): Promise<void> {
    // Initialize UI elements first (after DOM is ready)
    UI.initializeElements();

    UI.renderLoading(true);
    try {
        if (!store.claims?.workspaceId) {
            throw new Error('No workspace ID');
        }
        store.users = await Api.fetchUsers(store.claims.workspaceId);

        // Validate that we have at least one user
        if (!store.users || store.users.length === 0) {
            UI.renderLoading(false);
            UI.showError({
                title: 'No Users Found',
                message:
                    'No workspace members were found. Please check your permissions or try again.',
                action: 'reload',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
            });
            return;
        }

        // Populate overrides controls only after we have an up-to-date user list
        UI.renderOverridesTable();
    } catch {
        UI.renderLoading(false);
        UI.showError({
            title: 'Failed to Load Users',
            message:
                'Could not fetch workspace members. Please check your connection and try again.',
            action: 'reload',
            type: 'API_ERROR',
            timestamp: new Date().toISOString(),
        });
        return;
    }
    UI.renderLoading(false);

    bindConfigEvents();
    UI.bindEvents({
        onGenerate: handleGenerateReport,
        onOverrideChange: (userId: string, field: string, value: string) => {
            store.updateOverride(userId, field, value);
            if (store.rawEntries) runCalculation();
        },
        onOverrideModeChange: (userId: string, mode: string) => {
            store.setOverrideMode(userId, mode);
            UI.renderOverridesTable(); // Re-render to show/hide per-day editor
            if (store.rawEntries) runCalculation();
        },
        onPerDayOverrideChange: (
            userId: string,
            dateKey: string,
            field: string,
            value: string
        ) => {
            store.updatePerDayOverride(userId, dateKey, field, value);
            if (store.rawEntries) runCalculation();
        },
        onCopyFromGlobal: (userId: string) => {
            const startInput = document.getElementById('startDate') as HTMLInputElement | null;
            const endInput = document.getElementById('endDate') as HTMLInputElement | null;
            if (startInput?.value && endInput?.value) {
                const dates = IsoUtils.generateDateRange(startInput.value, endInput.value);
                store.copyGlobalToPerDay(userId, dates);
                UI.renderOverridesTable(); // Re-render to show copied values
                if (store.rawEntries) runCalculation();
            }
        },
        onWeeklyOverrideChange: (
            userId: string,
            weekday: string,
            field: string,
            value: string
        ) => {
            store.setWeeklyOverride(userId, weekday, field, value);
            if (store.rawEntries) runCalculation();
        },
        onCopyGlobalToWeekly: (userId: string) => {
            store.copyGlobalToWeekly(userId);
            UI.renderOverridesTable(); // Re-render to show copied values
            if (store.rawEntries) runCalculation();
        },
    });
}

// --- Configuration Wiring ---

/**
 * Updates the Daily Threshold input state based on Profile Capacity setting.
 * Disables the input and shows helper text when Profile Capacity is ON.
 */
function updateDailyThresholdState(): void {
    const dailyInput = document.getElementById('configDaily') as HTMLInputElement | null;
    const helper = document.getElementById('dailyThresholdHelper') as HTMLElement | null;
    if (!dailyInput || !helper) return;

    const useProfile = store.config.useProfileCapacity;
    dailyInput.disabled = useProfile;
    helper.style.display = useProfile ? 'inline' : 'none';

    // Visual feedback
    if (useProfile) {
        dailyInput.style.opacity = '0.5';
        dailyInput.style.cursor = 'not-allowed';
    } else {
        dailyInput.style.opacity = '1';
        dailyInput.style.cursor = '';
    }
}

function hasCostRates(entries: TimeEntry[] | null): boolean {
    // Determine whether any entry provides explicit cost/profit information
    if (!Array.isArray(entries) || entries.length === 0) return true;
    return entries.some((entry) => {
        const rawCostRate = (entry?.costRate as { amount?: number })?.amount ?? entry?.costRate;
        const costRate = Number(rawCostRate);
        // Only treat as available when a non-zero cost rate exists
        if (Number.isFinite(costRate) && costRate !== 0) return true;
        const amounts = Array.isArray(entry?.amounts) ? entry.amounts : [];
        return amounts.some((amount) => {
            const type = String(amount?.type || amount?.amountType || '').toUpperCase();
            if (type !== 'COST' && type !== 'PROFIT') return false;
            const value = Number(amount?.value ?? amount?.amount);
            return Number.isFinite(value) && value !== 0;
        });
    });
}

function syncAmountDisplayAvailability(entries: TimeEntry[] | null): void {
    // Toggle extra amount display modes only when cost/profit data is present
    const costRatesAvailable = hasCostRates(entries);
    store.ui.hasCostRates = costRatesAvailable;

    const amountDisplayEl = document.getElementById('amountDisplay') as HTMLSelectElement | null;
    if (!amountDisplayEl) return;

    // Hide cost/profit options when data doesn't provide cost references
    const costOption = amountDisplayEl.querySelector(
        'option[value="cost"]'
    ) as HTMLOptionElement | null;
    const profitOption = amountDisplayEl.querySelector(
        'option[value="profit"]'
    ) as HTMLOptionElement | null;
    if (costOption) {
        costOption.hidden = !costRatesAvailable;
        costOption.disabled = !costRatesAvailable;
    }
    if (profitOption) {
        profitOption.hidden = !costRatesAvailable;
        profitOption.disabled = !costRatesAvailable;
    }

    const validDisplays = new Set(['earned', 'cost', 'profit']);
    let nextDisplay = String(store.config.amountDisplay || '').toLowerCase();
    if (!validDisplays.has(nextDisplay)) nextDisplay = 'earned';
    if (!costRatesAvailable && (nextDisplay === 'cost' || nextDisplay === 'profit')) {
        nextDisplay = 'earned';
    }

    if (store.config.amountDisplay !== nextDisplay) {
        store.config.amountDisplay = nextDisplay as 'earned' | 'cost' | 'profit';
        store.saveConfig();
    }

    amountDisplayEl.value = nextDisplay;
}

/**
 * Binds event listeners to configuration controls (toggles, inputs).
 * Handles persistence to localStorage and auto-recalculation.
 */
export function bindConfigEvents(): void {
    // Toggle mapping describing which DOM checkbox updates which config flag
    const configToggles = [
        { id: 'useProfileCapacity', key: 'useProfileCapacity' },
        { id: 'useProfileWorkingDays', key: 'useProfileWorkingDays' },
        { id: 'applyHolidays', key: 'applyHolidays' },
        { id: 'applyTimeOff', key: 'applyTimeOff' },
        { id: 'showBillableBreakdown', key: 'showBillableBreakdown' },
        { id: 'showDecimalTime', key: 'showDecimalTime' },
    ] as const;

    // Wire up boolean toggles -> persisted config -> recalculation
    configToggles.forEach(({ id, key }) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) {
            el.checked = store.config[key];
            el.addEventListener('change', (e) => {
                store.config[key] = (e.target as HTMLInputElement).checked;
                store.saveConfig();

                // Update expand toggle visibility when billable breakdown changes
                if (key === 'showBillableBreakdown') {
                    UI.renderSummaryExpandToggle();
                }

                // Update Daily Threshold state when Profile Capacity changes
                if (key === 'useProfileCapacity') {
                    updateDailyThresholdState();
                }

                if (store.rawEntries) {
                    if (key === 'showDecimalTime') {
                        if (store.analysisResults) {
                            UI.renderSummaryStrip(store.analysisResults);
                            UI.renderSummaryTable(store.analysisResults);
                            UI.renderDetailedTable(store.analysisResults);
                        }
                    } else {
                        runCalculation();
                    }
                }
            });
        }
    });

    const amountDisplayEl = document.getElementById('amountDisplay') as HTMLSelectElement | null;
    if (amountDisplayEl) {
        const validDisplays = new Set(['earned', 'cost', 'profit']);
        const currentDisplay = String(store.config.amountDisplay || '').toLowerCase();
        amountDisplayEl.value = validDisplays.has(currentDisplay) ? currentDisplay : 'earned';
        amountDisplayEl.addEventListener('change', (e) => {
            const nextValue = String((e.target as HTMLSelectElement).value || '').toLowerCase();
            const allowCost = store.ui.hasCostRates !== false;
            let normalized: 'earned' | 'cost' | 'profit' = validDisplays.has(nextValue)
                ? (nextValue as 'earned' | 'cost' | 'profit')
                : 'earned';
            if (!allowCost && (normalized === 'cost' || normalized === 'profit')) {
                normalized = 'earned';
            }
            store.config.amountDisplay = normalized;
            store.saveConfig();
            amountDisplayEl.value = store.config.amountDisplay;
            if (store.rawEntries) runCalculation();
        });
    }

    const dailyEl = document.getElementById('configDaily') as HTMLInputElement | null;
    if (dailyEl) {
        dailyEl.value = String(store.calcParams.dailyThreshold);
        dailyEl.addEventListener(
            'input',
            debounce((e: Event) => {
                store.calcParams.dailyThreshold =
                    parseFloat((e.target as HTMLInputElement).value) || 8;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    const multEl = document.getElementById('configMultiplier') as HTMLInputElement | null;
    if (multEl) {
        multEl.value = String(store.calcParams.overtimeMultiplier);
        multEl.addEventListener(
            'input',
            debounce((e: Event) => {
                store.calcParams.overtimeMultiplier =
                    parseFloat((e.target as HTMLInputElement).value) || 1.5;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    const tier2ThresholdEl = document.getElementById(
        'configTier2Threshold'
    ) as HTMLInputElement | null;
    if (tier2ThresholdEl) {
        tier2ThresholdEl.value = String(store.calcParams.tier2ThresholdHours || 0);
        tier2ThresholdEl.addEventListener(
            'input',
            debounce((e: Event) => {
                store.calcParams.tier2ThresholdHours =
                    parseFloat((e.target as HTMLInputElement).value) || 0;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    const tier2MultiplierEl = document.getElementById(
        'configTier2Multiplier'
    ) as HTMLInputElement | null;
    if (tier2MultiplierEl) {
        tier2MultiplierEl.value = String(store.calcParams.tier2Multiplier || 2.0);
        tier2MultiplierEl.addEventListener(
            'input',
            debounce((e: Event) => {
                store.calcParams.tier2Multiplier =
                    parseFloat((e.target as HTMLInputElement).value) || 2.0;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            }, 300)
        );
    }

    // Initialize Daily Threshold state based on Profile Capacity
    updateDailyThresholdState();

    // Config toggle collapse
    const configToggle = document.getElementById('configToggle');
    const configContent = document.getElementById('configContent');
    if (configToggle && configContent) {
        configToggle.addEventListener('click', () => {
            configToggle.classList.toggle('collapsed');
            configContent.classList.toggle('hidden');
        });
    }

    // Tab navigation with ARIA support using event delegation
    const tabNavCard = document.getElementById('tabNavCard') as HTMLElement | null;
    if (tabNavCard && !tabNavCard.dataset.listenerAttached) {
        tabNavCard.dataset.listenerAttached = 'true';
        tabNavCard.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.tab-btn') as HTMLElement | null;
            if (!btn) return;

            document.querySelectorAll('.tab-btn').forEach((b) => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            const tab = btn.dataset.tab;
            const summaryCard = document.getElementById('summaryCard');
            const detailedCard = document.getElementById('detailedCard');
            if (summaryCard) summaryCard.classList.toggle('hidden', tab !== 'summary');
            if (detailedCard) detailedCard.classList.toggle('hidden', tab !== 'detailed');
        });
    }

    // Export Button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (store.analysisResults) {
                downloadCsv(store.analysisResults);
            }
        });
    }

    // Date Presets
    const setDateRange = (start: Date, end: Date) => {
        const startEl = document.getElementById('startDate') as HTMLInputElement | null;
        const endEl = document.getElementById('endDate') as HTMLInputElement | null;
        if (startEl) startEl.value = IsoUtils.toISODate(start);
        if (endEl) endEl.value = IsoUtils.toISODate(end);
    };

    const startInput = document.getElementById('startDate') as HTMLInputElement | null;
    const endInput = document.getElementById('endDate') as HTMLInputElement | null;

    // Auto-generate when dates change
    const queueAutoGenerate = debounce(() => {
        const startValue = startInput?.value;
        const endValue = endInput?.value;
        if (!startValue || !endValue) return;
        if (startValue > endValue) return;
        handleGenerateReport();
    }, 300);

    if (startInput) {
        startInput.addEventListener('change', queueAutoGenerate);
    }
    if (endInput) {
        endInput.addEventListener('change', queueAutoGenerate);
    }

    document.getElementById('datePresetThisWeek')?.addEventListener('click', () => {
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const start = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset)
        );
        const end = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        );
        setDateRange(start, end);
        queueAutoGenerate();
    });

    document.getElementById('datePresetLastWeek')?.addEventListener('click', () => {
        const now = new Date();
        const dayOfWeek = now.getUTCDay();
        const lastMondayOffset = dayOfWeek === 0 ? -13 : -6 - dayOfWeek;
        const lastSundayOffset = dayOfWeek === 0 ? -7 : -dayOfWeek;
        const start = new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate() + lastMondayOffset
            )
        );
        const end = new Date(
            Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate() + lastSundayOffset
            )
        );
        setDateRange(start, end);
        queueAutoGenerate();
    });

    document.getElementById('datePresetLast2Weeks')?.addEventListener('click', () => {
        const now = new Date();
        const start = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13)
        );
        const end = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        );
        setDateRange(start, end);
        queueAutoGenerate();
    });

    document.getElementById('datePresetLastMonth')?.addEventListener('click', () => {
        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
        setDateRange(start, end);
        queueAutoGenerate();
    });

    document.getElementById('datePresetThisMonth')?.addEventListener('click', () => {
        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
        setDateRange(start, end);
        queueAutoGenerate();
    });

    // Detailed Filter Chips
    const filterContainer = document.getElementById('detailedFilters');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('chip')) {
                const filter = target.dataset.filter;
                if (filter && store.analysisResults) {
                    UI.renderDetailedTable(store.analysisResults, filter);
                }
            }
        });
    }

    // Summary Group By Selector
    const groupBySelect = document.getElementById('groupBySelect') as HTMLSelectElement | null;
    if (groupBySelect) {
        groupBySelect.value = store.ui.summaryGroupBy || 'user';

        groupBySelect.addEventListener('change', (e) => {
            store.ui.summaryGroupBy = (e.target as HTMLSelectElement).value as typeof store.ui.summaryGroupBy;
            store.saveUIState();
            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        });
    }

    // Summary Expand/Collapse Toggle - use event delegation
    const summaryExpandToggleContainer = document.getElementById('summaryExpandToggleContainer');
    if (summaryExpandToggleContainer) {
        UI.renderSummaryExpandToggle();

        summaryExpandToggleContainer.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('#summaryExpandToggle');
            if (!btn) return;

            store.ui.summaryExpanded = !store.ui.summaryExpanded;
            store.saveUIState();

            UI.renderSummaryExpandToggle();

            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        });
    }

    // Clear All Data button
    const clearDataBtn = document.getElementById('clearAllDataBtn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', () => {
            UI.showClearDataConfirmation(() => {
                store.clearAllData();
                location.reload();
            });
        });
    }
}

// --- Report Logic ---

/** Reference to the AbortController for the active report generation request. */
let abortController: AbortController | null = null;
/** Request ID to detect stale responses from concurrent requests */
let currentRequestId = 0;

/**
 * Orchestrates the full report generation process.
 */
export async function handleGenerateReport(): Promise<void> {
    // Cancel previous request if running
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();
    const { signal } = abortController;

    // Increment request ID to detect stale responses
    currentRequestId++;
    const thisRequestId = currentRequestId;

    UI.renderLoading(true);
    store.resetApiStatus();
    store.clearFetchCache();

    const startDateEl = document.getElementById('startDate') as HTMLInputElement | null;
    const endDateEl = document.getElementById('endDate') as HTMLInputElement | null;
    const startDate = startDateEl?.value || '';
    const endDate = endDateEl?.value || '';

    // Ensure both dates are selected before issuing API calls
    if (!startDate || !endDate) {
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent = 'Please select start and end dates to generate the report.';
            emptyState.classList.remove('hidden');
        }
        setTimeout(() => {
            if (emptyState) emptyState.classList.add('hidden');
        }, 3000);
        return;
    }

    // Validate date range
    if (startDate > endDate) {
        UI.renderLoading(false);
        UI.showError({
            title: 'Invalid Date Range',
            message: 'Start date must be before or equal to end date.',
            action: 'none',
            type: 'VALIDATION_ERROR',
            timestamp: new Date().toISOString(),
        });
        return;
    }

    // Use request-scoped date range
    const requestDateRange: DateRange = { start: startDate, end: endDate };

    try {
        if (!store.claims?.workspaceId) {
            throw new Error('No workspace ID');
        }

        // Fetch via Detailed Report API (single request for ALL users).
        const entries = await Api.fetchDetailedReport(
            store.claims.workspaceId,
            `${startDate}T00:00:00Z`,
            `${endDate}T23:59:59Z`,
            { signal }
        );
        store.rawEntries = entries;

        // Prepare optional fetch promises (these can fail gracefully)
        const optionalPromises: { name: string; promise: Promise<void> }[] = [];

        // 2. Fetch Profiles (Capacity/Working Days) - OPTIONAL
        if (store.config.useProfileCapacity || store.config.useProfileWorkingDays) {
            const missingUsers = store.users.filter((u) => !store.profiles.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'profiles',
                    promise: Api.fetchAllProfiles(store.claims.workspaceId, missingUsers, {
                        signal,
                    }).then((profiles) => {
                        profiles.forEach((profile, userId) => {
                            store.profiles.set(userId, {
                                workCapacityHours: parseIsoDuration(profile.workCapacity || ''),
                                workingDays: profile.workingDays,
                            });
                        });
                    }),
                });
            }
        }

        // 3. Fetch Holidays - OPTIONAL
        if (store.config.applyHolidays) {
            optionalPromises.push({
                name: 'holidays',
                promise: Api.fetchAllHolidays(
                    store.claims.workspaceId,
                    store.users,
                    startDate,
                    endDate,
                    { signal }
                ).then((holidays) => {
                    holidays.forEach((hList, userId) => {
                        const hMap = new Map();
                        (hList || []).forEach((h) => {
                            const startKey = IsoUtils.extractDateKey(h.datePeriod?.startDate);
                            const endKey = IsoUtils.extractDateKey(h.datePeriod?.endDate);

                            if (startKey) {
                                if (!endKey || endKey === startKey) {
                                    hMap.set(startKey, h);
                                } else {
                                    // Expand multi-day holidays
                                    const range = IsoUtils.generateDateRange(startKey, endKey);
                                    range.forEach((date) => hMap.set(date, h));
                                }
                            }
                        });
                        store.holidays.set(userId, hMap);
                    });
                }),
            });
        }

        // 4. Fetch Time Off - OPTIONAL
        if (store.config.applyTimeOff) {
            optionalPromises.push({
                name: 'timeOff',
                promise: Api.fetchAllTimeOff(
                    store.claims.workspaceId,
                    store.users,
                    startDate,
                    endDate,
                    { signal }
                ).then((timeOff) => {
                    store.timeOff = timeOff;
                }),
            });
        }

        // Wait for optional fetches with graceful failure handling
        if (optionalPromises.length > 0) {
            const results = await Promise.allSettled(optionalPromises.map((p) => p.promise));
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    // Only report failure if the error is NOT an AbortError
                    const reason = result.reason as Error;
                    if (reason?.name !== 'AbortError') {
                        const name = optionalPromises[index].name;
                        console.warn(`Optional fetch '${name}' failed:`, reason);
                        // Track failures for UI status display
                        if (name === 'profiles') {
                            store.apiStatus.profilesFailed = store.users.length;
                        }
                        if (name === 'holidays') {
                            store.apiStatus.holidaysFailed = store.users.length;
                        }
                        if (name === 'timeOff') {
                            store.apiStatus.timeOffFailed = store.users.length;
                        }
                    }
                }
            });
        }

        // Check if this request is still current before updating UI
        if (thisRequestId !== currentRequestId) {
            return;
        }

        runCalculation(requestDateRange);
        const tabNavCard = document.getElementById('tabNavCard');
        if (tabNavCard) tabNavCard.style.display = 'block';

        // Enable Export button
        const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement | null;
        if (exportBtn) exportBtn.disabled = false;

        UI.renderApiStatus();
    } catch (error) {
        const err = error as Error;
        if (err.name === 'AbortError') {
            // Clean up state on abort
            store.rawEntries = null;
            return;
        }
        console.error('Report generation failed:', error);
        reportError(err, {
            module: 'main',
            operation: 'handleGenerateReport',
            level: 'error',
            metadata: {
                dateRange: { start: startDate, end: endDate },
            },
        });
        UI.showError({
            title: 'Report Generation Failed',
            message: 'An error occurred while fetching time entries. Please try again.',
            action: 'retry',
            type: 'API_ERROR',
            timestamp: new Date().toISOString(),
        });
    } finally {
        UI.renderLoading(false);
        abortController = null;
    }
}

/**
 * Triggers the calculation engine and updates all UI views with results.
 * @param dateRange - Optional date range. If not provided, uses stored analysis date range.
 */
export function runCalculation(dateRange?: DateRange): void {
    // Use provided dateRange or fall back to stored date range for recalculations
    const effectiveDateRange = dateRange || store.currentDateRange || { start: '', end: '' };

    // Store the date range for subsequent recalculations (e.g., config changes)
    if (dateRange) {
        store.currentDateRange = dateRange;
    }

    // Ensure the amount display select reflects the latest data (earned/cost/profit availability)
    syncAmountDisplayAvailability(store.rawEntries);
    const analysis = calculateAnalysis(store.rawEntries, store, effectiveDateRange);
    store.analysisResults = analysis;
    UI.renderSummaryStrip(analysis);
    UI.renderSummaryTable(analysis);
    UI.renderDetailedTable(analysis);
}

// Start (auto-init only in non-test environments)
if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
    init();
}
