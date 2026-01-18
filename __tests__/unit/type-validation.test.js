/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';
import {
  validateTimeEntry,
  validateUser,
  validateUserProfile,
  validateNumber,
  validateString,
  validateISODateString,
  validateRequiredFields
} from '../../js/utils.js';

describe('Type Validation', () => {
  describe('validateNumber', () => {
    it('should accept valid numbers', () => {
      expect(validateNumber(5, 'Hours')).toBe(5);
      expect(validateNumber(7.5, 'Rate')).toBe(7.5);
    });

    it('should reject null', () => {
      expect(() => validateNumber(null, 'Hours')).toThrow();
    });

    it('should reject undefined', () => {
      expect(() => validateNumber(undefined, 'Hours')).toThrow();
    });

    it('should reject NaN', () => {
      expect(() => validateNumber(NaN, 'Hours')).toThrow();
    });

    it('should reject non-numbers', () => {
      expect(() => validateNumber('abc', 'Hours')).toThrow();
    });
  });

  describe('validateString', () => {
    it('should accept valid strings', () => {
      expect(validateString('hello', 'Name')).toBe('hello');
    });

    it('should trim whitespace', () => {
      expect(validateString('  hello  ', 'Name')).toBe('hello');
    });

    it('should reject null', () => {
      expect(() => validateString(null, 'Name')).toThrow();
    });

    it('should reject undefined', () => {
      expect(() => validateString(undefined, 'Name')).toThrow();
    });

    it('should reject whitespace-only strings', () => {
      expect(() => validateString('   ', 'Name')).toThrow();
    });

    it('should reject non-string values', () => {
      expect(() => validateString(123, 'Name')).toThrow();
    });
  });

  describe('validateISODateString', () => {
    it('should accept valid ISO dates', () => {
      expect(validateISODateString('2025-01-01', 'Date')).toBe('2025-01-01');
      expect(validateISODateString('2025-12-31T23:59:59Z', 'Date')).toBe('2025-12-31T23:59:59Z');
    });

    it('should reject invalid date strings', () => {
      expect(() => validateISODateString('invalid', 'Date')).toThrow();
    });

    it('should reject non-ISO formatted dates', () => {
      expect(() => validateISODateString('01/01/2025', 'Date')).toThrow();
    });

    it('should reject null', () => {
      expect(() => validateISODateString(null, 'Date')).toThrow();
    });
  });

  describe('validateTimeEntry', () => {
    it('should accept valid time entries', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(validateTimeEntry(entry)).toBe(true);
    });

    it('should accept with all optional fields', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        userName: 'John Doe',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z',
          duration: 'PT8H'
        },
        hourlyRate: { amount: 5000 },
        billable: true,
        description: 'Worked on project'
      };
      expect(validateTimeEntry(entry)).toBe(true);
    });

    it('should reject missing ID', () => {
      const entry = {
        userId: 'user1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject missing userId', () => {
      const entry = {
        id: 'entry1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject missing timeInterval', () => {
      const entry = { id: 'entry1', userId: 'user1' };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject invalid start time', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        timeInterval: {
          start: 'invalid',
          end: '2025-01-01T17:00:00Z'
        }
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });

    it('should reject billable as non-boolean', () => {
      const entry = {
        id: 'entry1',
        userId: 'user1',
        timeInterval: {
          start: '2025-01-01T09:00:00Z',
          end: '2025-01-01T17:00:00Z'
        },
        billable: 'yes'
      };
      expect(() => validateTimeEntry(entry)).toThrow();
    });
  });

  describe('validateUser', () => {
    it('should accept valid users', () => {
      const user = {
        id: 'user1',
        name: 'John Doe'
      };
      expect(validateUser(user)).toBe(true);
    });

    it('should accept with email', () => {
      const user = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com'
      };
      expect(validateUser(user)).toBe(true);
    });

    it('should reject missing ID', () => {
      const user = { name: 'John Doe' };
      expect(() => validateUser(user)).toThrow();
    });

    it('should reject missing name', () => {
      const user = { id: 'user1' };
      expect(() => validateUser(user)).toThrow();
    });
  });

  describe('validateUserProfile', () => {
    it('should accept minimal profile', () => {
      const profile = {};
      expect(validateUserProfile(profile)).toBe(true);
    });

    it('should accept profile with workCapacity', () => {
      const profile = { workCapacity: 'PT8H' };
      expect(validateUserProfile(profile)).toBe(true);
    });

    it('should accept profile with workingDays', () => {
      const profile = {
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY']
      };
      expect(validateUserProfile(profile)).toBe(true);
    });

    it('should reject workingDays as non-array', () => {
      const profile = { workingDays: 'MONDAY' };
      expect(() => validateUserProfile(profile)).toThrow();
    });

    it('should reject workingDays with non-string elements', () => {
      const profile = { workingDays: ['MONDAY', 123] };
      expect(() => validateUserProfile(profile)).toThrow();
    });
  });
});
