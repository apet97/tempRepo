/**
 * @fileoverview Calculation Module
 * Core logic for processing raw time entries into structured overtime analysis.
 * 
 * Responsibilities:
 * - Grouping time entries by user and date.
 * - Calculating effective capacity based on profiles, holidays, and time-off.
 * - Categorizing hours into Regular, Overtime, and Breaks.
 * - Applying cost calculations and multipliers.
 */

import { IsoUtils, round, parseIsoDuration, classifyEntryForOvertime } from './utils.js';
import { CONSTANTS } from './constants.js';

// --- Helpers ---

/**
 * Calculates duration in decimal hours from a time entry.
 * Uses `duration` (ISO 8601) if available, otherwise falls back to `start` and `end` diff.
 * MEDIUM FIX #15: Returns 0 for invalid/NaN durations to prevent calculation corruption.
 *
 * @param {Object} entry - The time entry object from Clockify API.
 * @returns {number} Duration in decimal hours (e.g., 1.5), always a valid number.
 */
function calculateDuration(entry) {
    if (entry.timeInterval && entry.timeInterval.duration) {
        const d = parseIsoDuration(entry.timeInterval.duration);
        // Only return if parsed duration is valid (not NaN and > 0) or explicitly a zero duration string
        if (!isNaN(d) && (d > 0 || entry.timeInterval.duration.startsWith('PT'))) {
            return d;
        }
    }
    // Fallback: Calculate from start/end timestamps
    if (entry.timeInterval?.start && entry.timeInterval?.end) {
        const startDate = new Date(entry.timeInterval.start);
        const endDate = new Date(entry.timeInterval.end);
        // Validate dates before calculating
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            const duration = (endDate - startDate) / 3600000;
            return isNaN(duration) ? 0 : duration;
        }
    }
    return 0;
}

/**
 * Detect holiday/time-off context from entry types in the day's entries.
 * Fallback mechanism for when API fetch fails or is disabled.
 *
 * @param {Array<Object>} entries - Array of time entries for the day.
 * @returns {Object} Detection result.
 * @property {boolean} hasHoliday - True if any entry has type='HOLIDAY'.
 * @property {boolean} hasTimeOff - True if any entry has type='TIME_OFF'.
 * @property {number} timeOffHours - Total hours from TIME_OFF entries.
 */
function detectDayContextFromEntries(entries) {
    let hasHoliday = false;
    let hasTimeOff = false;
    let timeOffHours = 0;

    for (const entry of entries) {
        if (entry.type === 'HOLIDAY') {
            hasHoliday = true;
        } else if (entry.type === 'TIME_OFF') {
            hasTimeOff = true;
            const duration = parseIsoDuration(entry.timeInterval?.duration || 'PT0H');
            timeOffHours += duration;
        }
    }

    return { hasHoliday, hasTimeOff, timeOffHours };
}

/**
 * Determines the effective daily capacity and anomaly status for a user on a specific date.
 *
 * Precedence Order:
 * 1. User Override (Manual UI input)
 * 2. Member Profile (API `workCapacity`)
 * 3. Global Default (Config `dailyThreshold`)
 *
 * Also checks for Holidays and Time Off if enabled in config.
 * Fallback: Detects holiday/time-off from entry types if API data unavailable.
 *
 * @param {string} dateKey - ISO date string YYYY-MM-DD.
 * @param {string} userId - ID of the user.
 * @param {Object} storeRef - Reference to the global state store containing profiles/holidays/config.
 * @param {Array<Object>} dayEntries - Optional array of entries for this day (for fallback detection).
 * @returns {Object} Result object.
 * @property {number} capacity - The calculated capacity in hours.
 * @property {boolean} isNonWorking - True if it's a non-working day per profile.
 * @property {boolean} isHoliday - True if it's a holiday.
 * @property {string|null} holidayName - Name of the holiday if applicable.
 * @property {boolean} isTimeOff - True if user has approved time off.
 */
