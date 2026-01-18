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

import { IsoUtils, round, parseIsoDuration } from './utils.js';
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
 * Determines the effective daily capacity and anomaly status for a user on a specific date.
 * 
 * Precedence Order:
 * 1. User Override (Manual UI input)
 * 2. Member Profile (API `workCapacity`)
 * 3. Global Default (Config `dailyThreshold`)
 * 
 * Also checks for Holidays and Time Off if enabled in config.
 * 
 * @param {string} dateKey - ISO date string YYYY-MM-DD.
 * @param {string} userId - ID of the user.
 * @param {Object} storeRef - Reference to the global state store containing profiles/holidays/config.
 * @returns {Object} Result object.
 * @property {number} capacity - The calculated capacity in hours.
 * @property {boolean} isNonWorking - True if it's a non-working day per profile.
 * @property {boolean} isHoliday - True if it's a holiday.
 * @property {string|null} holidayName - Name of the holiday if applicable.
 * @property {boolean} isTimeOff - True if user has approved time off.
 */
function getEffectiveCapacity(dateKey, userId, storeRef) {
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

    // 1. Determine Base Capacity: Override > Profile > Global Default
    let capacity = calcParams.dailyThreshold;
    if (userOverride.capacity !== undefined && userOverride.capacity !== '') {
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
    if (config.applyHolidays && userHolidays?.has(dateKey)) {
        const holiday = userHolidays.get(dateKey);
        isHoliday = true;
        holidayName = holiday.name || 'Holiday';
        capacity = 0; // Holiday has 0 capacity
    }

    // 4. Time Off (reduce capacity) - can coexist with holiday (though redundant capacity-wise)
    // Only process Time Off if it is NOT already a full-day holiday to avoid double counting "days off" in stats
    let timeOffHours = 0;
    if (config.applyTimeOff && userTimeOff?.has(dateKey) && !isHoliday) {
        const toInfo = userTimeOff.get(dateKey);
        isTimeOff = true;

        if (toInfo.isFullDay) {
            timeOffHours = baseCapacity; // Lost full day capacity
            capacity = 0;
        } else if (toInfo.hours > 0) {
            timeOffHours = toInfo.hours;
            capacity = Math.max(0, capacity - toInfo.hours);
        }
    }

    // Determine Holiday Hours (if holiday, it takes the full base capacity or remaining capacity?)
    // Usually holiday replaces the full working day.
    let holidayHours = 0;
    if (isHoliday) {
        holidayHours = baseCapacity;
    }

    return { capacity, baseCapacity, isNonWorking, isHoliday, holidayName, holidayProjectId: holiday?.projectId, isTimeOff, holidayHours, timeOffHours };
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
                otPremium: 0,
                expectedCapacity: 0,
                holidayCount: 0,
                timeOffCount: 0,
                holidayHours: 0, // NEW: Track hours for Holidays
                timeOffHours: 0  // NEW: Track hours for Time Off
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
                totals: { regular: 0, overtime: 0, total: 0, breaks: 0, billableWorked: 0, nonBillableWorked: 0, billableOT: 0, nonBillableOT: 0, amount: 0, otPremium: 0, expectedCapacity: 0, holidayCount: 0, timeOffCount: 0 }
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

    // 3. Process each user for each day in range
    usersMap.forEach(user => {
        const userMultiplier = parseFloat(overrides[user.userId]?.multiplier || calcParams.overtimeMultiplier);

        // Iterate over the FULL date range, not just days with entries
        const daysToProcess = allDateKeys.length > 0 ? allDateKeys : Array.from(user.days.keys()).sort();

        daysToProcess.forEach(dateKey => {
            const dayData = user.days.get(dateKey) || { entries: [] };
            const { capacity, isNonWorking, isHoliday, holidayName, isTimeOff } = getEffectiveCapacity(dateKey, user.userId, storeRef);

            // Always add capacity for the range (even if no entries)
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
                user.days.set(dateKey, { entries: [], meta: { capacity, isNonWorking, isHoliday, holidayName, isTimeOff } });
            } else {
                dayData.meta = { capacity, isNonWorking, isHoliday, holidayName, isTimeOff };
            }

            // Sort entries by start time (Tail Attribution)
            dayData.entries.sort((a, b) => (a.timeInterval.start || '').localeCompare(b.timeInterval.start || ''));

            let dailyAccumulator = 0;

            dayData.entries.forEach(entry => {
                // FILTER: Ignore time entries that are purely for Holiday/Time Off accounting
                // to prevent them from being counted as Work/Overtime.
                // 1. Holiday Entries: Check if project matches the Holiday's project ID
                const { holidayProjectId } = dayData.meta;
                if (isHoliday && holidayProjectId && entry.projectId === holidayProjectId) {
                    return; // Skip this entry
                }

                const duration = round(calculateDuration(entry));
                const hourlyRate = (entry.hourlyRate?.amount || 0) / 100;
                const isBreak = entry.type === 'BREAK';
                const isBillable = entry.billable;

                let regular = 0;
                let overtime = 0;

                if (isBreak) {
                    user.totals.breaks += duration;
                } else {
                    if (dailyAccumulator >= capacity) {
                        overtime = duration; // Already over capacity
                    } else if (round(dailyAccumulator + duration) <= capacity) {
                        regular = duration; // Fits within capacity
                    } else {
                        // Spans the threshold
                        regular = round(capacity - dailyAccumulator);
                        overtime = round(duration - regular);
                    }
                    dailyAccumulator = round(dailyAccumulator + duration);
                }

                // Billable breakdown
                if (!isBreak) {
                    if (isBillable) {
                        user.totals.billableWorked += regular;
                        user.totals.billableOT += overtime;
                    } else {
                        user.totals.nonBillableWorked += regular;
                        user.totals.nonBillableOT += overtime;
                    }
                }

                // Costs
                const baseCost = (regular + overtime) * hourlyRate;
                const premiumCost = overtime * hourlyRate * (userMultiplier - 1);

                // Enhance Entry object for UI
                const tags = [];
                if (isHoliday) tags.push('HOLIDAY');
                if (isNonWorking) tags.push('OFF-DAY');
                if (isTimeOff) tags.push('TIME-OFF');

                entry.analysis = {
                    regular,
                    overtime,
                    isBillable,
                    isBreak,
                    totalCost: baseCost + premiumCost,
                    tags
                };

                // Aggregates
                if (!isBreak) {
                    user.totals.total += duration;
                    user.totals.regular += regular;
                    user.totals.overtime += overtime;
                    user.totals.amount += baseCost + premiumCost;
                    user.totals.otPremium += premiumCost;
                }
            });
        });
    });

    return Array.from(usersMap.values());
}
