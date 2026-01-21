/**
 * @fileoverview Calculation Engine
 * Pure calculation logic for overtime analysis, billable breakdowns, and summary generation.
 * This module is side-effect free (no DOM, no network, no localStorage).
 *
 * === KEY BUSINESS RULES ===
 * 1. BREAK and TIME_OFF/HOLIDAY entries count as regular hours but never trigger or become OT.
 * 2. Effective capacity = user override ?? profile capacity ?? global daily threshold.
 * 3. Capacity is zeroed on holidays, non-working days (per profile), and reduced by time-off.
 * 4. Tail attribution: OT is assigned to the last entries of the day when capacity is exceeded.
 * 5. Billable split preserves the original entry billable flag (WORK entries only for OT).
 */

import {
    round,
    parseIsoDuration,
    classifyEntryForOvertime,
    IsoUtils,
    type EntryClassification,
} from './utils.js';
import type {
    TimeEntry,
    UserAnalysis,
    UserTotals,
    DayData,
    DayMeta,
    EntryAnalysis,
    AmountBreakdown,
    DateRange,
    UserProfile,
    Holiday,
    TimeOffInfo,
    UserOverride,
    OvertimeConfig,
    CalculationParams,
} from './types.js';
import type { Store } from './state.js';

// ==================== TYPE DEFINITIONS ====================

/**
 * Store-like interface for calculations
 */
interface CalcStore {
    users: { id: string; name: string }[];
    profiles: Map<string, UserProfile>;
    holidays: Map<string, Map<string, Holiday>>;
    timeOff: Map<string, Map<string, TimeOffInfo>>;
    overrides: Record<string, UserOverride>;
    config: OvertimeConfig;
    calcParams: CalculationParams;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Safely extracts a numeric rate from various API formats.
 * Reports API may return rates in cents or as objects.
 *
 * @param rateField - Rate value (could be number or object).
 * @returns Rate in cents (for currency formatting).
 */
function extractRate(rateField: number | { amount?: number } | null | undefined): number {
    if (rateField == null) return 0;
    if (typeof rateField === 'number') return rateField;
    if (typeof rateField === 'object' && 'amount' in rateField) {
        return rateField.amount || 0;
    }
    return 0;
}

/**
 * Rate configuration for amount calculations
 */
interface RatesConfig {
    earned: number;
    cost: number;
    profit: number;
}

/**
 * Extracts rate values for all amount types from an entry.
 * @param entry - Time entry.
 * @returns Rates in cents for earned/cost/profit.
 */
function extractRates(entry: TimeEntry): RatesConfig {
    const earnedRate = extractRate(entry.earnedRate) || extractRate(entry.hourlyRate);
    const costRate = extractRate(entry.costRate) || 0;
    const profitRate = earnedRate - costRate;

    return {
        earned: earnedRate,
        cost: costRate,
        profit: profitRate,
    };
}

/**
 * Gets effective capacity for a user on a specific day.
 * Priority: per-day override > weekly override > global override > profile > default.
 *
 * @param userId - User ID.
 * @param dateKey - Date in YYYY-MM-DD format.
 * @param store - Application store.
 * @returns Effective capacity in hours.
 */
function getEffectiveCapacity(userId: string, dateKey: string, store: CalcStore): number {
    const override = store.overrides[userId];

    // 1. Per-day override (highest priority)
    if (override?.mode === 'perDay' && override.perDayOverrides?.[dateKey]?.capacity != null) {
        const val = override.perDayOverrides[dateKey].capacity;
        const parsed = parseFloat(String(val));
        if (!isNaN(parsed)) return parsed;
    }

    // 2. Weekly override (day-of-week)
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.capacity != null) {
            const val = override.weeklyOverrides[weekday].capacity;
            const parsed = parseFloat(String(val));
            if (!isNaN(parsed)) return parsed;
        }
    }

    // 3. Global user override
    if (override?.capacity != null) {
        const parsed = parseFloat(String(override.capacity));
        if (!isNaN(parsed)) return parsed;
    }

    // 4. Profile capacity (if enabled)
    if (store.config.useProfileCapacity) {
        const profile = store.profiles.get(userId);
        if (profile?.workCapacityHours != null) {
            return profile.workCapacityHours;
        }
    }

    // 5. Global default
    return store.calcParams.dailyThreshold;
}

