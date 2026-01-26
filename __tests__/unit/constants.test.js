/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, afterEach } from '@jest/globals';

import { STORAGE_KEYS, CONSTANTS, SUMMARY_COLUMNS, WEEKDAYS } from '../../js/constants.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Constants Module', () => {
  afterEach(() => {
    standardAfterEach();
  });
  describe('STORAGE_KEYS', () => {
    it('should export STORAGE_KEYS object', () => {
      expect(STORAGE_KEYS).toBeDefined();
      expect(typeof STORAGE_KEYS).toBe('object');
    });

    it('should have DENSITY key', () => {
      expect(STORAGE_KEYS.DENSITY).toBe('overtime_density');
    });

    it('should have DEBUG key', () => {
      expect(STORAGE_KEYS.DEBUG).toBe('otplus_debug');
    });

    it('should have OVERRIDES_PREFIX key', () => {
      expect(STORAGE_KEYS.OVERRIDES_PREFIX).toBe('overtime_overrides_');
    });

    it('should have OVERRIDES_UI_PREFIX key', () => {
      expect(STORAGE_KEYS.OVERRIDES_UI_PREFIX).toBe('overtime_overrides_ui_');
    });
  });

  describe('CONSTANTS', () => {
    it('should export CONSTANTS object', () => {
      expect(CONSTANTS).toBeDefined();
      expect(typeof CONSTANTS).toBe('object');
    });

    it('should have correct DEFAULT_DAILY_CAPACITY', () => {
      expect(CONSTANTS.DEFAULT_DAILY_CAPACITY).toBe(8);
    });

    it('should have correct DEFAULT_WEEKLY_CAPACITY', () => {
      expect(CONSTANTS.DEFAULT_WEEKLY_CAPACITY).toBe(40);
    });

    it('should have correct DEFAULT_MULTIPLIER', () => {
      expect(CONSTANTS.DEFAULT_MULTIPLIER).toBe(1.5);
    });

    it('should have correct DATE_FORMAT_ISO', () => {
      expect(CONSTANTS.DATE_FORMAT_ISO).toBe('YYYY-MM-DD');
    });
  });

  describe('SUMMARY_COLUMNS', () => {
    it('should export SUMMARY_COLUMNS array', () => {
      expect(SUMMARY_COLUMNS).toBeDefined();
      expect(Array.isArray(SUMMARY_COLUMNS)).toBe(true);
    });

    it('should have all expected columns', () => {
      const expectedKeys = [
        'capacity',
        'regular',
        'overtime',
        'total',
        'breaks',
        'billableWorked',
        'billableOT',
        'nonBillableOT',
        'timeOff',
        'amount',
        'profit'
      ];

      const actualKeys = SUMMARY_COLUMNS.map(col => col.key);
      expect(actualKeys).toEqual(expectedKeys);
    });

    it('should have labels for all columns', () => {
      SUMMARY_COLUMNS.forEach(column => {
        expect(column.label).toBeDefined();
        expect(typeof column.label).toBe('string');
      });
    });

    it('should have defaultVisible for all columns', () => {
      SUMMARY_COLUMNS.forEach(column => {
        expect(column.defaultVisible).toBeDefined();
        expect(typeof column.defaultVisible).toBe('boolean');
      });
    });
  });

  describe('WEEKDAYS', () => {
    it('should export WEEKDAYS array', () => {
      expect(WEEKDAYS).toBeDefined();
      expect(Array.isArray(WEEKDAYS)).toBe(true);
    });

    it('should have exactly 7 days', () => {
      expect(WEEKDAYS.length).toBe(7);
    });

    it('should have correct weekday keys', () => {
      const expectedKeys = [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY'
      ];

      const actualKeys = WEEKDAYS.map(day => day.key);
      expect(actualKeys).toEqual(expectedKeys);
    });

    it('should have correct weekday labels', () => {
      const expectedLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const actualLabels = WEEKDAYS.map(day => day.label);
      expect(actualLabels).toEqual(expectedLabels);
    });

    it('should have both key and label for each weekday', () => {
      WEEKDAYS.forEach(day => {
        expect(day.key).toBeDefined();
        expect(day.label).toBeDefined();
        expect(typeof day.key).toBe('string');
        expect(typeof day.label).toBe('string');
      });
    });
  });
});
