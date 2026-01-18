/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import {
  safeJSONParse,
  escapeHtml,
  debounce,
  formatCurrency,
  formatHours,
  IsoUtils
} from '../../js/utils.js';

describe('Utils Module', () => {
  describe('safeJSONParse', () => {
    it('should parse valid JSON', () => {
      const result = safeJSONParse('{"key": "value"}', {});
      expect(result).toEqual({ key: 'value' });
    });

    it('should return fallback for invalid JSON', () => {
      const result = safeJSONParse('invalid json', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should return fallback for null input', () => {
      const result = safeJSONParse(null, { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should return fallback for undefined input', () => {
      const result = safeJSONParse(undefined, { fallback: true });
      expect(result).toEqual({ fallback: true });
    });

    it('should return fallback for empty string', () => {
      const result = safeJSONParse('', { fallback: true });
      expect(result).toEqual({ fallback: true });
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      const result = escapeHtml('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;');
    });

    it('should return empty string for null input', () => {
      const result = escapeHtml(null);
      expect(result).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const result = escapeHtml(undefined);
      expect(result).toBe('');
    });

    it('should not modify safe text', () => {
      const result = escapeHtml('Safe text');
      expect(result).toBe('Safe text');
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should debounce function calls', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      debouncedFn();
      debouncedFn();

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should execute function after wait period', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 200);

      debouncedFn('arg1', 'arg2');

      jest.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should reset timer on subsequent calls', () => {
      const fn = jest.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      jest.advanceTimersByTime(50);
      debouncedFn();
      jest.advanceTimersByTime(50);

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('formatCurrency', () => {
    it('should format USD currency', () => {
      const result = formatCurrency(100);
      expect(result).toMatch(/\$100\.00/);
    });

    it('should format currency with cents', () => {
      const result = formatCurrency(100.5);
      expect(result).toMatch(/\$100\.50/);
    });

    it('should handle zero', () => {
      const result = formatCurrency(0);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should handle negative numbers', () => {
      const result = formatCurrency(-100);
      expect(result).toMatch(/\$-?100\.00/);
    });

    it('should return $0.00 for null', () => {
      const result = formatCurrency(null);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should return $0.00 for undefined', () => {
      const result = formatCurrency(undefined);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should return $0.00 for NaN', () => {
      const result = formatCurrency(NaN);
      expect(result).toMatch(/\$0\.00/);
    });

    it('should format different currency', () => {
      const result = formatCurrency(100, 'EUR');
      expect(result).toMatch(/€100\.00/);
    });
  });

  describe('formatHours', () => {
    it('should format whole hours', () => {
      expect(formatHours(8)).toBe('8h');
    });

    it('should format hours with minutes', () => {
      expect(formatHours(8.5)).toBe('8h 30m');
      expect(formatHours(1.25)).toBe('1h 15m');
    });

    it('should handle zero', () => {
      expect(formatHours(0)).toBe('0h');
    });

    it('should round minutes', () => {
      expect(formatHours(1.33)).toBe('1h 20m'); // 0.33 * 60 = 19.8 ≈ 20
    });

    it('should handle null', () => {
      expect(formatHours(null)).toBe('0h');
    });

    it('should handle undefined', () => {
      expect(formatHours(undefined)).toBe('0h');
    });

    it('should handle NaN', () => {
      expect(formatHours(NaN)).toBe('0h');
    });

    it('should handle negative hours', () => {
      expect(formatHours(-5)).toBe('-5h');
    });
  });
});

describe('IsoUtils', () => {
  describe('toISODate', () => {
    it('should convert Date to ISO date string', () => {
      const date = new Date('2025-01-15T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2025-01-15');
    });

    it('should handle different dates', () => {
      const date = new Date('2024-12-31T00:00:00Z');
      expect(IsoUtils.toISODate(date)).toBe('2024-12-31');
    });

    it('should return empty string for null', () => {
      expect(IsoUtils.toISODate(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(IsoUtils.toISODate(undefined)).toBe('');
    });
  });

  describe('parseDate', () => {
    it('should parse ISO date string', () => {
      const date = IsoUtils.parseDate('2025-01-15');
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toContain('2025-01-15');
    });

    it('should return null for null input', () => {
      expect(IsoUtils.parseDate(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(IsoUtils.parseDate(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(IsoUtils.parseDate('')).toBeNull();
    });
  });

  describe('extractDateKey', () => {
    it('should extract date from ISO string', () => {
      expect(IsoUtils.extractDateKey('2025-01-15T09:00:00Z')).toBe('2025-01-15');
    });

    it('should handle strings with timezone offset', () => {
      expect(IsoUtils.extractDateKey('2025-01-15T09:00:00+05:00')).toBe('2025-01-15');
    });

    it('should return null for invalid input', () => {
      expect(IsoUtils.extractDateKey(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(IsoUtils.extractDateKey(undefined)).toBeNull();
    });
  });

  describe('getWeekdayKey', () => {
    it('should return weekday for date', () => {
      expect(IsoUtils.getWeekdayKey('2025-01-13')).toBe('MONDAY'); // Jan 13, 2025 is Monday
      expect(IsoUtils.getWeekdayKey('2025-01-14')).toBe('TUESDAY');
      expect(IsoUtils.getWeekdayKey('2025-01-15')).toBe('WEDNESDAY');
    });

    it('should return empty string for null', () => {
      expect(IsoUtils.getWeekdayKey(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(IsoUtils.getWeekdayKey(undefined)).toBe('');
    });
  });

  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      expect(IsoUtils.isWeekend('2025-01-11')).toBe(true); // Jan 11, 2025 is Saturday
    });

    it('should return true for Sunday', () => {
      expect(IsoUtils.isWeekend('2025-01-12')).toBe(true); // Jan 12, 2025 is Sunday
    });

    it('should return false for weekday', () => {
      expect(IsoUtils.isWeekend('2025-01-13')).toBe(false); // Monday
    });

    it('should return false for null', () => {
      expect(IsoUtils.isWeekend(null)).toBe(false);
    });
  });

  describe('generateDateRange', () => {
    it('should generate date range', () => {
      const dates = IsoUtils.generateDateRange('2025-01-01', '2025-01-05');
      expect(dates).toEqual([
        '2025-01-01',
        '2025-01-02',
        '2025-01-03',
        '2025-01-04',
        '2025-01-05'
      ]);
    });

    it('should handle single day range', () => {
      const dates = IsoUtils.generateDateRange('2025-01-01', '2025-01-01');
      expect(dates).toEqual(['2025-01-01']);
    });

    it('should return empty array for invalid dates', () => {
      const dates = IsoUtils.generateDateRange('invalid', '2025-01-05');
      expect(dates).toEqual([]);
    });

    it('should handle month boundaries', () => {
      const dates = IsoUtils.generateDateRange('2025-01-30', '2025-02-02');
      expect(dates).toContain('2025-01-30');
      expect(dates).toContain('2025-01-31');
      expect(dates).toContain('2025-02-01');
      expect(dates).toContain('2025-02-02');
    });
  });
});