/**
 * Gets effective multiplier for a user on a specific day.
 * @param userId - User ID.
 * @param dateKey - Date in YYYY-MM-DD format.
 * @param store - Application store.
 * @returns Effective OT multiplier.
 */
function getEffectiveMultiplier(userId: string, dateKey: string, store: CalcStore): number {
    const override = store.overrides[userId];

    // 1. Per-day override
    if (override?.mode === 'perDay' && override.perDayOverrides?.[dateKey]?.multiplier != null) {
        const val = override.perDayOverrides[dateKey].multiplier;
        const parsed = parseFloat(String(val));
        if (!isNaN(parsed)) return parsed;
    }

    // 2. Weekly override
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.multiplier != null) {
            const val = override.weeklyOverrides[weekday].multiplier;
            const parsed = parseFloat(String(val));
            if (!isNaN(parsed)) return parsed;
        }
    }

    // 3. Global override
    if (override?.multiplier != null) {
        const parsed = parseFloat(String(override.multiplier));
        if (!isNaN(parsed)) return parsed;
    }

    // 4. Global default
    return store.calcParams.overtimeMultiplier;
}

/**
 * Gets effective tier2 threshold for a user on a specific day.
 * @param userId - User ID.
 * @param dateKey - Date in YYYY-MM-DD format.
 * @param store - Application store.
 * @returns Tier2 threshold in OT hours.
 */
function getEffectiveTier2Threshold(userId: string, dateKey: string, store: CalcStore): number {
    const override = store.overrides[userId];

    // 1. Per-day override
    if (
        override?.mode === 'perDay' &&
        override.perDayOverrides?.[dateKey]?.tier2Threshold != null
    ) {
        const val = override.perDayOverrides[dateKey].tier2Threshold;
        const parsed = parseFloat(String(val));
        if (!isNaN(parsed)) return parsed;
    }

    // 2. Weekly override
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.tier2Threshold != null) {
            const val = override.weeklyOverrides[weekday].tier2Threshold;
            const parsed = parseFloat(String(val));
            if (!isNaN(parsed)) return parsed;
        }
    }

    // 3. Global override
    if (override?.tier2Threshold != null) {
        const parsed = parseFloat(String(override.tier2Threshold));
        if (!isNaN(parsed)) return parsed;
    }

    // 4. Global default
    return store.calcParams.tier2ThresholdHours || 0;
}

/**
 * Gets effective tier2 multiplier for a user on a specific day.
 * @param userId - User ID.
 * @param dateKey - Date in YYYY-MM-DD format.
 * @param store - Application store.
 * @returns Tier2 multiplier.
 */
function getEffectiveTier2Multiplier(userId: string, dateKey: string, store: CalcStore): number {
    const override = store.overrides[userId];

    // 1. Per-day override
    if (
        override?.mode === 'perDay' &&
        override.perDayOverrides?.[dateKey]?.tier2Multiplier != null
    ) {
        const val = override.perDayOverrides[dateKey].tier2Multiplier;
        const parsed = parseFloat(String(val));
        if (!isNaN(parsed)) return parsed;
    }

    // 2. Weekly override
    if (override?.mode === 'weekly' && override.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (override.weeklyOverrides[weekday]?.tier2Multiplier != null) {
            const val = override.weeklyOverrides[weekday].tier2Multiplier;
            const parsed = parseFloat(String(val));
            if (!isNaN(parsed)) return parsed;
        }
    }

    // 3. Global override
    if (override?.tier2Multiplier != null) {
        const parsed = parseFloat(String(override.tier2Multiplier));
        if (!isNaN(parsed)) return parsed;
    }

    // 4. Global default
    return store.calcParams.tier2Multiplier || 2.0;
}

/**
 * Checks if a user has a working day on the given date.
 * @param userId - User ID.
 * @param dateKey - Date in YYYY-MM-DD format.
 * @param store - Application store.
 * @returns True if the day is a working day for the user.
 */
