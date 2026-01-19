/**
 * @fileoverview Main Entry Point
 * Orchestrates the application lifecycle, including initialization, event binding,
 * data fetching orchestration, and triggering calculations/renders.
 */

import { store } from './state.js';
import { Api } from './api.js?v=16';
import { calculateAnalysis } from './calc.js?v=16';
import { downloadCsv } from './export.js';
import * as UI from './ui.js';
import { IsoUtils, debounce, parseIsoDuration } from './utils.js';

// --- Initialization ---

/**
 * Sets default date range (last 30 days) in the UI inputs on startup.
 */
export function setDefaultDates() {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);

    document.getElementById('startDate').value = IsoUtils.toISODate(start);
    document.getElementById('endDate').value = IsoUtils.toISODate(end);
}

/**
 * Main application initialization.
 * Parses auth token from URL, sets up state, and starts initial data load.
 */
export function init() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('auth_token');

    if (!token) {
        console.error('No auth token');
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent = 'Error: No authentication token provided. Please access this addon through Clockify.';
            emptyState.classList.remove('hidden');
        }
        return;
    }

    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
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
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent = 'Error: Invalid authentication token. Please try accessing the addon again.';
            emptyState.classList.remove('hidden');
        }
    }
}

/**
 * Loads initial metadata (users) and prepares the UI.
 */
export async function loadInitialData() {
    // Initialize UI elements first (after DOM is ready)
    UI.initializeElements();

    UI.renderLoading(true);
    try {
        store.users = await Api.fetchUsers(store.claims.workspaceId);

        // Validate that we have at least one user
        if (!store.users || store.users.length === 0) {
            UI.renderLoading(false);
            UI.showError({
                title: 'No Users Found',
                message: 'No workspace members were found. Please check your permissions or try again.',
                action: 'reload'
            });
            return;
        }

        UI.renderOverridesTable();
    } catch (error) {
        UI.renderLoading(false);
        UI.showError({
            title: 'Failed to Load Users',
            message: 'Could not fetch workspace members. Please check your connection and try again.',
            action: 'reload'
        });
        return;
    }
    UI.renderLoading(false);

    bindConfigEvents();
    UI.bindEvents({
        onGenerate: handleGenerateReport,
        onOverrideChange: (userId, field, value) => {
            store.updateOverride(userId, field, value);
            if (store.rawEntries) runCalculation();
        },
        // NEW: Mode toggle handler
        onOverrideModeChange: (userId, mode) => {
            store.setOverrideMode(userId, mode);
            UI.renderOverridesTable();  // Re-render to show/hide per-day editor
            if (store.rawEntries) runCalculation();
        },
        // NEW: Per-day override handler
        onPerDayOverrideChange: (userId, dateKey, field, value) => {
            store.updatePerDayOverride(userId, dateKey, field, value);
            if (store.rawEntries) runCalculation();
        },
        // NEW: Copy from global button handler
        onCopyFromGlobal: (userId) => {
            const startInput = document.getElementById('startDate');
            const endInput = document.getElementById('endDate');
            if (startInput?.value && endInput?.value) {
                import('./utils.js').then(({ IsoUtils }) => {
                    const dates = IsoUtils.generateDateRange(startInput.value, endInput.value);
                    store.copyGlobalToPerDay(userId, dates);
                    UI.renderOverridesTable();  // Re-render to show copied values
                    if (store.rawEntries) runCalculation();
                });
            }
        },
        // Weekly override handler
        onWeeklyOverrideChange: (userId, weekday, field, value) => {
            store.setWeeklyOverride(userId, weekday, field, value);
            if (store.rawEntries) runCalculation();
        },
        // Copy global to weekly button handler
        onCopyGlobalToWeekly: (userId) => {
            store.copyGlobalToWeekly(userId);
            UI.renderOverridesTable();  // Re-render to show copied values
            if (store.rawEntries) runCalculation();
        }
    });
}

// --- Configuration Wiring ---

/**
 * Binds event listeners to configuration controls (toggles, inputs).
 * Handles persistence to localStorage and auto-recalculation.
 */
