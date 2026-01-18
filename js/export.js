/**
 * @fileoverview Export Module
 * Handles generating and downloading CSV reports from the analysis results.
 * Includes security measures against CSV injection and robust formatting.
 */

import { formatHours, parseIsoDuration, escapeCsv } from './utils.js';

/**
 * Sanitizes a string to prevent CSV formula injection.
 * If a field starts with =, +, -, @, tab, or carriage return, Excel/Sheets might execute it.
 * We prepend a single quote to force it to be treated as text.
 *
 * @param {string} str - The string to sanitize.
 * @returns {string} Sanitized string safe for CSV.
 */
function sanitizeFormulaInjection(str) {
    if (!str) return '';
    const value = String(str);
    // Check for formula injection characters at start: =, +, -, @, tab, CR
    if (/^[=+\-@\t\r]/.test(value)) {
        return "'" + value;
    }
    return value;
}

/**
 * Generates a CSV file from the analysis results and triggers a browser download.
 *
 * Logic:
 * 1. Defines headers corresponding to the PRD requirements.
 * 2. Iterates through all users and their daily entries.
 * 3. Sanitizes and formats each field (escaping CSV characters, preventing formula injection).
 * 4. Creates a Blob and programmatically clicks a hidden link to download.
 *
 * @param {Array<Object>} analysis - The calculated analysis results (list of user objects).
 * @param {string} [fileName='otplus-report.csv'] - The desired filename for the download.
 */
export function downloadCsv(analysis, fileName = 'otplus-report.csv') {
    const headers = [
        'Date',
        'User',
        'Description',
        'EffectiveCapacityHours',
        'RegularHours',
        'OvertimeHours',
        'BillableWorkedHours',
        'BillableOTHours',
        'NonBillableWorkedHours',
        'NonBillableOTHours',
        'TotalHours',
        'isHoliday',
        'holidayName',
        'isNonWorkingDay',
        'isTimeOff'
    ];

    const rows = [];

    analysis.forEach(user => {
        Array.from(user.days.entries()).forEach(([dateKey, day]) => {
            // Ensure gapless export: include a placeholder row for days with no time entries
            const entriesToLoop = day.entries.length > 0 ? day.entries : [{
                description: '(no entries)',
                timeInterval: { start: dateKey + 'T00:00:00Z', duration: 'PT0H' },
                analysis: { regular: 0, overtime: 0, isBillable: false }
            }];

            entriesToLoop.forEach(e => {
                // Sanitize all text fields to prevent CSV injection
                const userName = sanitizeFormulaInjection(user.userName);
                const description = sanitizeFormulaInjection(e.description);
                // CRITICAL FIX #1: Access day.meta.* instead of day.*
                const holidayName = sanitizeFormulaInjection(day.meta?.holidayName);

                const billableWorked = e.analysis?.isBillable ? (e.analysis?.regular || 0) : 0;
                const billableOT = e.analysis?.isBillable ? (e.analysis?.overtime || 0) : 0;
                const nonBillableWorked = !e.analysis?.isBillable ? (e.analysis?.regular || 0) : 0;
                const nonBillableOT = !e.analysis?.isBillable ? (e.analysis?.overtime || 0) : 0;

                const row = [
                    (e.timeInterval.start || '').split('T')[0],
                    userName,
                    description,
                    formatHours(day.meta?.capacity ?? 0),
                    formatHours(e.analysis?.regular || 0),
                    formatHours(e.analysis?.overtime || 0),
                    formatHours(billableWorked),
                    formatHours(billableOT),
                    formatHours(nonBillableWorked),
                    formatHours(nonBillableOT),
                    formatHours(e.timeInterval.duration ? parseIsoDuration(e.timeInterval.duration) : 0),
                    day.meta?.isHoliday ? 'Yes' : 'No',
                    holidayName,
                    day.meta?.isNonWorking ? 'Yes' : 'No',
                    day.meta?.isTimeOff ? 'Yes' : 'No'
                ].map(escapeCsv); // Use helper for consistent CSV escaping (quotes, commas, newlines)

                rows.push(row.join(','));
            });
        });
    });

    const csvContent = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // CRITICAL FIX #6: Prevent memory leak by revoking object URL
    URL.revokeObjectURL(url);
}

