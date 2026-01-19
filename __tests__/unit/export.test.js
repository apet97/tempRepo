/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import { downloadCsv } from '../../js/export.js';
import { parseIsoDuration } from '../../js/utils.js';
import { calculateAnalysis } from '../../js/calc.js';
import { createMockStore } from '../helpers/mock-data.js';

// Mock URL and document
global.URL.createObjectURL = jest.fn();
global.URL.revokeObjectURL = jest.fn();

describe('Export Module', () => {
  let mockAnalysis;
  let mockStore;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    document.body.innerHTML = '';

    // Mock document.createElement for download link
    const mockLink = {
      setAttribute: jest.fn(),
      click: jest.fn(),
      style: {},
      setAttribute: jest.fn(),
      remove: jest.fn()
    };
    document.createElement = jest.fn(() => mockLink);
    document.body.appendChild = jest.fn();
    document.body.removeChild = jest.fn();

    // Create mock store
    mockStore = createMockStore({
      users: [
        { id: 'user_1', name: 'User 1' },
        { id: 'user_2', name: 'User 2' }
      ]
    });

    // Create mock analysis data
    const entries = [
      {
        id: 'entry_1',
        userId: 'user_1',
        userName: 'User 1',
        description: 'Test work',
        timeInterval: {
          start: '2025-01-15T09:00:00Z',
          end: '2025-01-15T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true
      },
      {
        id: 'entry_2',
        userId: 'user_1',
        userName: 'User 1',
        description: 'More work',
        timeInterval: {
          start: '2025-01-16T09:00:00Z',
          end: '2025-01-16T19:00:00Z',
          duration: 'PT10H'
        },
        hourlyRate: { amount: 5000 },
        billable: false
      }
    ];

    mockAnalysis = calculateAnalysis(entries, mockStore, {
      start: '2025-01-01',
      end: '2025-01-31'
    });
  });

  describe('downloadCsv', () => {
    it('should create and trigger CSV download', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const appendChildSpy = jest.spyOn(document.body, 'appendChild');
      const removeChildSpy = jest.spyOn(document.body, 'removeChild');
      const clickSpy = jest.fn();

      // Mock link element
      const mockLink = {
        setAttribute: jest.fn(),
        click: clickSpy,
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      // Mock Blob
      global.Blob = jest.fn((content, options) => ({
        content,
        options
      }));

      downloadCsv(mockAnalysis);

      // Should create a link element
      expect(createElementSpy).toHaveBeenCalledWith('a');

      // Should set download attributes
      expect(mockLink.setAttribute).toHaveBeenCalledWith('href', undefined);
      expect(mockLink.setAttribute).toHaveBeenCalledWith('download', 'otplus-report.csv');

      // Should trigger click
      expect(clickSpy).toHaveBeenCalled();

      // Should append and remove from body
      expect(appendChildSpy).toHaveBeenCalledWith(mockLink);
      expect(removeChildSpy).toHaveBeenCalledWith(mockLink);
    });

    it('should include CSV headers', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];
        expect(csvContent).toContain('Date');
        expect(csvContent).toContain('User');
        expect(csvContent).toContain('Description');
        expect(csvContent).toContain('EffectiveCapacityHours');
        expect(csvContent).toContain('RegularHours');
        expect(csvContent).toContain('OvertimeHours');
        expect(csvContent).toContain('BillableWorkedHours');
        expect(csvContent).toContain('BillableOTHours');
        expect(csvContent).toContain('NonBillableOTHours');
        expect(csvContent).toContain('TotalHours');
        expect(csvContent).toContain('TotalHoursDecimal');
        expect(csvContent).toContain('isHoliday');
        expect(csvContent).toContain('holidayName');
        expect(csvContent).toContain('isNonWorkingDay');
        expect(csvContent).toContain('isTimeOff');
      });

      downloadCsv(mockAnalysis);
    });

    it('should include entry data in CSV', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];

        // Should contain dates
        expect(csvContent).toContain('2025-01-15');
        expect(csvContent).toContain('2025-01-16');

        // Should contain user names
        expect(csvContent).toContain('User 1');

        // Should contain descriptions
        expect(csvContent).toContain('Test work');
        expect(csvContent).toContain('More work');

        // Should contain specific hours based on billable status
        // Test work: 8h Billable Worked (Billable=true)
        // More work: 2h Non-Billable OT (Billable=false, 10h total > 8h cap)
        
        // Regex to check for row content loosely
        // "Test work", ..., 8h (BillableWorked) - 8h is safe, no quotes
        expect(csvContent).toMatch(/Test work.*,8h,/);
        
        // "More work", ..., 2h (NonBillableOT) - 2h is safe, no quotes
        expect(csvContent).toMatch(/More work.*,2h,/);
      });

      downloadCsv(mockAnalysis);
    });

    it('should escape CSV injection characters', () => {
      const entriesWithFormula = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: '=SUM(A1:A10)', // CSV injection attempt
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithFormula = calculateAnalysis(entriesWithFormula, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];

        // Should escape the = sign to prevent CSV injection (e.g. by prepending ')
        // We expect '=SUM(A1:A10) to be present (quoted due to comma or just text)
        // escapeCsv doesn't quote if no comma/quote.
        // description becomes "'=SUM(A1:A10)".
        // CSV row: ...,User 1,'=SUM(A1:A10),...
        expect(csvContent).toContain("'=SUM(A1:A10)");
      });

      downloadCsv(analysisWithFormula);
    });

    it('should escape quotes in descriptions', () => {
      const entriesWithQuotes = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Work on "Project Alpha"', // Contains quotes
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithQuotes = calculateAnalysis(entriesWithQuotes, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];

        // Should double quotes for CSV
        expect(csvContent).toContain('"Work on ""Project Alpha"""');
      });

      downloadCsv(analysisWithQuotes);
    });

    it('should handle empty descriptions', () => {
      const entriesWithoutDesc = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: null,
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysisWithoutDesc = calculateAnalysis(entriesWithoutDesc, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];

        // Should show empty description as empty field - capacity is now correctly read from meta
        // CSV format: Date,User,Description,EffectiveCapacityHours,...
        // After fix, capacity comes from day.meta.capacity which is 8h (default)
        expect(csvContent).toMatch(/User 1,,8h/);
      });

      downloadCsv(analysisWithoutDesc);
    });

    it('should include multiple entries from same day', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Morning work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T12:00:00Z',
            duration: 'PT3H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        },
        {
          id: 'entry_2',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Afternoon work',
          timeInterval: {
            start: '2025-01-15T13:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT4H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];

        // Should have both entries on same date
        const dateMatches = (csvContent.match(/2025-01-15/g) || []).length;
        expect(dateMatches).toBeGreaterThanOrEqual(2);

        // Should have both descriptions
        expect(csvContent).toContain('Morning work');
        expect(csvContent).toContain('Afternoon work');
      });

      downloadCsv(analysis);
    });

    it('should include capacity information', () => {
      const entries = [
        {
          id: 'entry_1',
          userId: 'user_1',
          userName: 'User 1',
          description: 'Regular work',
          timeInterval: {
            start: '2025-01-15T09:00:00Z',
            end: '2025-01-15T17:00:00Z',
            duration: 'PT8H'
          },
          hourlyRate: { amount: 5000 },
          billable: true
        }
      ];

      const analysis = calculateAnalysis(entries, mockStore, {
        start: '2025-01-01',
        end: '2025-01-31'
      });

      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      global.Blob = jest.fn((content) => {
        const csvContent = content[0];

        // Should have capacity (8h)
        expect(csvContent).toContain('8h');
      });

      downloadCsv(analysis);
    });

    it('should set custom filename when provided', () => {
      const createElementSpy = jest.spyOn(document, 'createElement');
      const mockLink = {
        setAttribute: jest.fn(),
        click: jest.fn(),
        style: {}
      };
      createElementSpy.mockReturnValue(mockLink);

      downloadCsv(mockAnalysis, 'custom-report.csv');

      expect(mockLink.setAttribute).toHaveBeenCalledWith(
        'download',
        'custom-report.csv'
      );
    });
  });

  describe('parseIsoDuration', () => {
    it('should parse PT8H', () => {
      expect(parseIsoDuration('PT8H')).toBe(8);
    });

    it('should parse PT1H30M', () => {
      expect(parseIsoDuration('PT1H30M')).toBe(1.5);
    });

    it('should parse PT45M', () => {
      expect(parseIsoDuration('PT45M')).toBe(0.75);
    })

    it('should parse PT30S', () => {
      expect(parseIsoDuration('PT30S')).toBeCloseTo(0.00833, 4);
    })

    it('should parse complex duration PT2H45M30S', () => {
      const result = parseIsoDuration('PT2H45M30S');
      expect(result).toBeCloseTo(2.7583, 3);
    })

    it('should return 0 for empty string', () => {
      expect(parseIsoDuration('')).toBe(0);
    })

    it('should return 0 for null', () => {
      expect(parseIsoDuration(null)).toBe(0);
    })

    it('should return 0 for undefined', () => {
      expect(parseIsoDuration(undefined)).toBe(0);
    })

    it('should handle invalid format gracefully', () => {
      expect(parseIsoDuration('invalid')).toBe(0);
    })

    it('should parse PT0H', () => {
      expect(parseIsoDuration('PT0H')).toBe(0);
    })
  })
})