function isWorkingDay(userId: string, dateKey: string, store: CalcStore): boolean {
    if (!store.config.useProfileWorkingDays) return true;

    const profile = store.profiles.get(userId);
    if (!profile?.workingDays) return true;

    const weekday = IsoUtils.getWeekdayKey(dateKey);
    return profile.workingDays.includes(weekday);
}

/**
 * Checks if a date is a holiday for a user.
 * @param userId - User ID.
 * @param dateKey - Date in YYYY-MM-DD format.
 * @param store - Application store.
 * @returns Holiday info or null.
 */
function getHoliday(userId: string, dateKey: string, store: CalcStore): Holiday | null {
    if (!store.config.applyHolidays) return null;

    const userHolidays = store.holidays.get(userId);
    if (!userHolidays) return null;

    return userHolidays.get(dateKey) || null;
}

/**
 * Gets time-off info for a user on a specific date.
 * @param userId - User ID.
 * @param dateKey - Date in YYYY-MM-DD format.
 * @param store - Application store.
 * @returns TimeOffInfo or null.
 */
function getTimeOff(userId: string, dateKey: string, store: CalcStore): TimeOffInfo | null {
    if (!store.config.applyTimeOff) return null;

    const userTimeOff = store.timeOff.get(userId);
    if (!userTimeOff) return null;

    return userTimeOff.get(dateKey) || null;
}

/**
 * Creates an empty user totals object.
 * @returns Empty UserTotals.
 */
function createEmptyTotals(): UserTotals {
    return {
        regular: 0,
        overtime: 0,
        total: 0,
        breaks: 0,
        billableWorked: 0,
        nonBillableWorked: 0,
        billableOT: 0,
        nonBillableOT: 0,
        amount: 0,
        amountBase: 0,
        amountEarned: 0,
        amountCost: 0,
        amountProfit: 0,
        amountEarnedBase: 0,
        amountCostBase: 0,
        amountProfitBase: 0,
        profit: 0,
        otPremium: 0,
        otPremiumTier2: 0,
        otPremiumEarned: 0,
        otPremiumCost: 0,
        otPremiumProfit: 0,
        otPremiumTier2Earned: 0,
        otPremiumTier2Cost: 0,
        otPremiumTier2Profit: 0,
        expectedCapacity: 0,
        holidayCount: 0,
        timeOffCount: 0,
        holidayHours: 0,
        timeOffHours: 0,
        vacationEntryHours: 0,
    };
}

/**
 * Creates day metadata.
 * @param capacity - Effective capacity.
 * @param isHoliday - Whether it's a holiday.
 * @param holidayName - Holiday name.
 * @param isNonWorking - Whether it's a non-working day.
 * @param isTimeOff - Whether user has time off.
 * @param holidayProjectId - Associated holiday project ID.
 * @returns DayMeta object.
 */
function createDayMeta(
    capacity: number,
    isHoliday: boolean,
    holidayName: string,
    isNonWorking: boolean,
    isTimeOff: boolean,
    holidayProjectId?: string | null
): DayMeta {
    return {
        capacity,
        isHoliday,
        holidayName,
        isNonWorking,
        isTimeOff,
        holidayProjectId,
    };
}

/**
 * Calculates amounts for each amount type (earned/cost/profit).
 */
function calculateAmounts(
    regularHours: number,
    overtimeHours: number,
    tier1Hours: number,
    tier2Hours: number,
    rates: RatesConfig,
    multiplier: number,
    tier2Multiplier: number
): { earned: AmountBreakdown; cost: AmountBreakdown; profit: AmountBreakdown } {
    const calculate = (rate: number): AmountBreakdown => {
        const hourlyRate = rate / 100; // Convert from cents
        const regularAmount = round(regularHours * hourlyRate, 2);
        const overtimeAmountBase = round(overtimeHours * hourlyRate, 2);
        const tier1Premium = round(tier1Hours * hourlyRate * (multiplier - 1), 2);
        const tier2Premium = round(tier2Hours * hourlyRate * (tier2Multiplier - 1), 2);
        const totalAmountWithOT = round(
            regularAmount + overtimeAmountBase + tier1Premium + tier2Premium,
            2
        );
        const totalAmountNoOT = regularAmount;

        return {
            rate: hourlyRate,
            regularAmount,
            overtimeAmountBase,
            baseAmount: regularAmount + overtimeAmountBase,
            tier1Premium,
            tier2Premium,
            totalAmountWithOT,
            totalAmountNoOT,
            overtimeRate: round(hourlyRate * multiplier, 2),
        };
    };

    return {
        earned: calculate(rates.earned),
        cost: calculate(rates.cost),
        profit: calculate(rates.profit),
    };
}