export function bindConfigEvents() {
    const configToggles = [
        { id: 'useProfileCapacity', key: 'useProfileCapacity' },
        { id: 'useProfileWorkingDays', key: 'useProfileWorkingDays' },
        { id: 'applyHolidays', key: 'applyHolidays' },
        { id: 'applyTimeOff', key: 'applyTimeOff' },
        { id: 'showBillableBreakdown', key: 'showBillableBreakdown' }
    ];

    configToggles.forEach(({ id, key }) => {
        const el = document.getElementById(id);
        if (el) {
            el.checked = store.config[key];
            el.addEventListener('change', (e) => {
                store.config[key] = e.target.checked;
                store.saveConfig();
                if (store.rawEntries) runCalculation();
            });
        }
    });

    const dailyEl = document.getElementById('configDaily');
    if (dailyEl) {
        dailyEl.value = store.calcParams.dailyThreshold;
        dailyEl.addEventListener('input', debounce((e) => {
            store.calcParams.dailyThreshold = parseFloat(e.target.value) || 8;
            store.saveConfig();
            if (store.rawEntries) runCalculation();
        }, 300));
    }

    const multEl = document.getElementById('configMultiplier');
    if (multEl) {
        multEl.value = store.calcParams.overtimeMultiplier;
        multEl.addEventListener('input', debounce((e) => {
            store.calcParams.overtimeMultiplier = parseFloat(e.target.value) || 1.5;
            store.saveConfig();
            if (store.rawEntries) runCalculation();
        }, 300));
    }

    const tier2ThresholdEl = document.getElementById('configTier2Threshold');
    if (tier2ThresholdEl) {
        tier2ThresholdEl.value = store.calcParams.tier2ThresholdHours || 0;
        tier2ThresholdEl.addEventListener('input', debounce((e) => {
            store.calcParams.tier2ThresholdHours = parseFloat(e.target.value) || 0;
            store.saveConfig();
            if (store.rawEntries) runCalculation();
        }, 300));
    }

    const tier2MultiplierEl = document.getElementById('configTier2Multiplier');
    if (tier2MultiplierEl) {
        tier2MultiplierEl.value = store.calcParams.tier2Multiplier || 2.0;
        tier2MultiplierEl.addEventListener('input', debounce((e) => {
            store.calcParams.tier2Multiplier = parseFloat(e.target.value) || 2.0;
            store.saveConfig();
            if (store.rawEntries) runCalculation();
        }, 300));
    }

    // Config toggle collapse
    const configToggle = document.getElementById('configToggle');
    const configContent = document.getElementById('configContent');
    if (configToggle && configContent) {
        configToggle.addEventListener('click', () => {
            configToggle.classList.toggle('collapsed');
            configContent.classList.toggle('hidden');
        });
    }

    // MEDIUM FIX #16: Tab navigation with ARIA support using event delegation to prevent listener accumulation
    const tabNavCard = document.getElementById('tabNavCard');
    if (tabNavCard && !tabNavCard.dataset.listenerAttached) {
        tabNavCard.dataset.listenerAttached = 'true';
        tabNavCard.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;

            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            const tab = btn.dataset.tab;
            document.getElementById('summaryCard').classList.toggle('hidden', tab !== 'summary');
            document.getElementById('detailedCard').classList.toggle('hidden', tab !== 'detailed');
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
    const setDateRange = (start, end) => {
        document.getElementById('startDate').value = IsoUtils.toISODate(start);
        document.getElementById('endDate').value = IsoUtils.toISODate(end);
    };

    document.getElementById('datePresetLastMonth')?.addEventListener('click', () => {
        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
        setDateRange(start, end);
    });

    document.getElementById('datePresetThisMonth')?.addEventListener('click', () => {
        const now = new Date();
        const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
        setDateRange(start, end);
    });

    // Detailed Filter Chips
    const filterContainer = document.getElementById('detailedFilters');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('chip')) {
                const filter = e.target.dataset.filter;
                UI.renderDetailedTable(store.analysisResults, filter);
            }
        });
    }

    // Summary Group By Selector
    const groupBySelect = document.getElementById('groupBySelect');
    if (groupBySelect) {
        // Initialize from stored state
        groupBySelect.value = store.ui.summaryGroupBy || 'user';

        groupBySelect.addEventListener('change', (e) => {
            store.ui.summaryGroupBy = e.target.value;
            store.saveUIState();
            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        });
    }

    // Summary Expand/Collapse Toggle
    const summaryExpandToggle = document.getElementById('summaryExpandToggle');
    if (summaryExpandToggle) {
        // Initialize from stored state
        const icon = summaryExpandToggle.querySelector('.expand-icon');
        const text = summaryExpandToggle.querySelector('.expand-text');
        if (store.ui.summaryExpanded) {
            icon.textContent = '▾';
            text.textContent = 'Hide breakdown';
        }

        summaryExpandToggle.addEventListener('click', () => {
            store.ui.summaryExpanded = !store.ui.summaryExpanded;
            store.saveUIState();

            // Update button UI
            const icon = summaryExpandToggle.querySelector('.expand-icon');
            const text = summaryExpandToggle.querySelector('.expand-text');
            if (store.ui.summaryExpanded) {
                icon.textContent = '▾';
                text.textContent = 'Hide breakdown';
            } else {
                icon.textContent = '▸';
                text.textContent = 'Show breakdown';
            }

            // Re-render table with new state
            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        });
    }
}

// --- Report Logic ---

/** HIGH FIX #8: Use request-scoped date range instead of global to prevent race conditions */
/** Reference to the AbortController for the active report generation request. */
let abortController = null;
/** HIGH FIX #7: Request ID to detect stale responses from concurrent requests */
let currentRequestId = 0;

/**
 * Orchestrates the full report generation process.
 * 1. Cancels any pending requests.
 * 2. Fetches time entries, profiles, holidays, and time-off in parallel.
 * 3. Updates state and triggers calculation.
 */
