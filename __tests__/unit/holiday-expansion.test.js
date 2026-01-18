/**
 * @jest-environment jsdom
 */

import { jest, beforeEach, beforeAll, describe, it, expect } from '@jest/globals';

// Define variables for mocked modules and function under test
let handleGenerateReport;
let Api; // The mocked Api object
let store;
let UI; // The mocked UI object

describe('Main Logic Fixes - Holiday Expansion', () => {
    beforeAll(async () => {
        // 1. Mock global fetch
        global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

        // 2. Define Mocks using unstable_mockModule
        
        // Mock API
        const mockApiMethods = {
            fetchEntries: jest.fn(),
            fetchAllProfiles: jest.fn(),
            fetchAllHolidays: jest.fn(),
            fetchAllTimeOff: jest.fn(),
            fetchUsers: jest.fn()
        };
        jest.unstable_mockModule('../../js/api.js', () => ({
            Api: mockApiMethods
        }));

        // Mock UI
        const mockUI = {
            initializeElements: jest.fn(),
            renderLoading: jest.fn(),
            renderApiStatus: jest.fn(),
            renderOverridesTable: jest.fn(),
            renderSummaryStrip: jest.fn(),
            renderSummaryTable: jest.fn(),
            renderDetailedTable: jest.fn(),
            bindEvents: jest.fn(),
            showError: jest.fn(),
            hideError: jest.fn(),
            Elements: {}
        };
        jest.unstable_mockModule('../../js/ui.js', () => mockUI);

        // Mock Utils
        jest.unstable_mockModule('../../js/utils.js', () => ({
            IsoUtils: {
                extractDateKey: (iso) => iso ? iso.split('T')[0] : null,
                generateDateRange: (start, end) => {
                     const dates = [];
                     const currentDate = new Date(start);
                     const endDate = new Date(end);
                     while (currentDate <= endDate) {
                         dates.push(currentDate.toISOString().split('T')[0]);
                         currentDate.setDate(currentDate.getDate() + 1);
                     }
                     return dates;
                },
                toISODate: (date) => date.toISOString().split('T')[0]
            },
            debounce: fn => fn,
            escapeHtml: str => str,
            formatHours: h => h + 'h',
            formatCurrency: c => c,
            safeJSONParse: (text, fallback) => fallback,
            parseIsoDuration: () => 8
        }));

        // Mock Calc/Export
        jest.unstable_mockModule('../../js/calc.js', () => ({
          calculateAnalysis: jest.fn(() => [])
        }));
        jest.unstable_mockModule('../../js/export.js', () => ({
          parseIsoDuration: jest.fn(() => 8),
          downloadCsv: jest.fn()
        }));

        // 3. Dynamic Imports
        const stateModule = await import('../../js/state.js');
        store = stateModule.store;
        
        const apiModule = await import('../../js/api.js');
        Api = apiModule.Api;

        const mainModule = await import('../../js/main.js');
        handleGenerateReport = mainModule.handleGenerateReport;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        
        document.body.innerHTML = `
            <input type="date" id="startDate" value="2026-01-01">
            <input type="date" id="endDate" value="2026-01-31">
            <div id="resultsContainer" class="hidden"></div>
            <div id="loadingState"></div>
            <div id="emptyState"></div>
            <div id="apiStatusBanner"></div>
            <div id="summaryStrip"></div>
            <div id="summaryTableBody"></div>
            <div id="detailedTableContainer"></div>
            <button id="exportBtn" disabled></button>
            <div id="tabNavCard"></div>
        `;

        store.resetApiStatus();
        store.users = [{ id: 'u1', name: 'User 1' }];
        store.claims = { workspaceId: 'ws1' };
        store.config.applyHolidays = true;
        store.profiles = new Map();
        store.holidays = new Map();
        store.timeOff = new Map();
    });

    it('should correctly expand multi-day holidays into store.holidays', async () => {
        Api.fetchEntries.mockResolvedValue([]);
        Api.fetchAllProfiles.mockResolvedValue(new Map());
        Api.fetchAllTimeOff.mockResolvedValue(new Map());
        
        const multiDayHoliday = {
            name: 'Long Holiday',
            datePeriod: {
                startDate: '2026-12-25',
                endDate: '2026-12-27'
            }
        };
        
        Api.fetchAllHolidays.mockResolvedValue(new Map([
            ['u1', [multiDayHoliday]]
        ]));

        await handleGenerateReport();

        const userHolidays = store.holidays.get('u1');
        expect(userHolidays).toBeDefined();
        expect(userHolidays.has('2026-12-25')).toBe(true);
        expect(userHolidays.has('2026-12-26')).toBe(true);
        expect(userHolidays.has('2026-12-27')).toBe(true);
    });

    it('should handle single-day holidays correctly', async () => {
         Api.fetchEntries.mockResolvedValue([]);
         Api.fetchAllProfiles.mockResolvedValue(new Map());
         Api.fetchAllTimeOff.mockResolvedValue(new Map());
         
         const singleDayHoliday = {
             name: 'Single Day',
             datePeriod: {
                 startDate: '2026-01-01',
                 endDate: '2026-01-01'
             }
         };
         
         Api.fetchAllHolidays.mockResolvedValue(new Map([
             ['u1', [singleDayHoliday]]
         ]));
 
         await handleGenerateReport();
 
         const userHolidays = store.holidays.get('u1');
         expect(userHolidays.size).toBe(1);
         expect(userHolidays.has('2026-01-01')).toBe(true);
    });
});