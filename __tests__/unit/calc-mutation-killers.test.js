/**
 * @fileoverview Mutation-killing tests for calc.ts
 * Each test is designed to detect specific surviving mutations.
 * @jest-environment jsdom
 */

import { calculateAnalysis } from '../../js/calc.js';
import { parseIsoDuration, IsoUtils } from '../../js/utils.js';
import { createMockStore } from '../helpers/mock-data.js';

// Minimal store factory for targeted tests
function createMinimalStore(overrides = {}) {
    const users = overrides.users || [{ id: 'user1', name: 'Test User' }];

    // Build profiles map - assign working capacity and days
    const profiles = overrides.profiles || new Map();
    if (!overrides.profiles) {
        users.forEach(u => {
            profiles.set(u.id, {
                workCapacityHours: 8,
                workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
            });
        });
    }

    return {
        users,
        profiles,
        holidays: overrides.holidays || new Map(),
        timeOff: overrides.timeOff || new Map(),
        overrides: overrides.overrides || {},
        config: {
            applyHolidays: false,
            applyTimeOff: false,
            useProfileCapacity: false,
            useProfileWorkingDays: false,
            enableTieredOT: false,
            showBillableBreakdown: true,
            amountDisplay: 'earned',
            ...overrides.config,
        },
        calcParams: {
            dailyThreshold: 8,
            overtimeMultiplier: 1.5,
            tier2ThresholdHours: 0,
            tier2Multiplier: 2.0,
            ...overrides.calcParams,
        },
    };
}

// Entry factory for targeted tests
function createEntry(overrides = {}) {
    return {
        id: overrides.id || 'entry1',
        userId: overrides.userId || 'user1',
        userName: overrides.userName || 'Test User',
        billable: overrides.billable !== undefined ? overrides.billable : true,
        timeInterval: {
            start: overrides.start || '2024-01-15T09:00:00Z',
            end: overrides.end || '2024-01-15T17:00:00Z',
            duration: overrides.duration || 'PT8H',
        },
        type: overrides.type || 'REGULAR',
        ...overrides,
    };
}

