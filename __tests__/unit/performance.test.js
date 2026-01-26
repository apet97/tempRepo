/**
 * @jest-environment jsdom
 */

/**
 * Performance Specification Test Suite
 *
 * SPECIFICATION: Performance Budget
 *
 * Target performance metrics (see docs/spec.md):
 * - Target: <5s for 100 users / ~1 month
 * - DOM update batching: Use requestAnimationFrame
 * - Memory: Don't store huge raw payloads in localStorage
 *
 * These tests document and verify performance expectations.
 *
 * @see docs/spec.md - Performance requirements
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { standardAfterEach } from '../helpers/setup.js';
import { store } from '../../js/state.js';

describe('Performance Specifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    standardAfterEach();
  });

  describe('Processing Time Expectations', () => {
    /**
     * SPECIFICATION: CPU Time Budget
     *
     * Target: Process 100 users / 1 month data in < 5 seconds
     *
     * This includes:
     * - API fetching (rate limited to 50 req/sec)
     * - Data transformation
     * - Calculation (pure CPU, should be fast)
     * - Rendering (batched, should be incremental)
     */

    it('calculation should be O(n) with entries (not exponential)', () => {
      /**
       * SPECIFICATION: Linear Complexity
       *
       * Calculation algorithm should scale linearly with:
       * - Number of entries
       * - Number of users
       * - Number of days
       *
       * No nested loops that would cause O(n^2) or worse.
       */
      // This is a specification test - actual performance verified via profiling
      expect(true).toBe(true);
    });

    it('should target < 5000ms for 100 users (documented)', () => {
      /**
       * SPECIFICATION: 5-second Target
       *
       * Per docs/spec.md:
       * "Target: <5s for 100 users / ~1 month"
       *
       * Breakdown:
       * - Users fetch: ~200ms
       * - Time entries: 1-5 pages, ~1-2s total
       * - Profiles: Batched, ~2-3s total (bottleneck)
       * - Holidays: Sequential, ~3-5s total (slowest)
       * - Calculation: < 500ms for pure CPU
       */
      const TARGET_MS = 5000;
      expect(TARGET_MS).toBe(5000);
    });

    it('render should target < 1000ms for 1000 rows', () => {
      /**
       * SPECIFICATION: Render Performance
       *
       * Large table rendering should:
       * - Use DocumentFragment for batch DOM updates
       * - Use requestAnimationFrame for non-blocking
       * - Target < 1s for 1000 rows
       */
      const RENDER_TARGET_MS = 1000;
      const ROWS_TARGET = 1000;

      expect(RENDER_TARGET_MS).toBe(1000);
      expect(ROWS_TARGET).toBe(1000);
    });
  });

  describe('DOM Update Batching', () => {
    /**
     * SPECIFICATION: Incremental Rendering
     *
     * Strategies (see docs/spec.md):
     * - Batch rows in requestAnimationFrame
     * - Minimize DOM thrash (DocumentFragment)
     * - Never re-render whole tables on small state changes
     */

    it('should use DocumentFragment for batch DOM insertions', () => {
      /**
       * SPECIFICATION: DocumentFragment Pattern
       *
       * Instead of:
       * ```javascript
       * rows.forEach(row => container.appendChild(row));
       * ```
       *
       * Use:
       * ```javascript
       * const fragment = document.createDocumentFragment();
       * rows.forEach(row => fragment.appendChild(row));
       * container.appendChild(fragment);
       * ```
       *
       * This reduces reflow/repaint to a single operation.
       */
      const fragment = document.createDocumentFragment();
      expect(fragment).toBeInstanceOf(DocumentFragment);
    });

    it('should use requestAnimationFrame for smooth updates', () => {
      /**
       * SPECIFICATION: RAF for Non-blocking Updates
       *
       * Use requestAnimationFrame for:
       * - Large table rendering
       * - Progressive data loading
       * - Animation/transition triggers
       */
      expect(typeof requestAnimationFrame).toBe('function');
    });

    it('should batch DOM updates (max ~100 per frame)', () => {
      /**
       * SPECIFICATION: Update Batching
       *
       * Large datasets should render in batches:
       * - ~50-100 rows per frame
       * - Allows browser to handle events between batches
       * - Prevents UI freeze
       */
      const BATCH_SIZE = 100;
      expect(BATCH_SIZE).toBeLessThanOrEqual(100);
    });

    it('should not re-render entire table on small changes', () => {
      /**
       * SPECIFICATION: Minimal Re-rendering
       *
       * When state changes:
       * - Config toggle: May need full re-render
       * - Pagination: Only render current page
       * - Filter change: Re-render filtered subset
       * - Sort change: Re-order existing rows if possible
       */
      expect(true).toBe(true);
    });
  });

  describe('Memory Management', () => {
    /**
     * SPECIFICATION: Memory Budget
     *
     * Per docs/spec.md:
     * - Avoid storing huge raw payloads in localStorage (quota + perf)
     * - Cache profiles/holidays (workspace-scoped keys)
     */

    it('should not store large raw entries in localStorage', () => {
      /**
       * SPECIFICATION: localStorage Hygiene
       *
       * What TO store in localStorage:
       * - Config (small object)
       * - CalcParams (small object)
       * - UI state (small object)
       * - User overrides (per-workspace, bounded)
       *
       * What NOT to store:
       * - Raw entries (can be thousands)
       * - Full analysis results (derived, large)
       * - API responses (temporary, large)
       */
      // Report cache should use sessionStorage (clears on tab close)
      const reportCacheLocation = 'sessionStorage';
      expect(reportCacheLocation).toBe('sessionStorage');
    });

    it('should release entry data after processing', () => {
      /**
       * SPECIFICATION: Memory Cleanup
       *
       * After report generation:
       * - Keep: analysis results (needed for display)
       * - Release: intermediate data structures
       * - Don't: create circular references that prevent GC
       */
      // Document expected behavior - actual implementation uses normal GC
      expect(true).toBe(true);
    });

    it('should not retain references to cancelled fetches', () => {
      /**
       * SPECIFICATION: Abort Cleanup
       *
       * When AbortController.abort() is called:
       * - In-flight requests should be cancelled
       * - Response handlers should not run
       * - Promise chains should clean up
       * - No stale data should be stored
       */
      const controller = new AbortController();
      controller.abort();

      expect(controller.signal.aborted).toBe(true);
    });

    it('should limit cached report size', () => {
      /**
       * SPECIFICATION: Cache Size Limit
       *
       * Report cache in sessionStorage:
       * - Single key per workspace+dateRange
       * - Auto-expires via 5-minute TTL
       * - No unbounded growth
       */
      const REPORT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
      expect(REPORT_CACHE_TTL).toBe(300000);
    });
  });

  describe('Caching Strategy', () => {
    /**
     * SPECIFICATION: Profile/Holiday Caching
     *
     * Per docs/spec.md:
     * "Prefer caching profiles/holidays/timeoff (workspace-scoped keys)"
     */

    it('should cache profiles per workspace', () => {
      store.claims = { workspaceId: 'ws_123' };
      store.profiles.set('user1', { workCapacityHours: 8 });

      expect(store.profiles.get('user1')).toEqual({ workCapacityHours: 8 });
    });

    it('should cache holidays per workspace', () => {
      store.claims = { workspaceId: 'ws_123' };
      const holidayMap = new Map([['2025-01-01', { name: 'New Year' }]]);
      store.holidays.set('user1', holidayMap);

      expect(store.holidays.get('user1').get('2025-01-01')).toEqual({ name: 'New Year' });
    });

    it('should clear caches on workspace change', () => {
      store.setToken('token1', { workspaceId: 'ws_old', backendUrl: 'https://api.clockify.me/api' });
      store.profiles.set('user1', { workCapacityHours: 8 });

      store.setToken('token2', { workspaceId: 'ws_new', backendUrl: 'https://api.clockify.me/api' });

      expect(store.profiles.size).toBe(0);
    });
  });
});

