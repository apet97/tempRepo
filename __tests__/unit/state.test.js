/**
 * @jest-environment jsdom
 */

import { store } from '../../js/state.js';
import { STORAGE_KEYS } from '../../js/constants.js';

describe('State Module - Store Class', () => {
  beforeEach(() => {
    // Reset store before each test
    store.token = null;
    store.claims = null;
    store.users = [];
    store.rawEntries = null;
    store.analysisResults = null;
    store.profiles = new Map();
    store.holidays = new Map();
    store.timeOff = new Map();
    store.overrides = {};
    store.apiStatus = {
      profilesFailed: 0,
      holidaysFailed: 0,
      timeOffFailed: 0
    };

    // Clear localStorage
    localStorage.clear();
  });

  describe('Store Initialization', () => {
    it('should initialize with default values', () => {
      expect(store.token).toBeNull();
      expect(store.claims).toBeNull();
      expect(store.users).toEqual([]);
      expect(store.rawEntries).toBeNull();
      expect(store.analysisResults).toBeNull();
      expect(store.profiles).toBeInstanceOf(Map);
      expect(store.holidays).toBeInstanceOf(Map);
      expect(store.timeOff).toBeInstanceOf(Map);
      expect(store.overrides).toEqual({});
    });

    it('should initialize with default config', () => {
      expect(store.config).toEqual({
        useProfileCapacity: true,
        useProfileWorkingDays: true,
        applyHolidays: true,
        applyTimeOff: true,
        showBillableBreakdown: true,
        showDecimalTime: false,
        amountDisplay: 'earned',
        overtimeBasis: 'daily'
      });
    });

    it('should initialize with default calculation parameters', () => {
      expect(store.calcParams).toEqual({
        dailyThreshold: 8,
        weeklyThreshold: 40,
        overtimeMultiplier: 1.5,
        tier2ThresholdHours: 0,
        tier2Multiplier: 2.0
      });
    });

    it('should initialize API status', () => {
      expect(store.apiStatus).toEqual({
        profilesFailed: 0,
        holidaysFailed: 0,
        timeOffFailed: 0
      });
    });

    it('should initialize UI state', () => {
      expect(store.ui).toEqual({
        isLoading: false,
        summaryExpanded: false,
        summaryGroupBy: 'user',
        overridesCollapsed: true,
        activeTab: 'summary',
        detailedPage: 1,
        detailedPageSize: 50,
        activeDetailedFilter: 'all',
        hasCostRates: true
      });
    });
  });

  describe('setToken', () => {
    it('should set token and claims', () => {
      const mockClaims = { workspaceId: 'workspace_123' };
      store.setToken('mock_token', mockClaims);

      expect(store.token).toBe('mock_token');
      expect(store.claims).toEqual(mockClaims);
    });

    it('should load overrides when workspaceId is present', () => {
      const workspaceId = 'workspace_123';
      const mockOverrides = { user_1: { capacity: 6, multiplier: 2 } };

      // Pre-populate localStorage
      localStorage.setItem(
        `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`,
        JSON.stringify(mockOverrides)
      );

      store.setToken('mock_token', { workspaceId });

      // Migration adds mode: 'global' to overrides without a mode
      expect(store.overrides).toEqual({
        user_1: { mode: 'global', capacity: 6, multiplier: 2 }
      });
    });

    it('should initialize empty overrides when no localStorage data', () => {
      store.setToken('mock_token', { workspaceId: 'workspace_123' });

      expect(store.overrides).toEqual({});
    });

    it('should initialize empty overrides when localStorage has invalid JSON', () => {
      const workspaceId = 'workspace_123';
      localStorage.setItem(
        `${STORAGE_KEYS.OVERRIDES_PREFIX}${workspaceId}`,
        'invalid json'
      );

      store.setToken('mock_token', { workspaceId });

      expect(store.overrides).toEqual({});
    });
  });

  describe('updateOverride', () => {
    beforeEach(() => {
      store.setToken('mock_token', { workspaceId: 'workspace_123' });
    });

    it('should add new override', () => {
      store.updateOverride('user_1', 'capacity', 6);

      expect(store.overrides['user_1']).toEqual({ capacity: 6 });
    });

    it('should add multiple overrides for same user', () => {
      store.updateOverride('user_1', 'capacity', 6);
      store.updateOverride('user_1', 'multiplier', 2);

      expect(store.overrides['user_1']).toEqual({
        capacity: 6,
        multiplier: 2
      });
    });

    it('should update existing override', () => {
      store.updateOverride('user_1', 'capacity', 6);
      store.updateOverride('user_1', 'capacity', 7);

      expect(store.overrides['user_1']).toEqual({ capacity: 7 });
    });

    it('should remove override when value is null', () => {
      store.updateOverride('user_1', 'capacity', 6);
      store.updateOverride('user_1', 'capacity', null);

      expect(store.overrides['user_1']).toBeUndefined();
    });

    it('should remove override when value is empty string', () => {
      store.updateOverride('user_1', 'capacity', 6);
      store.updateOverride('user_1', 'capacity', '');

      expect(store.overrides['user_1']).toBeUndefined();
    });

    it('should remove user override object when all fields are removed', () => {
      store.updateOverride('user_1', 'capacity', 6);
      store.updateOverride('user_1', 'multiplier', 2);
      store.updateOverride('user_1', 'capacity', null);
      store.updateOverride('user_1', 'multiplier', '');

      expect(store.overrides['user_1']).toBeUndefined();
      expect(Object.keys(store.overrides)).toHaveLength(0);
    });

    it('should persist overrides to localStorage', () => {
      store.updateOverride('user_1', 'capacity', 6);

      const saved = localStorage.getItem(
        `${STORAGE_KEYS.OVERRIDES_PREFIX}workspace_123`
      );
      expect(saved).toBeTruthy();

      const parsed = JSON.parse(saved);
      expect(parsed['user_1']).toEqual({ capacity: 6 });
    });

    it('should handle multiple users', () => {
      store.updateOverride('user_1', 'capacity', 6);
      store.updateOverride('user_2', 'capacity', 7);
      store.updateOverride('user_2', 'multiplier', 2);

      expect(store.overrides['user_1']).toEqual({ capacity: 6 });
      expect(store.overrides['user_2']).toEqual({
        capacity: 7,
        multiplier: 2
      });
    });

    it('should not throw when workspaceId is not set', () => {
      store.claims = null;

      expect(() => {
        store.updateOverride('user_1', 'capacity', 6);
      }).not.toThrow();
    });
  });

  describe('getUserOverride', () => {
    beforeEach(() => {
      store.setToken('mock_token', { workspaceId: 'workspace_123' });
      store.updateOverride('user_1', 'capacity', 6);
      store.updateOverride('user_1', 'multiplier', 2);
    });

    it('should return user overrides', () => {
      const override = store.getUserOverride('user_1');

      expect(override).toEqual({
        capacity: 6,
        multiplier: 2
      });
    });

    it('should return empty object for user without overrides', () => {
      const override = store.getUserOverride('user_2');

      expect(override).toEqual({});
    });

    it('should return direct reference to stored object', () => {
      const override1 = store.getUserOverride('user_1');
      override1.newField = 'value';

      const override2 = store.getUserOverride('user_1');
      expect(override2.newField).toBe('value');
    });
  });

  describe('resetApiStatus', () => {
    it('should reset all API status counters to zero', () => {
      store.apiStatus.profilesFailed = 5;
      store.apiStatus.holidaysFailed = 3;
      store.apiStatus.timeOffFailed = 2;

      store.resetApiStatus();

      expect(store.apiStatus).toEqual({
        profilesFailed: 0,
        holidaysFailed: 0,
        timeOffFailed: 0
      });
    });
  });

  describe('Data Map Operations', () => {
    it('should allow adding to profiles map', () => {
      const profile = { workCapacityHours: 8, workingDays: ['MONDAY'] };
      store.profiles.set('user_1', profile);

      expect(store.profiles.get('user_1')).toEqual(profile);
      expect(store.profiles.size).toBe(1);
    });

    it('should allow adding to holidays map', () => {
      const holidayMap = new Map();
      holidayMap.set('2025-01-01', { name: 'New Year' });
      store.holidays.set('user_1', holidayMap);

      expect(store.holidays.get('user_1')).toEqual(holidayMap);
    });

    it('should allow adding to timeOff map', () => {
      const timeOffMap = new Map();
      timeOffMap.set('2025-01-15', { isFullDay: true });
      store.timeOff.set('user_1', timeOffMap);

      expect(store.timeOff.get('user_1')).toEqual(timeOffMap);
    });

    it('should allow storing raw entries', () => {
      const entries = [{ id: 'entry_1' }, { id: 'entry_2' }];
      store.rawEntries = entries;

      expect(store.rawEntries).toEqual(entries);
      expect(store.rawEntries).toHaveLength(2);
    });

    it('should allow storing analysis results', () => {
      const results = [{ userId: 'user_1', totals: {} }];
      store.analysisResults = results;

      expect(store.analysisResults).toEqual(results);
    });
  });

  describe('Config Updates', () => {
    it('should allow updating config flags', () => {
      store.config.useProfileCapacity = false;
      expect(store.config.useProfileCapacity).toBe(false);
    });

    it('should allow updating calculation parameters', () => {
      store.calcParams.dailyThreshold = 7;
      store.calcParams.overtimeMultiplier = 2.0;

      expect(store.calcParams.dailyThreshold).toBe(7);
      expect(store.calcParams.overtimeMultiplier).toBe(2.0);
    });
  });

  describe('Per-Day Overrides', () => {
    beforeEach(() => {
      store.setToken('mock_token', { workspaceId: 'workspace_123' });
    });

    describe('setOverrideMode', () => {
      it('should set override mode to perDay', () => {
        store.setOverrideMode('user1', 'perDay');
        expect(store.overrides.user1.mode).toBe('perDay');
        expect(store.overrides.user1.perDayOverrides).toEqual({});
      });

      it('should set override mode to global', () => {
        store.setOverrideMode('user1', 'global');
        expect(store.overrides.user1.mode).toBe('global');
      });

      it('should reject invalid mode', () => {
        const result = store.setOverrideMode('user1', 'invalid');
        expect(result).toBe(false);
        expect(store.overrides.user1).toBeUndefined();
      });

      it('should initialize perDayOverrides when switching to perDay mode', () => {
        store.setOverrideMode('user1', 'perDay');
        expect(store.overrides.user1.perDayOverrides).toBeDefined();
        expect(store.overrides.user1.perDayOverrides).toEqual({});
      });

      it('should persist mode to localStorage', () => {
        store.setOverrideMode('user1', 'perDay');

        const saved = localStorage.getItem(
          `${STORAGE_KEYS.OVERRIDES_PREFIX}workspace_123`
        );
        const parsed = JSON.parse(saved);

        expect(parsed.user1.mode).toBe('perDay');
      });
    });

    describe('updatePerDayOverride', () => {
      beforeEach(() => {
        store.setOverrideMode('user1', 'perDay');
      });

      it('should set per-day capacity override', () => {
        store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 6);

        expect(store.overrides.user1.perDayOverrides['2025-01-15'].capacity).toBe(6);
      });

      it('should set per-day multiplier override', () => {
        store.updatePerDayOverride('user1', '2025-01-15', 'multiplier', 2.5);

        expect(store.overrides.user1.perDayOverrides['2025-01-15'].multiplier).toBe(2.5);
      });

      it('should set multiple per-day overrides', () => {
        store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 6);
        store.updatePerDayOverride('user1', '2025-01-15', 'multiplier', 2);

        expect(store.overrides.user1.perDayOverrides['2025-01-15']).toEqual({
          capacity: 6,
          multiplier: 2
        });
      });

      it('should handle multiple dates', () => {
        store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 6);
        store.updatePerDayOverride('user1', '2025-01-16', 'capacity', 4);

        expect(store.overrides.user1.perDayOverrides['2025-01-15'].capacity).toBe(6);
        expect(store.overrides.user1.perDayOverrides['2025-01-16'].capacity).toBe(4);
      });

      it('should validate capacity constraints', () => {
        const result = store.updatePerDayOverride('user1', '2025-01-15', 'capacity', -5);
        expect(result).toBe(false);
      });

      it('should validate multiplier constraints', () => {
        const result = store.updatePerDayOverride('user1', '2025-01-15', 'multiplier', 0.5);
        expect(result).toBe(false);
      });

      it('should reject NaN values', () => {
        const result = store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 'invalid');
        expect(result).toBe(false);
      });

      it('should cleanup empty per-day entries', () => {
        store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 6);
        store.updatePerDayOverride('user1', '2025-01-15', 'capacity', '');

        expect(store.overrides.user1.perDayOverrides['2025-01-15']).toBeUndefined();
      });

      it('should persist per-day overrides to localStorage', () => {
        store.updatePerDayOverride('user1', '2025-01-15', 'capacity', 4);

        const saved = localStorage.getItem(
          `${STORAGE_KEYS.OVERRIDES_PREFIX}workspace_123`
        );
        const parsed = JSON.parse(saved);

        expect(parsed.user1.mode).toBe('perDay');
        expect(parsed.user1.perDayOverrides['2025-01-15'].capacity).toBe(4);
      });

      it('should initialize user override if not exists', () => {
        store.updatePerDayOverride('user2', '2025-01-15', 'capacity', 5);

        expect(store.overrides.user2.mode).toBe('perDay');
        expect(store.overrides.user2.perDayOverrides['2025-01-15'].capacity).toBe(5);
      });
    });

    describe('copyGlobalToPerDay', () => {
      beforeEach(() => {
        store.updateOverride('user1', 'capacity', 8);
        store.updateOverride('user1', 'multiplier', 1.5);
        store.setOverrideMode('user1', 'perDay');
      });

      it('should copy global values to all days in range', () => {
        const dates = ['2025-01-15', '2025-01-16', '2025-01-17'];
        store.copyGlobalToPerDay('user1', dates);

        dates.forEach(dateKey => {
          expect(store.overrides.user1.perDayOverrides[dateKey].capacity).toBe(8);
          expect(store.overrides.user1.perDayOverrides[dateKey].multiplier).toBe(1.5);
        });
      });

      it('should return false if user not in perDay mode', () => {
        store.setOverrideMode('user2', 'global');
        const result = store.copyGlobalToPerDay('user2', ['2025-01-15']);

        expect(result).toBe(false);
      });

      it('should return false if no dates provided', () => {
        const result = store.copyGlobalToPerDay('user1', []);

        expect(result).toBe(false);
      });

      it('should handle missing global capacity', () => {
        store.updateOverride('user3', 'multiplier', 2);
        store.setOverrideMode('user3', 'perDay');

        const dates = ['2025-01-15'];
        store.copyGlobalToPerDay('user3', dates);

        expect(store.overrides.user3.perDayOverrides['2025-01-15'].multiplier).toBe(2);
        expect(store.overrides.user3.perDayOverrides['2025-01-15'].capacity).toBeUndefined();
      });

      it('should persist copied values to localStorage', () => {
        const dates = ['2025-01-15', '2025-01-16'];
        store.copyGlobalToPerDay('user1', dates);

        const saved = localStorage.getItem(
          `${STORAGE_KEYS.OVERRIDES_PREFIX}workspace_123`
        );
        const parsed = JSON.parse(saved);

        expect(parsed.user1.perDayOverrides['2025-01-15'].capacity).toBe(8);
        expect(parsed.user1.perDayOverrides['2025-01-16'].capacity).toBe(8);
      });
    });
  });
});