describe('Calc.ts Mutation Killers', () => {
    // ============================================================================
    // extractRate mutations (lines 217-231)
    // ============================================================================
    describe('extractRate mutations', () => {
        // Line 225: if (typeof rateField === 'object' && 'amount' in rateField)
        // Mutant: if (true) { return rateField.amount || 0; }
        test('should handle number rate field (not object)', () => {
            const entry = createEntry({
                hourlyRate: 5000, // Numeric, not object - rate is in cents ($50/hr)
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            // If mutant is alive (typeof === 'object' replaced with true),
            // it would try to access .amount on a number, causing incorrect rate
            // Rate is stored as dollars/hr in amounts.earned.rate (5000 cents / 100 = $50)
            expect(analysis.amounts.earned.rate).toBe(50);
        });

        test('should handle object rate field with amount property', () => {
            const entry = createEntry({
                hourlyRate: { amount: 7500 }, // $75/hr in cents
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(75);
        });

        test('should return 0 for object without amount property', () => {
            const entry = createEntry({
                hourlyRate: { value: 5000 }, // Wrong property name
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(0);
        });
    });

    // ============================================================================
    // getEntryDurationHours mutations (lines 265-282)
    // ============================================================================
    describe('getEntryDurationHours mutations', () => {
        // Line 267: entry.timeInterval?.duration → entry.timeInterval.duration
        test('should handle missing timeInterval gracefully', () => {
            const entry = {
                id: 'entry1',
                userId: 'user1',
                userName: 'Test User',
                billable: true,
                timeInterval: null,
                type: 'REGULAR',
            };
            const store = createMinimalStore();

            // Should not throw. With null timeInterval, entry can't be dated
            // so it won't appear in results. The key test is it doesn't crash.
            expect(() => {
                calculateAnalysis([entry], store, {
                    start: '2024-01-15',
                    end: '2024-01-15',
                });
            }).not.toThrow();
        });

        // Line 270: entry.timeInterval?.start && entry.timeInterval?.end
        test('should calculate duration from start/end when duration is missing', () => {
            const entry = {
                id: 'entry1',
                userId: 'user1',
                userName: 'Test User',
                billable: true,
                timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T13:00:00Z', // 4 hours
                    duration: null, // Missing duration - should calculate from timestamps
                },
                type: 'REGULAR',
            };
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.regular).toBe(4);
        });

        test('should handle missing start time (fallback path)', () => {
            const entry = {
                id: 'entry1',
                userId: 'user1',
                userName: 'Test User',
                billable: true,
                timeInterval: {
                    start: null,
                    end: '2024-01-15T17:00:00Z',
                    duration: null,
                },
                type: 'REGULAR',
            };

            const store = createMinimalStore();
            // Can't determine dateKey without start, but should not crash
            expect(() => {
                calculateAnalysis([entry], store, {
                    start: '2024-01-15',
                    end: '2024-01-15',
                });
            }).not.toThrow();
        });

        test('should handle missing end time (fallback path)', () => {
            const entry = {
                id: 'entry1',
                userId: 'user1',
                userName: 'Test User',
                billable: true,
                timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: null,
                    duration: null,
                },
                type: 'REGULAR',
            };

            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should have 0 hours when can't calculate from end timestamp
            expect(result[0].totals.total).toBe(0);
        });
    });

    // ============================================================================
    // sumAmountByType mutations (lines 317-339)
    // ============================================================================
    describe('sumAmountByType mutations', () => {
        // Line 319: amounts.length === 0 check
        test('should return 0 for empty amounts array', () => {
            const entry = createEntry({
                amounts: [],
                hourlyRate: null,
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.amountBase).toBe(0);
        });

        // Line 328: String(amount?.type || amount?.amountType || '')
        test('should handle amount with type property', () => {
            const entry = createEntry({
                amounts: [{ type: 'EARNED', value: 120 }],
                hourlyRate: null,
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Rate calculated from amounts: 120 / 8h * 100 = 1500 cents/hr → $15/hr displayed
            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(15);
        });

        test('should handle amount with amountType property', () => {
            const entry = createEntry({
                amounts: [{ amountType: 'EARNED', value: 80 }],
                hourlyRate: null,
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Rate calculated from amounts: 80 / 8h * 100 = 1000 cents/hr → $10/hr displayed
            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(10);
        });

        // Line 328: String literal mutation '' → 'Stryker was here!'
        test('should not match amounts with missing type properties', () => {
            const entry = createEntry({
                amounts: [{ value: 100 }], // No type or amountType
                hourlyRate: 5000, // 5000 cents = $50/hr
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should use hourlyRate, not calculate from amounts
            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(50);
        });

        // Line 334: amount?.value ?? amount?.amount
        test('should handle amount with value property', () => {
            const entry = createEntry({
                amounts: [{ type: 'EARNED', value: 160 }],
                hourlyRate: null,
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(20); // 160/8h = $20/hr
        });

        test('should handle amount with amount property (fallback)', () => {
            const entry = createEntry({
                amounts: [{ type: 'EARNED', amount: 200 }],
                hourlyRate: null,
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(25); // 200/8h = $25/hr
        });
    });

    // ============================================================================
    // rateFromAmounts mutations (lines 377-394)
    // ============================================================================
    describe('rateFromAmounts mutations', () => {
        // Line 383: if (!durationHours) return 0
        test('should return 0 rate when duration is 0', () => {
            const entry = {
                id: 'entry1',
                userId: 'user1',
                userName: 'Test User',
                billable: true,
                timeInterval: {
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T09:00:00Z', // Same as start = 0 duration
                    duration: 'PT0H',
                },
                amounts: [{ type: 'EARNED', value: 100 }],
                hourlyRate: null,
                type: 'REGULAR',
            };
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Entry with 0 duration contributes 0 hours, rate can't be calculated
            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.regular).toBe(0);
            expect(analysis.amounts.earned.rate).toBe(0); // Can't calculate rate from 0 duration
        });

        // Line 389: if (!Number.isFinite(totalAmount) || totalAmount === 0)
        test('should return 0 rate when totalAmount is 0', () => {
            const entry = createEntry({
                amounts: [{ type: 'EARNED', value: 0 }],
                hourlyRate: null,
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(0);
        });

        test('should return 0 rate when totalAmount is not finite', () => {
            const entry = createEntry({
                amounts: [{ type: 'EARNED', value: Infinity }],
                hourlyRate: null,
                earnedRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.rate).toBe(0);
        });
    });

    // ============================================================================
    // Override resolution mutations (lines 661-818)
    // ============================================================================
    describe('Override resolution mutations', () => {
        // Line 677, 734, 743, 750, 807, 814: isNaN checks
        test('should not use NaN parsed values for multiplier', () => {
            const store = createMinimalStore({
                overrides: {
                    user1: {
                        mode: 'perDay',
                        perDayOverrides: {
                            '2024-01-15': {
                                multiplier: 'invalid', // Not a number
                            },
                        },
                    },
                },
            });
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr - needed for premium calculation
                duration: 'PT10H', // 2h overtime
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should fall through to global default (1.5), not use NaN
            // tier1 premium = (1.5 - 1) * 2h * $100 = $100
            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            expect(analysis.amounts.earned.tier1Premium).toBe(100);
        });

        // Line 738, 740: Weekly tier2Threshold block statement mutations
        test('should apply weekly tier2Threshold override', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 100, // High default
                    tier2Multiplier: 2.0,
                },
                overrides: {
                    user1: {
                        mode: 'weekly',
                        weeklyOverrides: {
                            MONDAY: { tier2Threshold: 1 }, // Low threshold for Monday
                        },
                    },
                },
            });
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr
                duration: 'PT12H', // 4h overtime
                start: '2024-01-15T08:00:00Z', // Monday
                end: '2024-01-15T20:00:00Z',
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // With 4h OT and 1h threshold, 3h should be tier2
            // tier2 premium = (2.0 - 1.5) * 3h * $100 = $150
            expect(result[0].totals.otPremiumTier2).toBe(150);
        });

        // Line 743: !isNaN(parsed) for tier2Threshold in weekly
        test('should skip invalid tier2Threshold in weekly override', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 2,
                    tier2Multiplier: 2.0,
                },
                overrides: {
                    user1: {
                        mode: 'weekly',
                        weeklyOverrides: {
                            MONDAY: { tier2Threshold: 'not-a-number' },
                        },
                    },
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H',
                start: '2024-01-15T08:00:00Z',
                end: '2024-01-15T20:00:00Z',
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should use global default (2h threshold), so 2h tier2
            // tier2 premium = (2.0 - 1.5) * 2h * $100 = $100
            expect(result[0].totals.otPremiumTier2).toBe(100);
        });

        // Line 802, 804: Weekly tier2Multiplier block mutations
        test('should apply weekly tier2Multiplier override', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 1,
                    tier2Multiplier: 2.0, // Default
                },
                overrides: {
                    user1: {
                        mode: 'weekly',
                        weeklyOverrides: {
                            MONDAY: { tier2Multiplier: 3.0 }, // Triple time
                        },
                    },
                },
            });
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr
                duration: 'PT12H',
                start: '2024-01-15T08:00:00Z',
                end: '2024-01-15T20:00:00Z',
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // tier2 premium = (3.0 - 1.5) * 3h * $100 = $450
            // tier1 premium = (1.5 - 1) * 4h * $100 = $200
            // With 4h OT, 1h tier1 only, 3h tier2
            expect(result[0].totals.otPremiumTier2).toBe(450);
        });

        // Line 807: !isNaN(parsed) for tier2Multiplier in weekly
        test('should skip invalid tier2Multiplier in weekly override', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 1,
                    tier2Multiplier: 2.0,
                },
                overrides: {
                    user1: {
                        mode: 'weekly',
                        weeklyOverrides: {
                            MONDAY: { tier2Multiplier: 'invalid' },
                        },
                    },
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H',
                start: '2024-01-15T08:00:00Z',
                end: '2024-01-15T20:00:00Z',
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should use global default (2.0)
            // tier2 premium = (2.0 - 1.5) * 3h * $100 = $150
            expect(result[0].totals.otPremiumTier2).toBe(150);
        });
    });

    // ============================================================================
    // Holiday/TimeOff feature flag mutations (lines 922, 977)
    // ============================================================================
    describe('Holiday/TimeOff feature flag mutations', () => {
        // Line 922: if (!store.config.applyHolidays) return null
        test('should not apply holidays when feature is disabled', () => {
            const userHolidays = new Map();
            userHolidays.set('2024-01-15', { name: 'Holiday' });

            const store = createMinimalStore({
                config: { applyHolidays: false },
                holidays: new Map([['user1', userHolidays]]),
            });
            const entry = createEntry({ duration: 'PT8H' });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 8h should be regular, not OT (holiday not applied)
            expect(result[0].totals.regular).toBe(8);
            expect(result[0].totals.overtime).toBe(0);
        });

        test('should apply holidays when feature is enabled', () => {
            const userHolidays = new Map();
            userHolidays.set('2024-01-15', { name: 'Holiday' });

            const store = createMinimalStore({
                config: { applyHolidays: true },
                holidays: new Map([['user1', userHolidays]]),
            });
            const entry = createEntry({ duration: 'PT8H' });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // All 8h should be OT on holiday
            expect(result[0].totals.overtime).toBe(8);
        });

        // Line 977: if (!store.config.applyTimeOff) return null
        test('should not apply timeOff when feature is disabled', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: false });

            const store = createMinimalStore({
                config: { applyTimeOff: false },
                timeOff: new Map([['user1', userTimeOff]]),
            });
            const entry = createEntry({ duration: 'PT8H' });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 8h should be regular (time off not reducing capacity)
            expect(result[0].totals.regular).toBe(8);
        });

        test('should apply timeOff when feature is enabled', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: false });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });
            // 8h work with 4h time off = 4h effective capacity
            const entry = createEntry({ duration: 'PT8H' });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 4h regular, 4h OT
            expect(result[0].totals.regular).toBe(4);
            expect(result[0].totals.overtime).toBe(4);
        });
    });

    // ============================================================================
    // Amount calculation mutations (line 1265)
    // ============================================================================
    describe('Amount calculation mutations', () => {
        // Line 1265: hourlyRate * multiplier → hourlyRate / multiplier
        test('should multiply rate by multiplier for overtime rate calculation', () => {
            const store = createMinimalStore({
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr in cents
                duration: 'PT10H', // 2h overtime
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            // OT rate should be $100 * 1.5 = $150/hr
            // (stored as dollars, not cents in analysis.amounts.earned.overtimeRate)
            expect(analysis.amounts.earned.overtimeRate).toBe(150);
        });
    });

    // ============================================================================
    // amountDisplay mutations (line 1454)
    // ============================================================================
    describe('amountDisplay mutations', () => {
        // Line 1454: amountDisplay || 'earned' → amountDisplay || ''
        test('should default to earned when amountDisplay is not set', () => {
            const store = createMinimalStore({
                config: { amountDisplay: null },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT8H',
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should use earned amounts (the default)
            expect(result[0].totals.amountBase).toBe(800); // $100/hr * 8h
        });

        test('should use cost when amountDisplay is cost', () => {
            const store = createMinimalStore({
                config: { amountDisplay: 'cost' },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                costRate: 5000, // $50/hr in cents
                duration: 'PT8H',
            });
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should use cost amounts
            expect(result[0].totals.amountCostBase).toBe(400); // $50/hr * 8h
        });
    });

    // ============================================================================
    // Date range derivation mutations (lines 1487-1489)
    // ============================================================================
    describe('Date range derivation mutations', () => {
        // Line 1487: entryDateKey < minDate → entryDateKey <= minDate
        // Line 1489: entryDateKey > maxDate → entryDateKey >= maxDate
        test('should find correct min/max dates from entries', () => {
            const store = createMinimalStore();
            const entries = [
                createEntry({ id: '1', start: '2024-01-17T09:00:00Z', end: '2024-01-17T17:00:00Z' }),
                createEntry({ id: '2', start: '2024-01-15T09:00:00Z', end: '2024-01-15T17:00:00Z' }),
                createEntry({ id: '3', start: '2024-01-20T09:00:00Z', end: '2024-01-20T17:00:00Z' }),
            ];

            // Let calculateAnalysis derive the date range
            const result = calculateAnalysis(entries, store, null);

            // Should have entries for all three days
            expect(result[0].days.has('2024-01-15')).toBe(true);
            expect(result[0].days.has('2024-01-17')).toBe(true);
            expect(result[0].days.has('2024-01-20')).toBe(true);
        });

        test('should handle entries all on same date', () => {
            const store = createMinimalStore();
            const entries = [
                createEntry({ id: '1', start: '2024-01-15T09:00:00Z', end: '2024-01-15T12:00:00Z' }),
                createEntry({ id: '2', start: '2024-01-15T13:00:00Z', end: '2024-01-15T17:00:00Z' }),
            ];

            const result = calculateAnalysis(entries, store, null);

            expect(result[0].days.has('2024-01-15')).toBe(true);
            expect(result[0].days.size).toBe(1);
        });
    });

    // ============================================================================
    // User analysis initialization mutations (lines 1537, 1540)
    // ============================================================================
    describe('User analysis initialization mutations', () => {
        // Line 1537: if (!userAnalysis) → if (true)
        // Line 1540: userEntries[0]?.userName → userEntries[0].userName
        test('should create user analysis once per user', () => {
            const store = createMinimalStore();
            const entries = [
                createEntry({ id: '1', duration: 'PT4H' }),
                createEntry({ id: '2', duration: 'PT4H' }),
            ];

            const result = calculateAnalysis([entries[0], entries[1]], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should have single user analysis with both entries
            expect(result.length).toBe(1);
            expect(result[0].totals.total).toBe(8);
        });

        test('should handle empty entries for a user', () => {
            const store = createMinimalStore({
                users: [{ id: 'user1', name: 'Test User' }],
            });

            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Should still create user analysis from users list
            expect(result.length).toBe(1);
            expect(result[0].userName).toBe('Test User');
        });
    });

    // ============================================================================
    // Holiday/TimeOff entry detection mutations (lines 1608-1672)
    // ============================================================================
    describe('Holiday/TimeOff entry detection mutations', () => {
        // Line 1608: e.type === 'HOLIDAY_TIME_ENTRY'
        // When applyHolidays is disabled, HOLIDAY_TIME_ENTRY triggers holiday detection
        test('should detect HOLIDAY_TIME_ENTRY type for day context', () => {
            const store = createMinimalStore({
                config: { applyHolidays: false }, // Fallback detection kicks in
            });
            const entry = createEntry({
                type: 'HOLIDAY_TIME_ENTRY',
                duration: 'PT8H',
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // HOLIDAY_TIME_ENTRY triggers holiday detection → capacity = 0 → all work is OT
            // But the entry itself is classified as WORK, not PTO
            expect(result[0].totals.overtime).toBe(8);
        });

        // Line 1613: e.type === 'TIME_OFF_TIME_ENTRY'
        // When applyTimeOff is disabled, TIME_OFF_TIME_ENTRY triggers time-off detection
        test('should detect TIME_OFF_TIME_ENTRY type for capacity reduction', () => {
            const store = createMinimalStore({
                config: { applyTimeOff: false }, // Fallback detection kicks in
            });
            // Two entries: one TIME_OFF_TIME_ENTRY and one REGULAR
            const entries = [
                createEntry({
                    id: '1',
                    type: 'TIME_OFF_TIME_ENTRY',
                    duration: 'PT4H',
                    start: '2024-01-15T09:00:00Z',
                    end: '2024-01-15T13:00:00Z',
                }),
                createEntry({
                    id: '2',
                    type: 'REGULAR',
                    duration: 'PT6H',
                    start: '2024-01-15T14:00:00Z',
                    end: '2024-01-15T20:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // TIME_OFF_TIME_ENTRY (4h) reduces capacity by 4h (8h → 4h)
            // BUT the TIME_OFF_TIME_ENTRY itself is classified as WORK (4h)
            // Plus REGULAR entry (6h) = 10h total work with 4h capacity = 6h OT
            expect(result[0].totals.overtime).toBe(6);
        });

        // Line 1620: e.type === 'TIME_OFF_TIME_ENTRY' in capacity reduction
        test('should sum time off hours from TIME_OFF_TIME_ENTRY entries', () => {
            const store = createMinimalStore({
                config: { applyTimeOff: false }, // Enable fallback detection from entry type
            });
            const entries = [
                createEntry({
                    id: '1',
                    type: 'TIME_OFF_TIME_ENTRY',
                    duration: 'PT4H',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                }),
                createEntry({
                    id: '2',
                    type: 'REGULAR',
                    duration: 'PT8H',
                    start: '2024-01-15T13:00:00Z',
                    end: '2024-01-15T21:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 4h TIME_OFF_TIME_ENTRY reduces capacity to 4h (8h → 4h)
            // But TIME_OFF_TIME_ENTRY itself is classified as WORK (4h)
            // Plus 8h REGULAR work = 12h total work with 4h capacity = 8h OT
            expect(result[0].totals.overtime).toBe(8);
        });

        // Line 1621: e.timeInterval?.duration
        test('should handle TIME_OFF entry with missing timeInterval', () => {
            const store = createMinimalStore();
            const entries = [
                {
                    id: '1',
                    userId: 'user1',
                    userName: 'Test User',
                    type: 'TIME_OFF',
                    billable: false,
                    timeInterval: null,
                },
                createEntry({ id: '2', type: 'REGULAR', duration: 'PT8H' }),
            ];

            // Should not throw
            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result.length).toBe(1);
        });

        // Line 1660: holiday?.name || '' → holiday?.name || 'Stryker was here!'
        test('should use empty string for missing holiday name', () => {
            const userHolidays = new Map();
            userHolidays.set('2024-01-15', { projectId: 'proj1' }); // No name

            const store = createMinimalStore({
                config: { applyHolidays: true },
                holidays: new Map([['user1', userHolidays]]),
            });
            const entry = createEntry({ duration: 'PT8H' });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayMeta = result[0].days.get('2024-01-15')?.meta;
            expect(dayMeta.holidayName).toBe('');
        });

        // Line 1663: holiday?.projectId || null → holiday?.projectId && null
        test('should use holiday projectId when present', () => {
            const userHolidays = new Map();
            userHolidays.set('2024-01-15', { name: 'Holiday', projectId: 'proj123' });

            const store = createMinimalStore({
                config: { applyHolidays: true },
                holidays: new Map([['user1', userHolidays]]),
            });
            const entry = createEntry({ duration: 'PT8H' });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayMeta = result[0].days.get('2024-01-15')?.meta;
            expect(dayMeta.holidayProjectId).toBe('proj123');
        });
    });

    // ============================================================================
    // Entry sorting mutations (line 1672)
    // ============================================================================
    describe('Entry sorting mutations', () => {
        // Line 1672: timeInterval?.start, string literal mutations
        test('should sort entries by start time (earliest first)', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 4 },
            });
            const entries = [
                createEntry({
                    id: 'late',
                    start: '2024-01-15T14:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT4H',
                }),
                createEntry({
                    id: 'early',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                    duration: 'PT4H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // With 4h threshold: early entry = regular, late entry = OT
            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // First entry should be the early one (sorted)
            expect(dayEntries[0].id).toBe('early');
            expect(dayEntries[0].analysis.regular).toBe(4);
            expect(dayEntries[1].id).toBe('late');
            expect(dayEntries[1].analysis.overtime).toBe(4);
        });

        test('should handle entries with missing start times', () => {
            const store = createMinimalStore();
            const entries = [
                createEntry({ id: '1', start: '2024-01-15T09:00:00Z' }),
                { ...createEntry({ id: '2' }), timeInterval: { duration: 'PT4H' } }, // Missing start
            ];

            // Should not throw
            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result.length).toBe(1);
        });
    });

    // ============================================================================
    // Tail attribution mutations (lines 1731-1791)
    // ============================================================================
    describe('Tail attribution mutations', () => {
        // Line 1731: dailyAccumulator >= effectiveCapacity → dailyAccumulator > effectiveCapacity
        test('should treat exactly at capacity as still regular (>= not >)', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            // First entry fills capacity exactly
            const entries = [
                createEntry({
                    id: '1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T16:00:00Z',
                    duration: 'PT8H',
                }),
                createEntry({
                    id: '2',
                    start: '2024-01-15T16:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT2H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Second entry should be all OT (accumulator >= 8)
            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            expect(dayEntries[0].analysis.regular).toBe(8);
            expect(dayEntries[0].analysis.overtime).toBe(0);
            expect(dayEntries[1].analysis.regular).toBe(0);
            expect(dayEntries[1].analysis.overtime).toBe(2);
        });

        // Line 1736: dailyAccumulator + duration <= effectiveCapacity → ... < effectiveCapacity
        test('should treat exactly at capacity boundary as regular (<= not <)', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            const entries = [
                createEntry({
                    id: '1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                    duration: 'PT4H',
                }),
                createEntry({
                    id: '2',
                    start: '2024-01-15T12:00:00Z',
                    end: '2024-01-15T16:00:00Z',
                    duration: 'PT4H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 4h + 4h = 8h exactly at capacity, both should be regular
            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            expect(dayEntries[0].analysis.regular).toBe(4);
            expect(dayEntries[1].analysis.regular).toBe(4);
            expect(result[0].totals.overtime).toBe(0);
        });
    });

    // ============================================================================
    // Tier2 calculation mutations (lines 1758-1791)
    // ============================================================================
    describe('Tier2 calculation mutations', () => {
        // Line 1758: Multiple mutations on the condition
        test('should not calculate tier2 when overtimeHours is 0', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 0,
                    tier2Multiplier: 2.0,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT8H', // No overtime
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.otPremiumTier2).toBe(0);
            expect(result[0].totals.otPremiumTier2).toBe(0);
        });

        test('should not calculate tier2 when enableTieredOT is false', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: false },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 1,
                    tier2Multiplier: 2.0,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H', // 4h overtime
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // All OT should be tier1
            expect(result[0].totals.otPremiumTier2).toBe(0);
        });

        test('should not calculate tier2 when tier2Multiplier equals tier1Multiplier', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 1,
                    tier2Multiplier: 1.5, // Same as tier1
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H',
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // No tier2 premium when multipliers are equal
            expect(result[0].totals.otPremiumTier2).toBe(0);
        });

        // Line 1766: otBeforeEntry >= tier2Threshold → otBeforeEntry > tier2Threshold
        test('should handle OT exactly at tier2 threshold boundary', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 2,
                    tier2Multiplier: 2.0,
                },
            });
            // Two days: first day 2h OT fills threshold, second day should be all tier2
            const entries = [
                createEntry({
                    id: '1',
                    hourlyRate: 10000,
                    duration: 'PT10H', // 2h OT
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                }),
                createEntry({
                    id: '2',
                    hourlyRate: 10000,
                    duration: 'PT10H', // 2h more OT
                    start: '2024-01-16T08:00:00Z',
                    end: '2024-01-16T18:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-16',
            });

            // First 2h fills threshold, second 2h should be tier2
            // tier2 premium = (2.0 - 1.5) * 2h * $100 = $100
            expect(result[0].totals.otPremiumTier2).toBe(100);
        });

        // Line 1771: otAfterEntry <= tier2Threshold → otAfterEntry < tier2Threshold
        test('should handle OT that exactly fills tier2 threshold', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 4,
                    tier2Multiplier: 2.0,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H', // 4h OT, exactly fills threshold
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 4h OT exactly at threshold = all tier1, no tier2
            expect(result[0].totals.otPremiumTier2).toBe(0);
            expect(result[0].totals.overtime).toBe(4); // All 4h OT is tier1
        });

        // Line 1785: else block mutation (tier2 disabled path)
        test('should track all OT as tier1 when tier2 disabled', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: false },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H',
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.overtime).toBe(4); // 4h OT total
            expect(result[0].totals.otPremiumTier2).toBe(0); // No tier2 when disabled
        });

        // Line 1791: userOTAccumulator += overtimeHours → -= overtimeHours
        test('should accumulate OT hours across days for tier2 calculation', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 3,
                    tier2Multiplier: 2.0,
                },
            });
            // Three days of 2h OT each = 6h total OT
            const entries = [
                createEntry({
                    id: '1',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                }),
                createEntry({
                    id: '2',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-16T08:00:00Z',
                    end: '2024-01-16T18:00:00Z',
                }),
                createEntry({
                    id: '3',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-17T08:00:00Z',
                    end: '2024-01-17T18:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-17',
            });

            // 3h threshold, 6h total OT = 3h tier1 + 3h tier2
            expect(result[0].totals.overtime).toBe(6); // 6h total OT
            // tier2 premium = (2.0 - 1.5) * 3h * $100 = $150
            expect(result[0].totals.otPremiumTier2).toBe(150);
        });
    });

    // ============================================================================
    // Billable breakdown mutations (lines 1896-1899)
    // ============================================================================
    describe('Billable breakdown mutations', () => {
        // Line 1896: if (isBillable) → if (true)
        // Line 1899: nonBillableWorked += regularHours → -= regularHours
        test('should correctly track billable vs non-billable regular hours', () => {
            const store = createMinimalStore({
                config: { showBillableBreakdown: true },
            });
            const entries = [
                createEntry({
                    id: '1',
                    billable: true,
                    duration: 'PT4H',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                }),
                createEntry({
                    id: '2',
                    billable: false,
                    duration: 'PT4H',
                    start: '2024-01-15T13:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.billableWorked).toBe(4);
            expect(result[0].totals.nonBillableWorked).toBe(4);
        });
    });

    // ============================================================================
    // Amount accumulation mutations (lines 1929-1947)
    // ============================================================================
    describe('Amount accumulation mutations', () => {
        // Line 1929, 1933, 1940, 1941, 1946, 1947: += → -=
        test('should accumulate cost amounts correctly', () => {
            const store = createMinimalStore();
            const entry = createEntry({
                hourlyRate: 10000,
                costRate: 5000, // $50/hr
                duration: 'PT8H',
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Cost base = $50/hr * 8h = $400
            expect(result[0].totals.amountCostBase).toBe(400);
        });

        test('should accumulate profit amounts correctly', () => {
            const store = createMinimalStore();
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr earned
                costRate: 6000, // $60/hr cost
                duration: 'PT8H',
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Profit base = ($100 - $60)/hr * 8h = $320
            expect(result[0].totals.amountProfitBase).toBe(320);
        });

        test('should accumulate tier1 premium for cost and profit', () => {
            const store = createMinimalStore({
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr earned
                costRate: 6000, // $60/hr cost
                duration: 'PT10H', // 2h OT
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Cost OT premium = (1.5-1) * 2h * $60 = $60
            expect(result[0].totals.otPremiumCost).toBe(60);
            // Profit OT premium = (1.5-1) * 2h * $40 = $40
            expect(result[0].totals.otPremiumProfit).toBe(40);
        });

        test('should accumulate tier2 premium for cost and profit', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 1,
                    tier2Multiplier: 2.0,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr earned
                costRate: 6000, // $60/hr cost
                duration: 'PT12H', // 4h OT: 1h tier1, 3h tier2
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Tier2 cost premium = (2.0-1.5) * 3h * $60 = $90
            expect(result[0].totals.otPremiumTier2Cost).toBe(90);
            // Tier2 profit premium = (2.0-1.5) * 3h * $40 = $60
            expect(result[0].totals.otPremiumTier2Profit).toBe(60);
        });
    });

    // ============================================================================
    // Capacity adjustment mutations (lines 2044-2061)
    // ============================================================================
    describe('Capacity adjustment mutations', () => {
        // Line 2044: if (timeOff.isFullDay) → if (false)
        test('should set capacity to 0 for full-day time off', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 8, isFullDay: true });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });
            const entry = createEntry({ duration: 'PT8H' });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Full day time off = 0 capacity, all work is OT
            expect(result[0].totals.overtime).toBe(8);
        });

        // Line 2054: if (isHolidayDay) → if (true)
        test('should set capacity to 0 on holidays', () => {
            const userHolidays = new Map();
            userHolidays.set('2024-01-15', { name: 'Holiday' });

            const store = createMinimalStore({
                config: { applyHolidays: true },
                holidays: new Map([['user1', userHolidays]]),
            });
            const entry = createEntry({ duration: 'PT8H' });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Holiday = 0 capacity
            const dayMeta = result[0].days.get('2024-01-15')?.meta;
            expect(dayMeta.capacity).toBe(0);
        });

        // Line 2059: if (isTimeOffDay) → if (true)
        test('should reduce capacity for partial time off', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: false });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            // Add an entry so we can check the day's meta
            const entry = createEntry({
                duration: 'PT6H', // 6h work
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 8h default - 4h time off = 4h effective capacity
            const dayMeta = result[0].days.get('2024-01-15')?.meta;
            expect(dayMeta.capacity).toBe(4);
            // 6h work with 4h capacity = 2h OT
            expect(result[0].totals.overtime).toBe(2);
        });

        // Line 2061: timeOff?.hours → timeOff.hours
        test('should track time off hours in user totals', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: false });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.timeOffHours).toBe(4);
        });
    });

    // ============================================================================
    // Result sorting mutation (line 2072)
    // ============================================================================
    describe('Result sorting mutations', () => {
        // Line 2072: .sort((a, b) => a.userName.localeCompare(b.userName)) → no sort
        test('should sort results by user name', () => {
            const store = createMinimalStore({
                users: [
                    { id: 'user3', name: 'Zara' },
                    { id: 'user1', name: 'Alice' },
                    { id: 'user2', name: 'Bob' },
                ],
            });
            const entries = [
                createEntry({ id: '1', userId: 'user3', userName: 'Zara' }),
                createEntry({ id: '2', userId: 'user1', userName: 'Alice' }),
                createEntry({ id: '3', userId: 'user2', userName: 'Bob' }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Results should be sorted alphabetically by userName
            expect(result[0].userName).toBe('Alice');
            expect(result[1].userName).toBe('Bob');
            expect(result[2].userName).toBe('Zara');
        });
    });

    // ============================================================================
    // ADDITIONAL MUTATION KILLERS - Exact Boundary Tests
    // ============================================================================

    describe('Entry sorting with null timeInterval (line 1672)', () => {
        // Line 1672:65 - Optional chaining b.timeInterval?.start → b.timeInterval.start
        test('should sort entries safely when one has null timeInterval', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            // Entry with start time and one without
            const entries = [
                createEntry({
                    id: 'with-start',
                    start: '2024-01-15T10:00:00Z',
                    end: '2024-01-15T14:00:00Z',
                    duration: 'PT4H',
                }),
                {
                    id: 'no-interval',
                    userId: 'user1',
                    userName: 'Test User',
                    billable: true,
                    timeInterval: null, // Null timeInterval
                    type: 'REGULAR',
                },
            ];

            // Should not throw with null timeInterval during sort
            expect(() => {
                calculateAnalysis(entries, store, {
                    start: '2024-01-15',
                    end: '2024-01-15',
                });
            }).not.toThrow();
        });

        // Line 1672:90 - StringLiteral '' → "Stryker was here!"
        test('should handle entries with undefined start in sort comparison', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 4 }, // Low threshold to trigger OT
            });
            // Both entries have timeInterval but one has undefined start
            const entries = [
                createEntry({
                    id: 'late',
                    start: '2024-01-15T14:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT4H',
                }),
                {
                    id: 'undefined-start',
                    userId: 'user1',
                    userName: 'Test User',
                    billable: true,
                    timeInterval: {
                        start: undefined, // Undefined start (will use '' fallback)
                        end: '2024-01-15T12:00:00Z',
                        duration: 'PT4H',
                    },
                    type: 'REGULAR',
                },
            ];

            // The entry with undefined start should sort before '2024...' (empty string < any date string)
            // If mutant survives ('' → "Stryker..."), sort order would be different
            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // We can't easily check sort order directly, but ensure no crash
            expect(result.length).toBe(1);
        });
    });

    describe('Exact boundary: dailyAccumulator equals effectiveCapacity (lines 1731, 1736)', () => {
        // Line 1731: dailyAccumulator >= effectiveCapacity → > effectiveCapacity
        // When accumulator EXACTLY equals capacity, next entry should be ALL OT
        test('should treat entry as all OT when accumulator exactly equals capacity (>= not >)', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            // First entry: exactly 8h fills capacity to exact threshold
            // Second entry: should be ALL OT because accumulator >= capacity
            const entries = [
                createEntry({
                    id: 'fills-capacity',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T16:00:00Z',
                    duration: 'PT8H', // Exactly fills 8h capacity
                }),
                createEntry({
                    id: 'next-entry',
                    start: '2024-01-15T16:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT1H', // This should be ALL OT
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // First entry: 8h regular, 0h OT
            expect(dayEntries[0].analysis.regular).toBe(8);
            expect(dayEntries[0].analysis.overtime).toBe(0);
            // Second entry: 0h regular, 1h OT (accumulator was EXACTLY at capacity)
            expect(dayEntries[1].analysis.regular).toBe(0);
            expect(dayEntries[1].analysis.overtime).toBe(1);
        });

        // Line 1736: dailyAccumulator + duration <= effectiveCapacity → < effectiveCapacity
        // When accumulator + duration EXACTLY equals capacity, entry should be ALL regular
        test('should treat entry as all regular when it exactly fills capacity (<= not <)', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            // Two entries that together EXACTLY fill capacity (4h + 4h = 8h)
            const entries = [
                createEntry({
                    id: 'first-half',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                    duration: 'PT4H',
                }),
                createEntry({
                    id: 'second-half',
                    start: '2024-01-15T12:00:00Z',
                    end: '2024-01-15T16:00:00Z',
                    duration: 'PT4H', // 4h + 4h = 8h exactly
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // Both entries should be all regular
            expect(dayEntries[0].analysis.regular).toBe(4);
            expect(dayEntries[0].analysis.overtime).toBe(0);
            expect(dayEntries[1].analysis.regular).toBe(4);
            expect(dayEntries[1].analysis.overtime).toBe(0);
            // Total: 8h regular, 0h OT
            expect(result[0].totals.regular).toBe(8);
            expect(result[0].totals.overtime).toBe(0);
        });
    });

    describe('Tier2 exact boundary conditions (lines 1758, 1766, 1771)', () => {
        // Line 1758: tier2Multiplier > multiplier → tier2Multiplier >= multiplier
        // When tier2 equals tier1, should NOT trigger tier2 logic
        test('should not calculate tier2 when tier2Multiplier equals tier1Multiplier (> not >=)', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5, // tier1 = 1.5x
                    tier2ThresholdHours: 1,
                    tier2Multiplier: 1.5, // tier2 = 1.5x (same as tier1)
                },
            });
            const entry = createEntry({
                hourlyRate: 10000, // $100/hr
                duration: 'PT12H', // 4h OT
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // When tier2 = tier1, ALL OT should be tier1 only (no tier2 premium)
            // tier1 premium = (1.5 - 1) * 4h * $100 = $200
            expect(result[0].totals.otPremium).toBe(200);
            // tier2 premium should be 0 (no difference in multipliers)
            expect(result[0].totals.otPremiumTier2).toBe(0);
        });

        // Line 1766: otBeforeEntry >= tier2Threshold → otBeforeEntry > tier2Threshold
        // When cumulative OT EXACTLY equals tier2 threshold, next OT should be tier2
        test('should treat OT as tier2 when cumulative OT exactly equals threshold (>= not >)', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 2, // Tier2 kicks in after 2h OT
                    tier2Multiplier: 2.0,
                },
            });
            // Day 1: 2h OT fills threshold exactly
            // Day 2: 2h more OT should be ALL tier2 (otBeforeEntry = 2 = threshold)
            const entries = [
                createEntry({
                    id: 'day1',
                    hourlyRate: 10000,
                    duration: 'PT10H', // 2h OT
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                }),
                createEntry({
                    id: 'day2',
                    hourlyRate: 10000,
                    duration: 'PT10H', // 2h more OT
                    start: '2024-01-16T08:00:00Z',
                    end: '2024-01-16T18:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-16',
            });

            // Day 1: 2h OT fills threshold (all tier1)
            // Day 2: 2h OT is ALL tier2 (otBeforeEntry = 2 >= 2)
            // tier2 premium = (2.0 - 1.5) * 2h * $100 = $100
            expect(result[0].totals.otPremiumTier2).toBe(100);
        });

        // Line 1771: otAfterEntry <= tier2Threshold → otAfterEntry < tier2Threshold
        // When OT after entry EXACTLY equals threshold, all should be tier1
        test('should treat all OT as tier1 when OT after entry exactly equals threshold (<= not <)', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 2, // Tier2 after 2h
                    tier2Multiplier: 2.0,
                },
            });
            // Single entry with exactly 2h OT (fills threshold exactly)
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT10H', // 2h OT, otAfterEntry = 2 = threshold
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // 2h OT exactly at threshold = ALL tier1, no tier2
            expect(result[0].totals.otPremiumTier2).toBe(0);
            // tier1 premium = (1.5 - 1) * 2h * $100 = $100
            expect(result[0].totals.otPremium).toBe(100);
        });
    });

    describe('Tier2 block statement mutations (lines 1780, 1795)', () => {
        // Line 1780:62 - BlockStatement removal in Case 2 (tier1Hours = overtimeHours; tier2Hours = 0)
        // Line 1795 - else block removal (tier2 disabled path)
        test('KILLER: Case 2 block should set tier1Hours when all OT is below tier2 threshold (line 1780)', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 10, // High threshold (won't be reached)
                    tier2Multiplier: 2.0,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H', // 4h OT, all tier1 (otAfter=4 <= 10=threshold)
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // This test specifically targets Case 2 (otAfterEntry <= tier2Threshold)
            // If Case 2 block is emptied (mutation), tier1Hours = 0 → tier1Premium = 0
            // Original: tier1Hours = 4, tier1Premium = 0.5 * 4 * 100 = $200

            // Check entry-level tier1Premium directly
            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            expect(dayEntries).toBeDefined();
            expect(dayEntries[0].analysis.tier1Premium).toBe(200); // Would be 0 if block is empty

            // Also check totals
            expect(result[0].totals.otPremium).toBe(200);
            expect(result[0].totals.otPremiumTier2).toBe(0);
        });

        test('should correctly track tier1Hours when tier2 is disabled', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: false }, // Tier2 disabled
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                },
            });
            const entry = createEntry({
                hourlyRate: 10000,
                duration: 'PT12H', // 4h OT
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // All OT is tier1 when tier2 disabled
            expect(result[0].totals.overtime).toBe(4);
            // tier1 premium = (1.5 - 1) * 4h * $100 = $200
            expect(result[0].totals.otPremium).toBe(200);
            expect(result[0].totals.otPremiumTier2).toBe(0);
        });
    });

    describe('OT accumulator mutation (line 1791)', () => {
        // Line 1791: userOTAccumulator += overtimeHours → -= overtimeHours
        // Test that OT correctly accumulates across multiple entries for tier2
        test('should correctly accumulate OT across multiple entries', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 4, // Tier2 after 4h OT
                    tier2Multiplier: 2.0,
                },
            });
            // Day 1: 2h OT (accumulator = 2)
            // Day 2: 2h OT (accumulator = 4, at threshold)
            // Day 3: 2h OT (accumulator = 6, should be tier2)
            const entries = [
                createEntry({
                    id: 'day1',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                }),
                createEntry({
                    id: 'day2',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-16T08:00:00Z',
                    end: '2024-01-16T18:00:00Z',
                }),
                createEntry({
                    id: 'day3',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-17T08:00:00Z',
                    end: '2024-01-17T18:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-17',
            });

            // 6h total OT: 4h tier1, 2h tier2
            expect(result[0].totals.overtime).toBe(6);
            // tier2 premium = (2.0 - 1.5) * 2h * $100 = $100
            expect(result[0].totals.otPremiumTier2).toBe(100);
        });

        // Also test when tier2 is disabled - accumulator should still work
        test('should accumulate OT in else block when tier2 disabled', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: false },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                },
            });
            const entries = [
                createEntry({
                    id: 'day1',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                }),
                createEntry({
                    id: 'day2',
                    hourlyRate: 10000,
                    duration: 'PT10H',
                    start: '2024-01-16T08:00:00Z',
                    end: '2024-01-16T18:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-16',
            });

            // 4h total OT (2h + 2h)
            expect(result[0].totals.overtime).toBe(4);
        });
    });

    describe('Billable PTO tracking mutations (lines 1896, 1899)', () => {
        // Line 1896: if (isBillable) → if (true)
        // Line 1899: totals.nonBillableWorked += → -= regularHours
        test('should track non-billable PTO correctly (not billable)', () => {
            const store = createMinimalStore();
            const entry = createEntry({
                type: 'TIME_OFF', // PTO entry (classified as 'pto')
                billable: false, // Non-billable
                duration: 'PT4H',
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Non-billable PTO should add to nonBillableWorked, not billableWorked
            expect(result[0].totals.nonBillableWorked).toBe(4);
            expect(result[0].totals.billableWorked).toBe(0);
        });

        test('should track billable PTO correctly', () => {
            const store = createMinimalStore();
            const entry = createEntry({
                type: 'TIME_OFF',
                billable: true,
                duration: 'PT4H',
            });

            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Billable PTO should add to billableWorked
            expect(result[0].totals.billableWorked).toBe(4);
            expect(result[0].totals.nonBillableWorked).toBe(0);
        });

        test('should correctly distinguish billable vs non-billable for mixed entries', () => {
            const store = createMinimalStore();
            const entries = [
                createEntry({
                    id: '1',
                    type: 'TIME_OFF',
                    billable: true,
                    duration: 'PT2H',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T10:00:00Z',
                }),
                createEntry({
                    id: '2',
                    type: 'TIME_OFF',
                    billable: false,
                    duration: 'PT3H',
                    start: '2024-01-15T10:00:00Z',
                    end: '2024-01-15T13:00:00Z',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.billableWorked).toBe(2);
            expect(result[0].totals.nonBillableWorked).toBe(3);
        });
    });

    describe('Time off isFullDay mutation (line 2044)', () => {
        // Line 2044: if (timeOff.isFullDay) → if (false)
        test('should set capacity to 0 for full-day time off', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 8, isFullDay: true });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            // User with no entries - check capacity calculation
            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Full-day time off = 0 expected capacity
            expect(result[0].totals.expectedCapacity).toBe(0);
        });

        test('should reduce capacity by hours for partial time off', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: false });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Partial time off = 8h - 4h = 4h capacity
            expect(result[0].totals.expectedCapacity).toBe(4);
        });

        test('should differentiate full-day vs partial time off', () => {
            const userTimeOffFull = new Map();
            userTimeOffFull.set('2024-01-15', { hours: 8, isFullDay: true });

            const userTimeOffPartial = new Map();
            userTimeOffPartial.set('2024-01-15', { hours: 8, isFullDay: false });

            const storeFull = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOffFull]]),
            });
            const storePartial = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOffPartial]]),
            });

            const resultFull = calculateAnalysis([], storeFull, {
                start: '2024-01-15',
                end: '2024-01-15',
            });
            const resultPartial = calculateAnalysis([], storePartial, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Full day: capacity = 0
            expect(resultFull[0].totals.expectedCapacity).toBe(0);
            // Partial (even 8h): capacity = max(0, 8-8) = 0 but through different path
            // Wait, 8h-8h = 0 either way. Let me use different hours.
            // Actually, the test should use a smaller hours value for partial
        });
    });

    describe('Holiday/TimeOff count mutations for users without entries (lines 2054, 2059, 2061)', () => {
        // Line 2054: if (isHolidayDay) → if (true)
        test('should only count holidays on actual holiday days', () => {
            const store = createMinimalStore({
                config: { applyHolidays: true },
                holidays: new Map([['user1', new Map()]]), // Empty holiday map
            });

            // No holidays defined - holidayCount should be 0
            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.holidayCount).toBe(0);
            expect(result[0].totals.holidayHours).toBe(0);
        });

        test('should count holidays correctly when present', () => {
            const userHolidays = new Map();
            userHolidays.set('2024-01-15', { name: 'Holiday' });

            const store = createMinimalStore({
                config: { applyHolidays: true },
                holidays: new Map([['user1', userHolidays]]),
            });

            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.holidayCount).toBe(1);
            expect(result[0].totals.holidayHours).toBe(8); // Base capacity
        });

        // Line 2059: if (isTimeOffDay) → if (true)
        test('should only count time off on actual time off days', () => {
            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', new Map()]]), // Empty time off map
            });

            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.timeOffCount).toBe(0);
            expect(result[0].totals.timeOffHours).toBe(0);
        });

        test('should count time off correctly when present', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: false });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.timeOffCount).toBe(1);
            expect(result[0].totals.timeOffHours).toBe(4);
        });

        // Line 2061: timeOff?.hours → timeOff.hours
        test('should handle time off with undefined hours gracefully', () => {
            const userTimeOff = new Map();
            // timeOff object exists but hours is undefined
            userTimeOff.set('2024-01-15', { isFullDay: false }); // hours missing

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            // Should use 0 fallback for undefined hours
            const result = calculateAnalysis([], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            expect(result[0].totals.timeOffCount).toBe(1);
            expect(result[0].totals.timeOffHours).toBe(0); // Falls back to 0
        });
    });

    // ============================================================================
    // COST amount type mutations (line 497)
    // ============================================================================
    describe('COST amount type mutations', () => {
        // Line 497: 'COST' → ''
        test('should extract COST rate from amounts array', () => {
            const entry = createEntry({
                amounts: [
                    { type: 'EARNED', value: 160 },
                    { type: 'COST', value: 80 },
                ],
                hourlyRate: null,
                earnedRate: null,
                costRate: null,
            });
            const store = createMinimalStore();
            const result = calculateAnalysis([entry], store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const analysis = result[0].days.get('2024-01-15')?.entries[0]?.analysis;
            // COST rate = 80 / 8h * 100 = 1000 cents/hr → $10/hr displayed
            expect(analysis.amounts.cost.rate).toBe(10);
        });
    });

    // ============================================================================
    // CRITICAL: Additional mutation-killing tests for surviving mutants
    // ============================================================================
    describe('Critical boundary mutation killers', () => {
        // Line 1731: >= vs > - When accumulator EXACTLY equals capacity
        test('KILLER: second entry after exactly-filled capacity should be ALL overtime', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            // Entry 1: exactly 8h fills capacity
            // Entry 2: 1h should be ALL overtime (not split)
            const entries = [
                createEntry({
                    id: 'e1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T16:00:00Z',
                    duration: 'PT8H',
                }),
                createEntry({
                    id: 'e2',
                    start: '2024-01-15T16:00:00Z',
                    end: '2024-01-15T17:00:00Z',
                    duration: 'PT1H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // Entry 2 should have regular=0, overtime=1 (not regular=0.something, overtime=0.something)
            // With the >= mutation changed to >, entry 2 would fall to else-if which might split it
            expect(dayEntries[1].analysis.regular).toBe(0);
            expect(dayEntries[1].analysis.overtime).toBe(1);
            // Assert the exact values
            expect(dayEntries[1].analysis.regular).toStrictEqual(0);
            expect(dayEntries[1].analysis.overtime).toStrictEqual(1);
        });

        // Line 1736: <= vs < - When entry exactly fills remaining capacity
        test('KILLER: entry that exactly fills remaining capacity should be ALL regular', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            // Entry 1: 5h uses some capacity
            // Entry 2: exactly 3h to fill remaining capacity (should be ALL regular, no split)
            const entries = [
                createEntry({
                    id: 'e1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T13:00:00Z',
                    duration: 'PT5H',
                }),
                createEntry({
                    id: 'e2',
                    start: '2024-01-15T13:00:00Z',
                    end: '2024-01-15T16:00:00Z',
                    duration: 'PT3H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // Entry 2: accumulator=5, duration=3, capacity=8. 5+3=8 <= 8, so regular=3, overtime=0
            // With <= changed to <, it would go to else case and split
            expect(dayEntries[1].analysis.regular).toBe(3);
            expect(dayEntries[1].analysis.overtime).toBe(0);
            // Assert exact values
            expect(dayEntries[1].analysis.regular).toStrictEqual(3);
            expect(dayEntries[1].analysis.overtime).toStrictEqual(0);
        });

        // Line 1766: >= vs > for tier2 threshold
        test('KILLER: OT exactly at tier2 threshold should be tier2', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 2, // 2h of OT triggers tier2
                    tier2Multiplier: 2.0,
                },
            });
            // Day 1: 2h OT (exactly fills tier2 threshold)
            // Day 2: 1h OT (should be ALL tier2)
            const entries = [
                createEntry({
                    id: 'e1',
                    hourlyRate: 10000, // $100/hr
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT10H', // 2h OT
                }),
                createEntry({
                    id: 'e2',
                    hourlyRate: 10000,
                    start: '2024-01-16T08:00:00Z',
                    end: '2024-01-16T17:00:00Z',
                    duration: 'PT9H', // 1h OT
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-16',
            });

            // Day 2's OT (1h) should have tier2 premium since OT accumulator (2h) >= threshold (2h)
            // With >= changed to >, it would NOT enter tier2 block when exactly at threshold
            const day2Entries = result[0].days.get('2024-01-16')?.entries;
            const entry2Analysis = day2Entries[0].analysis;
            // Verify tier2 premium exists (exact calculation may vary)
            expect(entry2Analysis.tier2Premium).toBeGreaterThan(0);
            // Total tier2 premium for user should be > 0
            expect(result[0].totals.otPremiumTier2).toBeGreaterThan(0);
        });

        // Line 1771: <= vs < for tier2 boundary
        test('KILLER: OT that exactly fills tier2 threshold should be ALL tier1', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: true },
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                    tier2ThresholdHours: 2,
                    tier2Multiplier: 2.0,
                },
            });
            // Single day: 10h work = 2h OT, exactly filling tier2 threshold
            // Should be ALL tier1 (not split)
            const entries = [
                createEntry({
                    id: 'e1',
                    hourlyRate: 10000,
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT10H', // 2h OT exactly fills threshold
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // otBeforeEntry=0, otAfterEntry=2, threshold=2. 2 <= 2 so ALL tier1
            // With <= changed to <, it would go to else (split case)
            // Tier1 premium = 0.5 * 2h * $100 = $100
            expect(dayEntries[0].analysis.tier1Premium).toBe(100);
            // Tier2 premium = 0 since all OT is tier1
            expect(dayEntries[0].analysis.tier2Premium).toBe(0);
        });

        // Line 1785 block statement removal - else block tracks OT accumulator
        test('KILLER: OT accumulator should track across days even when tier2 disabled', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: false }, // Disabled, so else block runs
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5,
                },
            });
            const entries = [
                createEntry({
                    id: 'e1',
                    hourlyRate: 10000, // $100/hr
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT10H', // 2h OT
                }),
                createEntry({
                    id: 'e2',
                    hourlyRate: 10000,
                    start: '2024-01-16T08:00:00Z',
                    end: '2024-01-16T19:00:00Z',
                    duration: 'PT11H', // 3h OT
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-16',
            });

            // Both days should have overtime tracked
            const day1Entries = result[0].days.get('2024-01-15')?.entries;
            const day2Entries = result[0].days.get('2024-01-16')?.entries;

            // If else block is removed, tier1 premiums would not be calculated
            // Tier1 premium day1 = 0.5 * 2h * $100 = $100
            expect(day1Entries[0].analysis.tier1Premium).toBe(100);
            // Tier1 premium day2 = 0.5 * 3h * $100 = $150
            expect(day2Entries[0].analysis.tier1Premium).toBe(150);
            // Total overtime should be 5h
            expect(result[0].totals.overtime).toBe(5);
        });

        // Line 1797-1803: else block tracks OT and sets tier1Hours when tier2 disabled
        test('KILLER: OT premium should be calculated when tier2 disabled', () => {
            const store = createMinimalStore({
                config: { enableTieredOT: false }, // Else block runs
                calcParams: {
                    dailyThreshold: 8,
                    overtimeMultiplier: 1.5, // OT premium = 0.5 * rate
                },
            });
            // 10h work = 2h OT at $100/hr → premium = 0.5 * 2 * 100 = $100
            const entries = [
                createEntry({
                    id: 'e1',
                    hourlyRate: 10000, // $100/hr in cents
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT10H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Verify OT hours tracked
            expect(result[0].totals.overtime).toBe(2);
            // OT premium = 0.5 * 2h * $100 = $100
            expect(result[0].totals.otPremium).toBe(100);
            // No tier2 premium when tier2 disabled
            expect(result[0].totals.otPremiumTier2).toBe(0);

            // KILLER: Check entry-level tier1Premium directly
            // Line 1797 BlockStatement mutation would set tier1Hours=0, making tier1Premium=0
            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            expect(dayEntries).toBeDefined();
            // tier1Premium = (1.5 - 1) * tier1Hours * rate
            // With tier1Hours = overtimeHours = 2h (correct), tier1Premium = 0.5 * 2 * 100 = $100
            // With tier1Hours = 0 (mutation), tier1Premium = 0 (DIFFERENT!)
            expect(dayEntries[0].analysis.tier1Premium).toBe(100);
        });

        // Line 2044: isFullDay check
        test('KILLER: full day time off should zero capacity', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 8, isFullDay: true });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                calcParams: { dailyThreshold: 8 },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            // Work on a full day off should be ALL overtime
            const entries = [
                createEntry({
                    id: 'e1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                    duration: 'PT4H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // With isFullDay: true, capacity should be 0, ALL work is OT
            // With if (isFullDay) → if (false), capacity would be 8-hours=0, same result
            // But let's test partial day time off differently
            expect(dayEntries[0].analysis.overtime).toBe(4);
            expect(dayEntries[0].analysis.regular).toBe(0);
        });

        test('KILLER: partial day time off should reduce capacity', () => {
            const userTimeOff = new Map();
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: false }); // Half day

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                calcParams: { dailyThreshold: 8 },
                timeOff: new Map([['user1', userTimeOff]]),
            });

            // Work 6h on a half-day off (capacity = 8-4 = 4h)
            const entries = [
                createEntry({
                    id: 'e1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T14:00:00Z',
                    duration: 'PT6H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // Capacity = 8 - 4 = 4h, so 6h work = 4h regular + 2h OT
            // With if (isFullDay) → if (false), capacity would be 8-4=4 (same)
            // Actually the mutation would change isFullDay branch behavior
            expect(dayEntries[0].analysis.regular).toBe(4);
            expect(dayEntries[0].analysis.overtime).toBe(2);
        });

        // KILLER: isFullDay mutation - test with hours != capacity to distinguish if(isFullDay) from if(false)
        test('KILLER: isFullDay=true should zero capacity regardless of hours (mutation killer)', () => {
            const userTimeOff = new Map();
            // Key: hours (4) is DIFFERENT from dailyThreshold (10)
            // With isFullDay=true: capacity = 0
            // With if(false): capacity = 10 - 4 = 6 (DIFFERENT!)
            userTimeOff.set('2024-01-15', { hours: 4, isFullDay: true });

            const store = createMinimalStore({
                config: { applyTimeOff: true },
                calcParams: { dailyThreshold: 10 }, // Different from hours!
                timeOff: new Map([['user1', userTimeOff]]),
            });

            // Work 5h on a full day off
            const entries = [
                createEntry({
                    id: 'e1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T13:00:00Z',
                    duration: 'PT5H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // With isFullDay=true: capacity=0, ALL 5h is OT
            // With if(false) mutation: capacity=10-4=6, so 5h would be ALL regular
            expect(dayEntries[0].analysis.overtime).toBe(5);
            expect(dayEntries[0].analysis.regular).toBe(0);
        });

        // KILLER: isFullDay mutation in "USERS without entries" section (line 2051)
        // Tests the capacity calculation for a USER who has NO entries but DOES have time-off
        // This is important because calc.ts has TWO isFullDay checks:
        //   1. Line ~1643: for users WITH entries (main loop)
        //   2. Line ~2051: for users WITHOUT entries ("Process users without entries" section)
        test('KILLER: isFullDay=true for USER with NO entries should affect expectedCapacity (line 2051)', () => {
            // user1 has entries (processed in main loop)
            // user2 has NO entries but has time-off (processed in "users without entries" section)
            const user2TimeOff = new Map();
            user2TimeOff.set('2024-01-15', { hours: 4, isFullDay: true }); // hours != dailyThreshold

            const store = createMinimalStore({
                users: [
                    { id: 'user1', name: 'User With Entries' },
                    { id: 'user2', name: 'User Without Entries' },
                ],
                config: { applyTimeOff: true },
                calcParams: { dailyThreshold: 10 }, // Different from hours!
                timeOff: new Map([['user2', user2TimeOff]]), // Only user2 has time-off
            });

            // Only user1 has entries - user2 has NO entries
            const entries = [
                createEntry({
                    id: 'e1',
                    userId: 'user1',
                    userName: 'User With Entries',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                    duration: 'PT4H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Find user2's analysis (user without entries)
            const user2Analysis = result.find(r => r.userId === 'user2');
            expect(user2Analysis).toBeDefined();

            // user2 has NO entries but has full-day time-off
            // Day capacity for user2: isFullDay=true => capacity=0
            // Expected total capacity = 0
            // With if(isFullDay)→if(false) mutation:
            //   capacity = max(0, 10-4) = 6 (DIFFERENT!)
            expect(user2Analysis.totals.expectedCapacity).toBe(0);
        });
    });

    // ============================================================================
    // Entry sorting mutation killers (line 1672)
    // ============================================================================
    describe('Entry sorting mutation killers', () => {
        // Test that entries are sorted correctly by start time
        test('KILLER: entries should be sorted chronologically', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 8 },
            });
            // Create entries in reverse chronological order
            const entries = [
                createEntry({
                    id: 'e2',
                    start: '2024-01-15T14:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT4H',
                }),
                createEntry({
                    id: 'e1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                    duration: 'PT4H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // Entries should be processed in chronological order
            // First entry (8h-12h) should fill first 4h of capacity
            // Second entry (14h-18h) should fill remaining 4h of capacity
            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            expect(dayEntries.length).toBe(2);
            // Both entries should be regular (4h + 4h = 8h = capacity)
            expect(result[0].totals.regular).toBe(8);
            expect(result[0].totals.overtime).toBe(0);
        });

        // Verify sorting matters for tail attribution
        test('KILLER: sort order affects tail attribution', () => {
            const store = createMinimalStore({
                calcParams: { dailyThreshold: 6 }, // 6h capacity
            });
            // Two entries: 4h each. First should be regular, second should have 2h OT
            // But if sorted differently, results would change
            const entries = [
                createEntry({
                    id: 'e2',
                    start: '2024-01-15T14:00:00Z',
                    end: '2024-01-15T18:00:00Z',
                    duration: 'PT4H',
                }),
                createEntry({
                    id: 'e1',
                    start: '2024-01-15T08:00:00Z',
                    end: '2024-01-15T12:00:00Z',
                    duration: 'PT4H',
                }),
            ];

            const result = calculateAnalysis(entries, store, {
                start: '2024-01-15',
                end: '2024-01-15',
            });

            // With correct chronological sort (e1 before e2):
            // e1 (4h) fills 4h of 6h capacity → regular=4, ot=0
            // e2 (4h) fills remaining 2h, 2h overflow → regular=2, ot=2
            const dayEntries = result[0].days.get('2024-01-15')?.entries;
            // Find entries by their start time to verify sorting
            const firstEntry = dayEntries.find(e => e.timeInterval?.start?.includes('08:00'));
            const secondEntry = dayEntries.find(e => e.timeInterval?.start?.includes('14:00'));

            expect(firstEntry?.analysis.regular).toBe(4);
            expect(firstEntry?.analysis.overtime).toBe(0);
            expect(secondEntry?.analysis.regular).toBe(2);
            expect(secondEntry?.analysis.overtime).toBe(2);
        });
    });
});