function getEffectiveCapacity(dateKey, userId, storeRef, dayEntries = []) {
    const { overrides, profiles, holidays, timeOff, config, calcParams } = storeRef;
    const userOverride = overrides[userId] || {};
    const profile = profiles.get(userId);
    const userHolidays = holidays.get(userId);
    const userTimeOff = timeOff?.get(userId);

    // Initialize anomaly flags
    let isNonWorking = false;
    let isHoliday = false;
    let holidayName = null;
    let isTimeOff = false;
    let holidayHours = 0;
    let timeOffHours = 0;

    // 1. Determine Base Capacity: Per-Day Override > Weekly Override > Global Override > Profile > Global Default
    let capacity = calcParams.dailyThreshold;

    // Check per-day override first
    if (userOverride.mode === 'perDay' && userOverride.perDayOverrides?.[dateKey]) {
        const dayOverride = userOverride.perDayOverrides[dateKey];
        if (dayOverride.capacity !== undefined && dayOverride.capacity !== '') {
            capacity = parseFloat(dayOverride.capacity);
        }
    }
    // Check weekly override
    else if (userOverride.mode === 'weekly' && userOverride.weeklyOverrides) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        const weekdayOverride = userOverride.weeklyOverrides[weekday];
        if (weekdayOverride?.capacity !== undefined && weekdayOverride.capacity !== '') {
            capacity = parseFloat(weekdayOverride.capacity);
        }
        // Fall through to global if no weekly override for this day
        else if (userOverride.capacity !== undefined && userOverride.capacity !== '') {
            capacity = parseFloat(userOverride.capacity);
        } else if (config.useProfileCapacity && profile?.workCapacityHours != null) {
            capacity = profile.workCapacityHours;
        }
    }
    // Fall through to global override if no per-day or weekly override
    else if (userOverride.capacity !== undefined && userOverride.capacity !== '') {
        capacity = parseFloat(userOverride.capacity);
    } else if (config.useProfileCapacity && profile?.workCapacityHours != null) {
        capacity = profile.workCapacityHours;
    }

    // 2. Working Days (Profile) - can coexist with other anomalies
    if (config.useProfileWorkingDays && profile?.workingDays) {
        const weekday = IsoUtils.getWeekdayKey(dateKey);
        if (!profile.workingDays.includes(weekday)) {
            isNonWorking = true;
            capacity = 0; // Non-working day has 0 capacity
        }
    }

    // Capture base capacity (after overrides/profile/working days, but BEFORE anomalies)
    const baseCapacity = capacity;

    // 3. Holidays - can coexist with time off, takes precedence over working days logic
    let holidayProjectId = null;
    if (config.applyHolidays && userHolidays?.has(dateKey)) {
        const holiday = userHolidays.get(dateKey);
        isHoliday = true;
        holidayName = holiday.name || 'Holiday';
        holidayProjectId = holiday.projectId;
        capacity = 0; // Holiday has 0 capacity
    }

    // 4. Time Off (reduce capacity) - can coexist with holiday (though redundant capacity-wise)
    // Track time off independently, but don't double-reduce capacity if already a holiday
    if (config.applyTimeOff && userTimeOff?.has(dateKey)) {
        const toInfo = userTimeOff.get(dateKey);
        isTimeOff = true;

        // Only adjust capacity if not already a holiday (which already set capacity to 0)
        if (!isHoliday) {
            if (toInfo.isFullDay) {
                timeOffHours = baseCapacity; // Lost full day capacity
                capacity = 0;
            } else if (toInfo.hours > 0) {
                timeOffHours = toInfo.hours;
                capacity = Math.max(0, capacity - toInfo.hours);
            }
        } else {
            // Holiday already set capacity to 0, just track the time off hours for stats
            if (toInfo.isFullDay) {
                timeOffHours = baseCapacity;
            } else if (toInfo.hours > 0) {
                timeOffHours = toInfo.hours;
            }
        }
    }

    // 5. Fallback: Detect holiday/time-off from entry types (ONLY when API is disabled)
    // This ensures graceful degradation when API is disabled or not available
    if (dayEntries.length > 0) {
        const entryContext = detectDayContextFromEntries(dayEntries);

        // Apply holiday detection from entries (only if API is disabled AND not already detected)
        if (!config.applyHolidays && !isHoliday && entryContext.hasHoliday) {
            isHoliday = true;
            capacity = 0;
            holidayName = 'Holiday (detected from entry)';
            holidayHours = baseCapacity;
        }

        // Apply time-off detection from entries (only if API is disabled AND not already detected)
        if (!config.applyTimeOff && !isTimeOff && entryContext.hasTimeOff && entryContext.timeOffHours > 0) {
            isTimeOff = true;

            // Only adjust capacity if not already a holiday
            if (!isHoliday) {
                const reduction = Math.min(entryContext.timeOffHours, capacity);
                timeOffHours = reduction;
                capacity = Math.max(0, capacity - reduction);
            } else {
                // Holiday already set capacity to 0, just track the hours
                timeOffHours = entryContext.timeOffHours;
            }
        }
    }

    // Determine Holiday Hours (if holiday, it takes the full base capacity or remaining capacity?)
    // Usually holiday replaces the full working day.
    if (isHoliday && holidayHours === 0) {
        holidayHours = baseCapacity;
    }

    return { capacity, baseCapacity, isNonWorking, isHoliday, holidayName, holidayProjectId, isTimeOff, holidayHours, timeOffHours };
}