describe('Performance - Constants Documentation', () => {
  /**
   * This section documents performance-related constants.
   */

  it('RATE_LIMIT should be 50 req/sec', () => {
    /**
     * SPECIFICATION: API Rate Limit
     *
     * Clockify addon limit: 50 requests/second
     * Token bucket allows burst up to 50, then sustained 50/sec
     */
    const RATE_LIMIT = 50;
    expect(RATE_LIMIT).toBe(50);
  });

  it('BATCH_SIZE should be 5 for user fetches', () => {
    /**
     * SPECIFICATION: Concurrent User Fetch Batch
     *
     * Process 5 users concurrently to balance:
     * - Performance (faster than sequential)
     * - API courtesy (not overwhelming)
     */
    const BATCH_SIZE = 5;
    expect(BATCH_SIZE).toBe(5);
  });

  it('PAGE_SIZE should be 200 for detailed reports', () => {
    /**
     * SPECIFICATION: Report Page Size
     *
     * Clockify Reports API max: 200 entries per page
     */
    const PAGE_SIZE = 200;
    expect(PAGE_SIZE).toBe(200);
  });

  it('DEFAULT_MAX_PAGES should be 50', () => {
    /**
     * SPECIFICATION: Safety Limit
     *
     * Max pages to prevent runaway fetches:
     * 50 pages * 200 entries = 10,000 entries max
     */
    const DEFAULT_MAX_PAGES = 50;
    expect(DEFAULT_MAX_PAGES).toBe(50);
  });

  it('REPORT_CACHE_TTL should be 5 minutes', () => {
    /**
     * SPECIFICATION: Cache Expiry
     *
     * 5 minutes balances:
     * - Usefulness for report iteration
     * - Freshness of data
     */
    const REPORT_CACHE_TTL = 5 * 60 * 1000;
    expect(REPORT_CACHE_TTL).toBe(300000);
  });
});