// ==================== MAIN CALCULATION FUNCTION ====================

/**
 * Main calculation function for overtime analysis.
 *
 * @param entries - Array of time entries from API.
 * @param store - Application store with config and overrides.
 * @param dateRange - Date range for the report.
 * @returns Array of user analysis objects.
 */
export function calculateAnalysis(
    entries: TimeEntry[] | null,
    store: CalcStore | Store,
    dateRange: DateRange | null
): UserAnalysis[] {
    // Need valid date range to calculate capacity
    if (!dateRange || !dateRange.start || !dateRange.end) {
        return [];
    }

    // Entries can be null/empty - we still calculate capacity for all users
    const safeEntries = entries || [];

    const calcStore = store as CalcStore;

    // Get amount display mode for primary amount selection
    const amountDisplay = (calcStore.config.amountDisplay || 'earned').toLowerCase();

    // Group entries by user
    const entriesByUser = new Map<string, TimeEntry[]>();
    for (const entry of safeEntries) {
        if (!entry) continue; // Skip null entries
        const userId = entry.userId || 'unknown';
        if (!entriesByUser.has(userId)) {
            entriesByUser.set(userId, []);
        }
        entriesByUser.get(userId)!.push(entry);
    }

    // Build user analysis map
    const userAnalysisMap = new Map<string, UserAnalysis>();

    // Initialize all users from store (even those without entries)
    const storeUsers = Array.isArray(calcStore.users) ? calcStore.users : [];
    for (const user of storeUsers) {
        if (!user) continue;
        userAnalysisMap.set(user.id, {
            userId: user.id,
            userName: user.name,
            days: new Map(),
            totals: createEmptyTotals(),
        });
    }

    // Generate date range
    const allDates = IsoUtils.generateDateRange(dateRange.start, dateRange.end);

    // Process each user
    for (const [userId, userEntries] of entriesByUser) {
        // Find or create user analysis
        let userAnalysis = userAnalysisMap.get(userId);
        if (!userAnalysis) {
            // User not in store.users (maybe added during fetch)
            const userName = userEntries[0]?.userName || 'Unknown User';
            userAnalysis = {
                userId,
                userName,
                days: new Map(),
                totals: createEmptyTotals(),
            };
            userAnalysisMap.set(userId, userAnalysis);
        }

        // Group entries by date
        const entriesByDate = new Map<string, TimeEntry[]>();
        for (const entry of userEntries) {
            const dateKey = IsoUtils.extractDateKey(entry.timeInterval?.start);
            if (!dateKey) continue;

            if (!entriesByDate.has(dateKey)) {
                entriesByDate.set(dateKey, []);
            }
            entriesByDate.get(dateKey)!.push(entry);
        }

        // Track user-level accumulators
        let userOTAccumulator = 0;

        // Process each date in range
        for (const dateKey of allDates) {
            const dayEntries = entriesByDate.get(dateKey) || [];

            // Determine day context
            const baseCapacity = getEffectiveCapacity(userId, dateKey, calcStore);
            const holiday = getHoliday(userId, dateKey, calcStore);
            const isNonWorking = !isWorkingDay(userId, dateKey, calcStore);
            const timeOff = getTimeOff(userId, dateKey, calcStore);

            // Fallback detection from entries (when API is disabled)
            const hasHolidayEntry =
                !calcStore.config.applyHolidays &&
                dayEntries.some((e) => e.type === 'HOLIDAY' || e.type === 'HOLIDAY_TIME_ENTRY');

            const hasTimeOffEntry =
                !calcStore.config.applyTimeOff &&
                dayEntries.some((e) => e.type === 'TIME_OFF' || e.type === 'TIME_OFF_TIME_ENTRY');

            // Calculate time-off hours from entries (fallback)
            let entryTimeOffHours = 0;
            if (hasTimeOffEntry) {
                for (const e of dayEntries) {
                    if (e.type === 'TIME_OFF' || e.type === 'TIME_OFF_TIME_ENTRY') {
                        entryTimeOffHours += parseIsoDuration(e.timeInterval?.duration);
                    }
                }
            }

            // Determine effective capacity
            let effectiveCapacity = baseCapacity;
            const isHolidayDay = !!holiday || hasHolidayEntry;
            const isTimeOffDay = !!timeOff || hasTimeOffEntry;

            // Apply capacity adjustments
            if (isHolidayDay || isNonWorking) {
                effectiveCapacity = 0;
            } else if (timeOff) {
                if (timeOff.isFullDay) {
                    effectiveCapacity = 0;
                } else {
                    effectiveCapacity = Math.max(0, effectiveCapacity - timeOff.hours);
                }
            } else if (hasTimeOffEntry) {
                effectiveCapacity = Math.max(0, effectiveCapacity - entryTimeOffHours);
            }

            // Create day metadata
            const dayMeta = createDayMeta(
                effectiveCapacity,
                isHolidayDay,
                holiday?.name || '',
                isNonWorking,
                isTimeOffDay,
                holiday?.projectId || null
            );

            // Sort entries by start time for tail attribution
            const sortedEntries = [...dayEntries].sort(
                (a, b) =>
                    (a.timeInterval?.start || '').localeCompare(b.timeInterval?.start || '')
            );

            // Process entries for this day
            let dailyAccumulator = 0;
            const processedEntries: TimeEntry[] = [];

            for (const entry of sortedEntries) {
                const duration = parseIsoDuration(entry.timeInterval?.duration);
                const entryClass: EntryClassification = classifyEntryForOvertime(entry);
                const rates = extractRates(entry);

                // Get multipliers for this entry
                const multiplier = getEffectiveMultiplier(userId, dateKey, calcStore);
                const tier2Threshold = getEffectiveTier2Threshold(userId, dateKey, calcStore);
                const tier2Multiplier = getEffectiveTier2Multiplier(userId, dateKey, calcStore);

                // Determine regular vs overtime split
                let regularHours = 0;
                let overtimeHours = 0;
                let tier1Hours = 0;
                let tier2Hours = 0;

                if (entryClass === 'break' || entryClass === 'pto') {
                    // Breaks and PTO count as regular but don't accumulate toward capacity
                    regularHours = duration;
                    overtimeHours = 0;
                } else {
                    // Work entry - apply tail attribution
                    if (dailyAccumulator >= effectiveCapacity) {
                        // Already in OT
                        regularHours = 0;
                        overtimeHours = duration;
                    } else if (dailyAccumulator + duration <= effectiveCapacity) {
                        // Fully within capacity
                        regularHours = duration;
                        overtimeHours = 0;
                    } else {
                        // Straddles capacity boundary
                        regularHours = effectiveCapacity - dailyAccumulator;
                        overtimeHours = duration - regularHours;
                    }

                    // Only WORK entries accumulate toward capacity
                    dailyAccumulator += duration;
                }

                // Apply tier 2 logic to OT hours
                if (overtimeHours > 0 && tier2Threshold > 0) {
                    const otBeforeEntry = userOTAccumulator;
                    const otAfterEntry = otBeforeEntry + overtimeHours;

                    if (otBeforeEntry >= tier2Threshold) {
                        // All OT is tier 2
                        tier2Hours = overtimeHours;
                        tier1Hours = 0;
                    } else if (otAfterEntry <= tier2Threshold) {
                        // All OT is tier 1
                        tier1Hours = overtimeHours;
                        tier2Hours = 0;
                    } else {
                        // Straddles tier boundary
                        tier1Hours = tier2Threshold - otBeforeEntry;
                        tier2Hours = overtimeHours - tier1Hours;
                    }

                    userOTAccumulator = otAfterEntry;
                } else {
                    tier1Hours = overtimeHours;
                    tier2Hours = 0;
                    userOTAccumulator += overtimeHours;
                }

                // Calculate amounts
                const amounts = calculateAmounts(
                    regularHours,
                    overtimeHours,
                    tier1Hours,
                    tier2Hours,
                    rates,
                    multiplier,
                    tier2Multiplier
                );

                // Determine primary amount based on display mode
                const primaryAmounts =
                    amountDisplay === 'cost'
                        ? amounts.cost
                        : amountDisplay === 'profit'
                          ? amounts.profit
                          : amounts.earned;

                // Build entry analysis
                const analysis: EntryAnalysis = {
                    regular: round(regularHours, 4),
                    overtime: round(overtimeHours, 4),
                    isBillable: !!entry.billable,
                    isBreak: entryClass === 'break',
                    cost: primaryAmounts.totalAmountWithOT,
                    profit: amounts.profit.totalAmountWithOT,
                    tags: [],
                    hourlyRate: primaryAmounts.rate,
                    regularRate: primaryAmounts.rate,
                    overtimeRate: primaryAmounts.overtimeRate,
                    regularAmount: primaryAmounts.regularAmount,
                    overtimeAmountBase: primaryAmounts.overtimeAmountBase,
                    tier1Premium: primaryAmounts.tier1Premium,
                    tier2Premium: primaryAmounts.tier2Premium,
                    totalAmountWithOT: primaryAmounts.totalAmountWithOT,
                    totalAmountNoOT: primaryAmounts.totalAmountNoOT,
                    amounts,
                };

                // Add tags based on context
                if (isHolidayDay) analysis.tags.push('HOLIDAY');
                if (isNonWorking) analysis.tags.push('OFF-DAY');
                if (isTimeOffDay) analysis.tags.push('TIME-OFF');
                if (entryClass === 'break') analysis.tags.push('BREAK');

                // Attach analysis to entry
                const processedEntry: TimeEntry = {
                    ...entry,
                    analysis,
                };
                processedEntries.push(processedEntry);

                // Update totals
                const totals = userAnalysis.totals;
                totals.total += duration;

                if (entryClass === 'break') {
                    totals.breaks += duration;
                    totals.regular += regularHours;
                } else if (entryClass === 'pto') {
                    totals.vacationEntryHours += duration;
                    totals.regular += regularHours;
                } else {
                    totals.regular += regularHours;
                    totals.overtime += overtimeHours;

                    // Billable split (only for WORK entries)
                    if (entry.billable) {
                        totals.billableWorked += regularHours;
                        totals.billableOT += overtimeHours;
                    } else {
                        totals.nonBillableWorked += regularHours;
                        totals.nonBillableOT += overtimeHours;
                    }
                }

                // Accumulate amounts
                totals.amount += primaryAmounts.totalAmountWithOT;
                totals.amountBase += primaryAmounts.totalAmountNoOT;
                totals.amountEarned += amounts.earned.totalAmountWithOT;
                totals.amountCost += amounts.cost.totalAmountWithOT;
                totals.amountProfit += amounts.profit.totalAmountWithOT;
                totals.amountEarnedBase += amounts.earned.totalAmountNoOT;
                totals.amountCostBase += amounts.cost.totalAmountNoOT;
                totals.amountProfitBase += amounts.profit.totalAmountNoOT;
                totals.otPremium += primaryAmounts.tier1Premium + primaryAmounts.tier2Premium;
                totals.otPremiumTier2 += primaryAmounts.tier2Premium;
                totals.otPremiumEarned +=
                    amounts.earned.tier1Premium + amounts.earned.tier2Premium;
                totals.otPremiumCost += amounts.cost.tier1Premium + amounts.cost.tier2Premium;
                totals.otPremiumProfit +=
                    amounts.profit.tier1Premium + amounts.profit.tier2Premium;
                totals.otPremiumTier2Earned += amounts.earned.tier2Premium;
                totals.otPremiumTier2Cost += amounts.cost.tier2Premium;
                totals.otPremiumTier2Profit += amounts.profit.tier2Premium;
            }

            // Store day data
            const dayData: DayData = {
                entries: processedEntries,
                meta: dayMeta,
            };
            userAnalysis.days.set(dateKey, dayData);

            // Update capacity totals (use effective capacity which accounts for holidays/non-working days)
            userAnalysis.totals.expectedCapacity += effectiveCapacity;
            if (isHolidayDay) {
                userAnalysis.totals.holidayCount += 1;
                userAnalysis.totals.holidayHours += baseCapacity;
            }
            if (isTimeOffDay) {
                userAnalysis.totals.timeOffCount += 1;
                userAnalysis.totals.timeOffHours += timeOff?.hours || entryTimeOffHours;
            }
        }

        // Round final totals
        const totals = userAnalysis.totals;
        totals.regular = round(totals.regular, 4);
        totals.overtime = round(totals.overtime, 4);
        totals.total = round(totals.total, 4);
        totals.breaks = round(totals.breaks, 4);
        totals.billableWorked = round(totals.billableWorked, 4);
        totals.nonBillableWorked = round(totals.nonBillableWorked, 4);
        totals.billableOT = round(totals.billableOT, 4);
        totals.nonBillableOT = round(totals.nonBillableOT, 4);
        totals.amount = round(totals.amount, 2);
        totals.amountBase = round(totals.amountBase, 2);
        totals.amountEarned = round(totals.amountEarned, 2);
        totals.amountCost = round(totals.amountCost, 2);
        totals.amountProfit = round(totals.amountProfit, 2);
        totals.amountEarnedBase = round(totals.amountEarnedBase, 2);
        totals.amountCostBase = round(totals.amountCostBase, 2);
        totals.amountProfitBase = round(totals.amountProfitBase, 2);
        totals.otPremium = round(totals.otPremium, 2);
        totals.otPremiumTier2 = round(totals.otPremiumTier2, 2);
        totals.expectedCapacity = round(totals.expectedCapacity, 4);
        totals.vacationEntryHours = round(totals.vacationEntryHours, 4);

        // Set profit to match amountProfit for convenience
        totals.profit = totals.amountProfit;
    }

    // Process users without entries (calculate their expected capacity)
    for (const [userId, userAnalysis] of userAnalysisMap) {
        // Skip if already processed (has days)
        if (userAnalysis.days.size > 0) continue;

        // Calculate capacity for each date in range
        for (const dateKey of allDates) {
            const baseCapacity = getEffectiveCapacity(userId, dateKey, calcStore);
            const holiday = getHoliday(userId, dateKey, calcStore);
            const isNonWorking = !isWorkingDay(userId, dateKey, calcStore);
            const timeOff = getTimeOff(userId, dateKey, calcStore);

            let effectiveCapacity = baseCapacity;
            const isHolidayDay = !!holiday;
            const isTimeOffDay = !!timeOff;

            if (isHolidayDay || isNonWorking) {
                effectiveCapacity = 0;
            } else if (timeOff) {
                if (timeOff.isFullDay) {
                    effectiveCapacity = 0;
                } else {
                    effectiveCapacity = Math.max(0, effectiveCapacity - timeOff.hours);
                }
            }

            userAnalysis.totals.expectedCapacity += effectiveCapacity;
            if (isHolidayDay) {
                userAnalysis.totals.holidayCount += 1;
                userAnalysis.totals.holidayHours += baseCapacity;
            }
            if (isTimeOffDay) {
                userAnalysis.totals.timeOffCount += 1;
                userAnalysis.totals.timeOffHours += timeOff?.hours || 0;
            }
        }

        // Round capacity totals
        userAnalysis.totals.expectedCapacity = round(userAnalysis.totals.expectedCapacity, 4);
    }

    // Convert map to array and sort by user name
    const results = Array.from(userAnalysisMap.values()).sort((a, b) =>
        a.userName.localeCompare(b.userName)
    );

    return results;
}