// --- Main Calculation ---

/**
 * Main application logic. Processes raw entries into a structured analysis report.
 * 
 * Algorithm:
 * 1. Initialize user map to ensure all users are tracked even with no entries.
 * 2. Group raw entries by User & Date.
 * 3. Generate the full date range to cover days with 0 entries.
 * 4. Iterate through every user and every day in the range:
 *    - Calculate Effective Capacity.
 *    - Sort entries by start time (Tail Attribution).
 *    - Categorize duration into Regular vs Overtime based on capacity threshold.
 *    - Track billable/non-billable splits.
 *    - Calculate costs (Base + Premium).
 * 5. Aggregate totals per user.
 * 
 * @param {Array<Object>} entries - Raw time entries from API.
 * @param {Object} storeRef - Reference to state store.
 * @param {Object} dateRange - { start: YYYY-MM-DD, end: YYYY-MM-DD }
 * @returns {Array<Object>} List of user analysis objects ready for UI rendering.
 */
export function calculateAnalysis(entries, storeRef, dateRange) {
    const { overrides, calcParams, users } = storeRef;
    const usersMap = new Map();

    // Initialize users from the store's user list (not just entries)
    // This ensures we have all users even if they have no entries
    (users || []).forEach(user => {
        usersMap.set(user.id, {
            userId: user.id,
            userName: user.name,
            days: new Map(),
            totals: {
                regular: 0,
                overtime: 0,
                total: 0,
                breaks: 0,
                billableWorked: 0,
                nonBillableWorked: 0,
                billableOT: 0,
                nonBillableOT: 0,
                amount: 0,
                amountBase: 0,  // Base cost without OT premium
                otPremium: 0,
                otPremiumTier2: 0,  // Additional Tier 2 premium
                expectedCapacity: 0,
                holidayCount: 0,
                timeOffCount: 0,
                holidayHours: 0,
                timeOffHours: 0,
                vacationEntryHours: 0  // Track actual HOLIDAY/TIME_OFF entry durations
            }
        });
    });

    // 1. Group entries by User & Day
    entries.forEach(entry => {
        // Skip null/undefined entries
        if (!entry || !entry.timeInterval || !entry.timeInterval.start) {
            return;
        }

        const dateKey = IsoUtils.extractDateKey(entry.timeInterval.start);
        if (!dateKey) return;

        let user = usersMap.get(entry.userId);
        if (!user) {
            // User not in list (shouldn't happen, but fallback)
            user = {
                userId: entry.userId,
                userName: entry.userName || 'Unknown',
                days: new Map(),
                totals: { regular: 0, overtime: 0, total: 0, breaks: 0, billableWorked: 0, nonBillableWorked: 0, billableOT: 0, nonBillableOT: 0, amount: 0, amountBase: 0, otPremium: 0, otPremiumTier2: 0, expectedCapacity: 0, holidayCount: 0, timeOffCount: 0, holidayHours: 0, timeOffHours: 0, vacationEntryHours: 0 }
            };
            usersMap.set(entry.userId, user);
        }

        if (!user.days.has(dateKey)) {
            user.days.set(dateKey, { entries: [] });
        }
        user.days.get(dateKey).entries.push(entry);
    });

    // 2. Generate full date range and compute capacity for ALL days
    const allDateKeys = dateRange && dateRange.start && dateRange.end
        ? IsoUtils.generateDateRange(dateRange.start, dateRange.end)
        : [];

    // Track cumulative OT hours per user for tier 2 calculation
    const userCumulativeOT = new Map();

    // 3. Process each user for each day in range
    usersMap.forEach(user => {
        // Initialize cumulative OT tracker for this user
        userCumulativeOT.set(user.userId, 0);

        // Iterate over the FULL date range, not just days with entries
        const daysToProcess = allDateKeys.length > 0 ? allDateKeys : Array.from(user.days.keys()).sort();

        daysToProcess.forEach(dateKey => {
            const dayData = user.days.get(dateKey) || { entries: [] };
            const { capacity, isNonWorking, isHoliday, holidayName, holidayProjectId, isTimeOff, holidayHours, timeOffHours } = getEffectiveCapacity(dateKey, user.userId, storeRef, dayData.entries);

            // Extract multiplier with per-day and weekly override support
            let userMultiplier = calcParams.overtimeMultiplier;
            const override = overrides[user.userId];

            if (override) {
                // Check per-day multiplier first (need dateKey context)
                if (override.mode === 'perDay' && override.perDayOverrides?.[dateKey]?.multiplier) {
                    const parsed = parseFloat(override.perDayOverrides[dateKey].multiplier);
                    if (!isNaN(parsed) && parsed > 0) {
                        userMultiplier = parsed;
                    }
                }
                // Check weekly multiplier
                else if (override.mode === 'weekly' && override.weeklyOverrides) {
                    const weekday = IsoUtils.getWeekdayKey(dateKey);
                    const weekdayOverride = override.weeklyOverrides[weekday];
                    if (weekdayOverride?.multiplier) {
                        const parsed = parseFloat(weekdayOverride.multiplier);
                        if (!isNaN(parsed) && parsed > 0) {
                            userMultiplier = parsed;
                        }
                    }
                    // Fall through to global multiplier if no weekly override for this day
                    else if (override.multiplier !== undefined && override.multiplier !== '') {
                        const parsed = parseFloat(override.multiplier);
                        if (!isNaN(parsed) && parsed > 0) {
                            userMultiplier = parsed;
                        }
                    }
                }
                // Fall through to global multiplier
                else if (override.multiplier !== undefined && override.multiplier !== '') {
                    const parsed = parseFloat(override.multiplier);
                    if (!isNaN(parsed) && parsed > 0) {
                        userMultiplier = parsed;
                    }
                }
            }

            // Extract tier2 threshold and multiplier with same precedence as multiplier
            let userTier2Threshold = calcParams.tier2ThresholdHours || 0;
            let userTier2Multiplier = calcParams.tier2Multiplier || 2.0;

            if (override) {
                // Check per-day override first
                if (override.mode === 'perDay' && override.perDayOverrides?.[dateKey]?.tier2Threshold !== undefined) {
                    userTier2Threshold = parseFloat(override.perDayOverrides[dateKey].tier2Threshold);
                }
                else if (override.mode === 'weekly' && override.weeklyOverrides) {
                    const weekday = IsoUtils.getWeekdayKey(dateKey);
                    const weekdayOverride = override.weeklyOverrides[weekday];
                    if (weekdayOverride?.tier2Threshold !== undefined) {
                        userTier2Threshold = parseFloat(weekdayOverride.tier2Threshold);
                    }
                    // Fall through to global if no weekly override for this day
                    else if (override.tier2Threshold !== undefined && override.tier2Threshold !== '') {
                        userTier2Threshold = parseFloat(override.tier2Threshold);
                    }
                }
                // Fall through to global override
                else if (override.tier2Threshold !== undefined && override.tier2Threshold !== '') {
                    userTier2Threshold = parseFloat(override.tier2Threshold);
                }

                // Same for tier2Multiplier
                if (override.mode === 'perDay' && override.perDayOverrides?.[dateKey]?.tier2Multiplier !== undefined) {
                    userTier2Multiplier = parseFloat(override.perDayOverrides[dateKey].tier2Multiplier);
                }
                else if (override.mode === 'weekly' && override.weeklyOverrides) {
                    const weekday = IsoUtils.getWeekdayKey(dateKey);
                    const weekdayOverride = override.weeklyOverrides[weekday];
                    if (weekdayOverride?.tier2Multiplier !== undefined) {
                        userTier2Multiplier = parseFloat(weekdayOverride.tier2Multiplier);
                    }
                    // Fall through to global if no weekly override for this day
                    else if (override.tier2Multiplier !== undefined && override.tier2Multiplier !== '') {
                        userTier2Multiplier = parseFloat(override.tier2Multiplier);
                    }
                }
                // Fall through to global override
                else if (override.tier2Multiplier !== undefined && override.tier2Multiplier !== '') {
                    userTier2Multiplier = parseFloat(override.tier2Multiplier);
                }
            }

            // CRITICAL FIX #1: Accumulate capacity for ALL days in range to ensure deterministic calculation
            // Working days contribute their capacity (8 hours default), non-working days/holidays/time-off contribute 0
            // This fixes the bug where idle working days were incorrectly excluded from expected capacity
            user.totals.expectedCapacity += capacity;

            // Track anomalies (all can coexist)
            // Track anomalies (all can coexist)
            if (isHoliday) {
                user.totals.holidayCount += 1;
                user.totals.holidayHours += holidayHours;
            }
            if (isTimeOff) {
                user.totals.timeOffCount += 1;
                user.totals.timeOffHours += timeOffHours;
            }

            // Ensure day exists for anomaly tracking
            if (!user.days.has(dateKey)) {
                user.days.set(dateKey, { entries: [], meta: { capacity, isNonWorking, isHoliday, holidayName, holidayProjectId, isTimeOff } });
            } else {
                dayData.meta = { capacity, isNonWorking, isHoliday, holidayName, holidayProjectId, isTimeOff };
            }

            // Sort entries by start time (Tail Attribution)
            dayData.entries.sort((a, b) => (a.timeInterval.start || '').localeCompare(b.timeInterval.start || ''));

            let dailyAccumulator = 0;

            dayData.entries.forEach(entry => {
                const duration = round(calculateDuration(entry));
                const hourlyRate = (entry.hourlyRate?.amount || 0) / 100;
                const isBillable = entry.billable;

                // Classify entry using new helper
                const entryClass = classifyEntryForOvertime(entry);

                let regular = 0;
                let overtime = 0;

                // Handle BREAK entries
                if (entryClass === 'break') {
                    user.totals.breaks += duration;
                    regular = duration;  // Count as worked hours
                    overtime = 0;
                    // Do NOT add to dailyAccumulator (doesn't trigger OT for other entries)
                }
                // Handle PTO entries (HOLIDAY/TIME_OFF) - regardless of billable flag
                else if (entryClass === 'pto') {
                    user.totals.vacationEntryHours += duration;
                    regular = duration;  // Count as worked hours
                    overtime = 0;
                    // Do NOT add to dailyAccumulator (doesn't trigger OT for other entries)
                }
                // Handle WORK entries
                else {
                    // Standard tail attribution logic
                    if (dailyAccumulator >= capacity) {
                        overtime = duration;
                    } else if (round(dailyAccumulator + duration) <= capacity) {
                        regular = duration;
                    } else {
                        // Split entry at capacity threshold
                        regular = round(capacity - dailyAccumulator);
                        overtime = round(duration - regular);
                    }
                    dailyAccumulator += duration;
                }

                // Update User Totals - ALL entry types count toward totals
                // (BREAK and PTO have regular=duration, overtime=0)
                user.totals.regular += regular;
                user.totals.overtime += overtime;
                user.totals.total += duration;

                // Billable breakdown
                if (isBillable) {
                    user.totals.billableWorked += regular;
                    user.totals.billableOT += overtime;
                } else {
                    user.totals.nonBillableWorked += regular;
                    user.totals.nonBillableOT += overtime;
                }

                // Cost Calculation (billable entries contribute to amount)
                const effectiveRate = isBillable ? hourlyRate : 0;
                const baseAmount = duration * effectiveRate;

                let tier1Premium = 0;
                let tier2Premium = 0;
                let tier2EligibleHours = 0;  // Track for per-entry analysis

                if (overtime > 0) {
                    // Tier 1 premium (existing logic)
                    const multiplier = userMultiplier > 0 ? userMultiplier : 1;
                    tier1Premium = overtime * effectiveRate * (multiplier - 1);

                    // Tier 2 premium calculation
                    if (userTier2Threshold >= 0 && userTier2Multiplier > multiplier) {
                        const cumulativeBefore = userCumulativeOT.get(user.userId) || 0;
                        const cumulativeAfter = cumulativeBefore + overtime;

                        // Calculate how many hours exceed the threshold
                        if (cumulativeAfter > userTier2Threshold) {
                            if (cumulativeBefore >= userTier2Threshold) {
                                // All OT hours in this entry are tier 2
                                tier2EligibleHours = overtime;
                            } else {
                                // Only portion beyond threshold is tier 2
                                tier2EligibleHours = cumulativeAfter - userTier2Threshold;
                            }
                        }

                        // Tier 2 premium = additional premium beyond tier 1
                        tier2Premium = tier2EligibleHours * effectiveRate * (userTier2Multiplier - multiplier);
                    }

                    // Update cumulative OT
                    userCumulativeOT.set(user.userId, (userCumulativeOT.get(user.userId) || 0) + overtime);
                }

                const entryPremium = tier1Premium + tier2Premium;

                user.totals.amount += baseAmount + entryPremium;
                user.totals.amountBase += baseAmount;  // Track base cost without OT premium
                user.totals.otPremium += tier1Premium;          // Keep as Tier 1 only
                user.totals.otPremiumTier2 += tier2Premium;     // Track Tier 2 separately

                // Attach analysis to ALL entries
                const tags = [];
                if (isHoliday) tags.push('HOLIDAY');
                if (isNonWorking) tags.push('OFF-DAY');
                if (isTimeOff) tags.push('TIME-OFF');

                // Calculate per-entry money components
                const regularAmount = regular * effectiveRate;
                const overtimeAmountBase = overtime * effectiveRate;

                // Calculate effective overtime rate (only meaningful when overtime > 0)
                const multiplier = userMultiplier > 0 ? userMultiplier : 1;
                let effectiveOvertimeRate = effectiveRate;
                if (overtime > 0) {
                    // Weighted average rate including tier2 if applicable
                    const tier1Hours = overtime - tier2EligibleHours;
                    const tier1Rate = effectiveRate * multiplier;

                    if (tier2EligibleHours > 0) {
                        // Has tier2 component - calculate weighted average
                        const tier2Rate = effectiveRate * userTier2Multiplier;
                        effectiveOvertimeRate = (tier1Hours * tier1Rate + tier2EligibleHours * tier2Rate) / overtime;
                    } else {
                        // Only tier1 - use tier1 rate
                        effectiveOvertimeRate = tier1Rate;
                    }
                }

                entry.analysis = {
                    regular,
                    overtime,
                    isBillable,
                    cost: baseAmount + entryPremium,  // Keep for compatibility
                    tags,

                    // NEW per-entry money fields
                    hourlyRate: effectiveRate,
                    regularRate: effectiveRate,
                    overtimeRate: effectiveOvertimeRate,
                    regularAmount,
                    overtimeAmountBase,
                    tier1Premium,
                    tier2Premium,
                    totalAmountWithOT: regularAmount + overtimeAmountBase + tier1Premium + tier2Premium,
                    totalAmountNoOT: regularAmount + overtimeAmountBase
                };
            });
        });
    });

    return Array.from(usersMap.values());
}