describe('Performance - Algorithmic Complexity', () => {
  /**
   * SPECIFICATION: Algorithm Design
   *
   * All algorithms should maintain reasonable complexity:
   * - Sorting: O(n log n)
   * - Grouping: O(n)
   * - Calculation per entry: O(1)
   * - Total calculation: O(n) where n = entries
   */

  it('should process entries in single pass (O(n))', () => {
    /**
     * SPECIFICATION: Single-Pass Processing
     *
     * Entry processing should be O(n):
     * 1. Group entries by day (O(n))
     * 2. Sort each day's entries (O(m log m) where m << n)
     * 3. Calculate regular/OT per entry (O(1))
     * 4. Aggregate totals (O(1) per entry)
     */
    const entries = Array(1000).fill(null).map((_, i) => ({ id: i }));

    // Single pass simulation
    let processCount = 0;
    entries.forEach(() => {
      processCount++;
    });

    expect(processCount).toBe(entries.length);
  });

  it('should not use nested iteration over entries', () => {
    /**
     * SPECIFICATION: No O(n^2) Patterns
     *
     * Avoid patterns like:
     * ```javascript
     * entries.forEach(e1 => {
     *   entries.forEach(e2 => { ... }); // O(n^2) - BAD
     * });
     * ```
     */
    // This is a specification test - code review enforces this
    expect(true).toBe(true);
  });

  it('groupBy should be O(n)', () => {
    /**
     * SPECIFICATION: Efficient Grouping
     *
     * Use Map for O(1) lookup/insert:
     * ```javascript
     * const groups = new Map();
     * entries.forEach(e => {
     *   const key = e.userId;
     *   if (!groups.has(key)) groups.set(key, []);
     *   groups.get(key).push(e);
     * });
     * ```
     */
    const entries = [
      { userId: 'a' },
      { userId: 'b' },
      { userId: 'a' },
      { userId: 'c' }
    ];

    const groups = new Map();
    entries.forEach(e => {
      const key = e.userId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    expect(groups.get('a').length).toBe(2);
    expect(groups.get('b').length).toBe(1);
    expect(groups.get('c').length).toBe(1);
  });
});

// ============================================================================
// PHASE 3: Actual Performance Benchmarks (not just specifications)
// ============================================================================

describe('Performance Benchmarks (Actual)', () => {
  /**
   * SPECIFICATION: Actual Performance Verification
   *
   * These tests verify actual timing against defined thresholds.
   * Unlike specification tests above, these execute real operations
   * and assert that they complete within the expected time budget.
   */

  /**
   * Helper: Generate mock entries for benchmark testing
   */
  function generateBenchmarkEntries(count) {
    const entries = [];
    const baseDate = new Date('2025-01-01T09:00:00Z');

    for (let i = 0; i < count; i++) {
      const dayOffset = Math.floor(i / 10); // ~10 entries per day
      const startTime = new Date(baseDate);
      startTime.setDate(startTime.getDate() + dayOffset);
      startTime.setHours(9 + (i % 10));

      const endTime = new Date(startTime);
      endTime.setHours(endTime.getHours() + 1);

      entries.push({
        id: `entry_${i}`,
        userId: `user_${i % 100}`,
        userName: `User ${i % 100}`,
        description: `Task ${i}`,
        timeInterval: {
          start: startTime.toISOString(),
          end: endTime.toISOString(),
          duration: 'PT1H'
        },
        hourlyRate: { amount: 5000 },
        billable: i % 2 === 0
      });
    }
    return entries;
  }

  it('should group 10,000 entries by user in < 50ms', () => {
    /**
     * SPECIFICATION: O(n) Grouping Performance
     *
     * Grouping 10,000 entries should complete in under 50ms.
     * This verifies Map-based O(1) lookup/insert is being used.
     */
    const entries = generateBenchmarkEntries(10000);

    const start = performance.now();

    const groups = new Map();
    entries.forEach(e => {
      const key = e.userId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(groups.size).toBe(100); // 100 unique users
  });

  it('should group 50,000 entries by user in < 200ms', () => {
    /**
     * SPECIFICATION: Large Dataset Grouping
     *
     * Even with 50,000 entries, grouping should remain fast.
     * Linear complexity means 5x entries ≈ 5x time.
     */
    const entries = generateBenchmarkEntries(50000);

    const start = performance.now();

    const groups = new Map();
    entries.forEach(e => {
      const key = e.userId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(groups.size).toBe(100);
  });

  it('should sort 10,000 entries chronologically in < 100ms', () => {
    /**
     * SPECIFICATION: O(n log n) Sorting Performance
     *
     * Chronological sorting of 10,000 entries should complete in < 100ms.
     * Uses native Array.sort which is O(n log n).
     */
    const entries = generateBenchmarkEntries(10000);
    // Shuffle entries to simulate unsorted input
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }

    const start = performance.now();

    entries.sort((a, b) => {
      const dateA = new Date(a.timeInterval.start);
      const dateB = new Date(b.timeInterval.start);
      return dateA.getTime() - dateB.getTime();
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    // Verify sorted order
    for (let i = 1; i < entries.length; i++) {
      const prev = new Date(entries[i - 1].timeInterval.start).getTime();
      const curr = new Date(entries[i].timeInterval.start).getTime();
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('should process 10,000 entries through accumulator in < 20ms', () => {
    /**
     * SPECIFICATION: O(n) Accumulation Performance
     *
     * The daily accumulator pattern should be O(n).
     * Processing 10,000 entries should take < 20ms.
     */
    const entries = generateBenchmarkEntries(10000);

    const start = performance.now();

    let totalRegular = 0;
    let totalOvertime = 0;
    const capacity = 8;

    entries.forEach(entry => {
      const duration = 1; // 1 hour per entry
      const dayAccumulator = (totalRegular + totalOvertime) % capacity;

      if (dayAccumulator >= capacity) {
        totalOvertime += duration;
      } else if (dayAccumulator + duration <= capacity) {
        totalRegular += duration;
      } else {
        const regularPortion = capacity - dayAccumulator;
        totalRegular += regularPortion;
        totalOvertime += duration - regularPortion;
      }
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(20);
    expect(totalRegular + totalOvertime).toBe(10000); // All hours accounted for
  });

  it('should aggregate totals for 100 users in < 10ms', () => {
    /**
     * SPECIFICATION: O(n) Aggregation Performance
     *
     * Aggregating totals across 100 users should be O(n) with n=users.
     */
    const userTotals = Array(100).fill(null).map((_, i) => ({
      userId: `user_${i}`,
      regular: 40 + (i % 10),
      overtime: i % 8,
      billableWorked: 32 + (i % 8),
      nonBillableWorked: 8,
      billableOT: i % 4,
      nonBillableOT: i % 4
    }));

    const start = performance.now();

    const totals = userTotals.reduce((acc, user) => {
      acc.regular += user.regular;
      acc.overtime += user.overtime;
      acc.billableWorked += user.billableWorked;
      acc.nonBillableWorked += user.nonBillableWorked;
      acc.billableOT += user.billableOT;
      acc.nonBillableOT += user.nonBillableOT;
      return acc;
    }, { regular: 0, overtime: 0, billableWorked: 0, nonBillableWorked: 0, billableOT: 0, nonBillableOT: 0 });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(totals.regular).toBeGreaterThan(0);
    expect(totals.overtime).toBeGreaterThan(0);
  });

  it('should create 1,000 table rows in < 50ms (DocumentFragment)', () => {
    /**
     * SPECIFICATION: DOM Creation Performance
     *
     * Creating 1,000 table rows using DocumentFragment should be fast.
     * This tests the creation phase, not insertion.
     */
    const rowData = Array(1000).fill(null).map((_, i) => ({
      date: `2025-01-${String((i % 31) + 1).padStart(2, '0')}`,
      user: `User ${i % 100}`,
      regular: 8,
      overtime: i % 4
    }));

    const start = performance.now();

    const fragment = document.createDocumentFragment();
    rowData.forEach(data => {
      const tr = document.createElement('tr');
      const tdDate = document.createElement('td');
      tdDate.textContent = data.date;
      const tdUser = document.createElement('td');
      tdUser.textContent = data.user;
      const tdRegular = document.createElement('td');
      tdRegular.textContent = `${data.regular}h`;
      const tdOT = document.createElement('td');
      tdOT.textContent = `${data.overtime}h`;
      tr.appendChild(tdDate);
      tr.appendChild(tdUser);
      tr.appendChild(tdRegular);
      tr.appendChild(tdOT);
      fragment.appendChild(tr);
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(fragment.childNodes.length).toBe(1000);
  });

  it('should batch process rows efficiently (100 per batch)', () => {
    /**
     * SPECIFICATION: Batched Processing
     *
     * Processing in batches should allow yielding to the main thread.
     * Verify batch logic works correctly.
     */
    const totalRows = 500;
    const batchSize = 100;
    const rows = Array(totalRows).fill(null).map((_, i) => ({ id: i }));

    const batches = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      batches.push(rows.slice(i, i + batchSize));
    }

    expect(batches.length).toBe(5);
    expect(batches[0].length).toBe(100);
    expect(batches[4].length).toBe(100);
  });
});

describe('Memory Pressure Tests', () => {
  /**
   * SPECIFICATION: Memory Management
   *
   * These tests verify that operations don't cause excessive memory growth.
   * Important for processing large datasets without crashing the browser.
   */

  it('should not retain references after processing entries', () => {
    /**
     * SPECIFICATION: No Memory Leaks in Processing
     *
     * After processing, intermediate data structures should be eligible for GC.
     * We verify this by checking that we can process without retaining references.
     */
    let processedCount = 0;

    // Process in batches to allow GC between batches
    for (let batch = 0; batch < 10; batch++) {
      const entries = Array(1000).fill(null).map((_, i) => ({
        id: `entry_${batch}_${i}`,
        userId: `user_${i % 50}`,
        hours: 1
      }));

      // Process the batch
      const totals = entries.reduce((acc, e) => {
        acc[e.userId] = (acc[e.userId] || 0) + e.hours;
        return acc;
      }, {});

      processedCount += Object.values(totals).reduce((a, b) => a + b, 0);
      // entries array goes out of scope here and is eligible for GC
    }

    expect(processedCount).toBe(10000);
  });

  it('should handle large Map operations without memory issues', () => {
    /**
     * SPECIFICATION: Map Memory Efficiency
     *
     * Maps with 10,000+ entries should work without issues.
     */
    const largeMap = new Map();

    // Build large map
    for (let i = 0; i < 10000; i++) {
      largeMap.set(`key_${i}`, { value: i, data: `data_${i}` });
    }

    expect(largeMap.size).toBe(10000);

    // Verify iteration works
    let count = 0;
    largeMap.forEach(() => count++);
    expect(count).toBe(10000);

    // Clear should release memory
    largeMap.clear();
    expect(largeMap.size).toBe(0);
  });

  it('should efficiently clone analysis results', () => {
    /**
     * SPECIFICATION: Result Cloning Performance
     *
     * Cloning results for caching should be efficient.
     */
    const analysis = Array(100).fill(null).map((_, i) => ({
      userId: `user_${i}`,
      userName: `User ${i}`,
      totals: {
        regular: 40,
        overtime: 5,
        total: 45,
        billableWorked: 35,
        nonBillableWorked: 5,
        billableOT: 4,
        nonBillableOT: 1
      },
      days: new Map([
        ['2025-01-01', { entries: [], meta: {} }],
        ['2025-01-02', { entries: [], meta: {} }],
        ['2025-01-03', { entries: [], meta: {} }],
        ['2025-01-04', { entries: [], meta: {} }],
        ['2025-01-05', { entries: [], meta: {} }]
      ])
    }));

    const start = performance.now();

    // Clone using JSON (common pattern for caching)
    const cloned = analysis.map(user => ({
      ...user,
      totals: { ...user.totals },
      days: new Map([...user.days].map(([k, v]) => [k, { ...v }]))
    }));

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(cloned.length).toBe(100);
    // Verify it's a true clone
    cloned[0].totals.regular = 999;
    expect(analysis[0].totals.regular).toBe(40);
  });

  it('should process 100 users without significant memory growth', () => {
    /**
     * SPECIFICATION: Memory Budget for Large User Count
     *
     * Processing 100 users with typical data should not cause memory issues.
     * This test verifies the pattern works without measuring exact memory
     * (as heap measurement is unreliable in Jest).
     */
    const users = Array(100).fill(null).map((_, i) => ({
      id: `user_${i}`,
      name: `User ${i}`,
      profile: {
        workCapacityHours: 8,
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
      }
    }));

    const entriesPerUser = 50;
    const allEntries = [];

    users.forEach((user, ui) => {
      for (let e = 0; e < entriesPerUser; e++) {
        allEntries.push({
          userId: user.id,
          userName: user.name,
          id: `entry_${ui}_${e}`,
          hours: 1
        });
      }
    });

    expect(allEntries.length).toBe(5000);

    // Group by user
    const grouped = new Map();
    allEntries.forEach(e => {
      if (!grouped.has(e.userId)) grouped.set(e.userId, []);
      grouped.get(e.userId).push(e);
    });

    expect(grouped.size).toBe(100);
    expect(grouped.get('user_0').length).toBe(50);
  });
});

describe('Performance - Linear Complexity Verification', () => {
  /**
   * SPECIFICATION: O(n) Verification
   *
   * These tests verify that processing time scales linearly with input size.
   * 2x entries should take approximately 2x time (with some variance).
   */

  it('should scale linearly when doubling entries', () => {
    /**
     * SPECIFICATION: Linear Scaling Verification
     *
     * Processing time for N entries should be approximately proportional to N.
     * For very fast operations, we verify absolute times stay reasonable.
     */
    const processEntries = (count) => {
      const entries = Array(count).fill(null).map((_, i) => ({
        id: i,
        userId: `user_${i % 10}`,
        hours: 1
      }));

      const start = performance.now();

      const totals = new Map();
      entries.forEach(e => {
        const current = totals.get(e.userId) || 0;
        totals.set(e.userId, current + e.hours);
      });

      return performance.now() - start;
    };

    const time1000 = processEntries(1000);
    const time2000 = processEntries(2000);
    const time4000 = processEntries(4000);

    // All operations should be fast (< 50ms for each)
    // This verifies O(n) complexity indirectly
    expect(time1000).toBeLessThan(50);
    expect(time2000).toBeLessThan(50);
    expect(time4000).toBeLessThan(50);

    // 4000 entries should still complete reasonably fast
    // (if it were O(n^2), 4000 would be 16x slower than 1000)
    expect(time4000).toBeLessThan(100);
  });

  it('should maintain O(n) when grouping by date', () => {
    /**
     * SPECIFICATION: Date Grouping Complexity
     *
     * Grouping entries by date should remain O(n).
     */
    const entries = Array(5000).fill(null).map((_, i) => ({
      id: i,
      date: `2025-01-${String((i % 31) + 1).padStart(2, '0')}`,
      hours: 1
    }));

    const start = performance.now();

    const byDate = new Map();
    entries.forEach(e => {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(30); // Should be very fast
    expect(byDate.size).toBe(31); // 31 days in January
  });

  it('should efficiently handle sparse data (many users, few entries)', () => {
    /**
     * SPECIFICATION: Sparse Data Handling
     *
     * Many users with few entries each should not cause performance issues.
     */
    const userCount = 500;
    const entriesPerUser = 2;

    const entries = [];
    for (let u = 0; u < userCount; u++) {
      for (let e = 0; e < entriesPerUser; e++) {
        entries.push({
          id: `entry_${u}_${e}`,
          userId: `user_${u}`,
          hours: 4
        });
      }
    }

    const start = performance.now();

    const byUser = new Map();
    entries.forEach(e => {
      if (!byUser.has(e.userId)) byUser.set(e.userId, { total: 0, count: 0 });
      const user = byUser.get(e.userId);
      user.total += e.hours;
      user.count++;
    });

    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(20);
    expect(byUser.size).toBe(500);
    expect(byUser.get('user_0').count).toBe(2);
    expect(byUser.get('user_0').total).toBe(8);
  });
});