export async function handleGenerateReport() {
    // Cancel previous request if running
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();
    const { signal } = abortController;

    // HIGH FIX #7: Increment request ID to detect stale responses
    currentRequestId++;
    const thisRequestId = currentRequestId;

    UI.renderLoading(true);
    store.resetApiStatus();
    store.clearFetchCache(); // Clear cached holidays/timeOff to prevent memory bloat

    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

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

    // MEDIUM FIX #14: Validate date range
    if (startDate > endDate) {
        UI.renderLoading(false);
        UI.showError({
            title: 'Invalid Date Range',
            message: 'Start date must be before or equal to end date.',
            action: 'none'
        });
        return;
    }

    // HIGH FIX #8: Use request-scoped date range
    const requestDateRange = { start: startDate, end: endDate };

    try {
        // Fetch via Detailed Report API (single request for ALL users)
        // Includes type field for HOLIDAY/TIME_OFF identification
        const entries = await Api.fetchDetailedReport(
            store.claims.workspaceId,
            `${startDate}T00:00:00Z`,
            `${endDate}T23:59:59Z`,
            { signal }
        );
        store.rawEntries = entries;

        // Prepare optional fetch promises (these can fail gracefully)
        const optionalPromises = [];

        // 2. Fetch Profiles (Capacity/Working Days) - OPTIONAL
        if (store.config.useProfileCapacity || store.config.useProfileWorkingDays) {
            const missingUsers = store.users.filter(u => !store.profiles.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'profiles',
                    promise: Api.fetchAllProfiles(store.claims.workspaceId, missingUsers, { signal })
                        .then(profiles => {
                            profiles.forEach((profile, userId) => {
                                store.profiles.set(userId, {
                                    workCapacityHours: parseIsoDuration(profile.workCapacity),
                                    workingDays: profile.workingDays
                                });
                            });
                        })
                });
            }
        }

        // 3. Fetch Holidays - OPTIONAL
        if (store.config.applyHolidays) {
            optionalPromises.push({
                name: 'holidays',
                promise: Api.fetchAllHolidays(store.claims.workspaceId, store.users, startDate, endDate, { signal })
                    .then(holidays => {
                        holidays.forEach((hList, userId) => {
                            const hMap = new Map();
                            (hList || []).forEach(h => {
                                const startKey = IsoUtils.extractDateKey(h.datePeriod?.startDate);
                                const endKey = IsoUtils.extractDateKey(h.datePeriod?.endDate);

                                if (startKey) {
                                    if (!endKey || endKey === startKey) {
                                        hMap.set(startKey, h);
                                    } else {
                                        // Expand multi-day holidays
                                        const range = IsoUtils.generateDateRange(startKey, endKey);
                                        range.forEach(date => hMap.set(date, h));
                                    }
                                }
                            });
                            store.holidays.set(userId, hMap);
                        });
                    })
            });
        }

        // 4. Fetch Time Off - OPTIONAL
        if (store.config.applyTimeOff) {
            optionalPromises.push({
                name: 'timeOff',
                promise: Api.fetchAllTimeOff(store.claims.workspaceId, store.users, startDate, endDate, { signal })
                    .then(timeOff => {
                        store.timeOff = timeOff;
                    })
            });
        }

        // Wait for optional fetches with graceful failure handling
        if (optionalPromises.length > 0) {
            const results = await Promise.allSettled(optionalPromises.map(p => p.promise));
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    // ONLY report failure if the error is NOT an AbortError
                    if (result.reason?.name !== 'AbortError') {
                        const name = optionalPromises[index].name;
                        console.warn(`Optional fetch '${name}' failed:`, result.reason);
                        // Track failures for UI status display
                        if (name === 'profiles') store.apiStatus.profilesFailed = store.users.length;
                        if (name === 'holidays') store.apiStatus.holidaysFailed = store.users.length;
                        if (name === 'timeOff') store.apiStatus.timeOffFailed = store.users.length;
                    }
                }
            });
        }

        // HIGH FIX #7: Check if this request is still current before updating UI
        if (thisRequestId !== currentRequestId) {
            console.log('Stale request detected, discarding results');
            return;
        }

        runCalculation(requestDateRange);
        document.getElementById('tabNavCard').style.display = 'block';

        // Enable Export button
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) exportBtn.disabled = false;

        UI.renderApiStatus();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Report generation cancelled');
            // HIGH FIX #11: Clean up state on abort
            store.rawEntries = null;
            return;
        }
        console.error('Report generation failed:', error);
        UI.showError({
            title: 'Report Generation Failed',
            message: 'An error occurred while fetching time entries. Please try again.',
            action: 'retry'
        });
    } finally {
        UI.renderLoading(false);
        abortController = null; // Clean up controller reference
    }
}

/**
 * Triggers the calculation engine and updates all UI views with results.
 * HIGH FIX #8: Accept dateRange as parameter instead of using global variable
 * @param {Object} [dateRange] - Optional date range. If not provided, uses stored analysis date range.
 */
export function runCalculation(dateRange) {
    // Use provided dateRange or fall back to stored date range for recalculations
    const effectiveDateRange = dateRange || store.currentDateRange || { start: null, end: null };

    // Store the date range for subsequent recalculations (e.g., config changes)
    if (dateRange) {
        store.currentDateRange = dateRange;
    }

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

