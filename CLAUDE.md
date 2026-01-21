# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# OTPLUS (Clockify Overtime Addon)
See `docs/adr/README.md` for architecture decisions, `docs/spec.md` for technical details, `docs/prd.md` for product rules, and `docs/guide.md` for the operational summary of what the addon consumes plus every Clockify API call it makes.

## One-line goal
Maintain and improve OTPLUS: a read-only Clockify addon that generates accurate overtime + billable/non-billable reports, at scale (100+ users), with deterministic calculations and strong safety guarantees.

## Golden rules (do not break)
- **Read-only forever**: never add POST/PATCH/DELETE against Clockify APIs.
- **No secrets**: never log, persist, or commit auth tokens, workspace IDs, or user emails.
- **Deterministic math**: same inputs => same outputs; avoid hidden time zone drift.
- **Calculation invariants are tests**: if results change, update tests or revert.

## Repo shape (modules you must respect)
- `js/main.js` — controller/orchestrator (fetch -> compute -> render)
- `js/api.js` — Clockify API client (pagination, concurrency, retries, rate limiting)
- `js/state.js` — centralized Store + persistence (localStorage, UI state, diagnostics)
- `js/calc.js` — pure calculation engine (no DOM, no fetch)
- `js/export.js` — CSV export + sanitization
- `js/ui.js` — rendering (DocumentFragment, incremental updates for big datasets)
- `js/utils.js` — date keys, parsing (ISO duration), rounding, escaping
- `js/constants.js` — shared constants/flags/defaults
- `index.html`, `css/styles.css`, `manifest.json`

## UI conventions (current)
- Detailed table columns: `Date`, `Start`, `End`, `User`, `Regular`, `Overtime`, `Billable`, `Rate $/h`, `Regular $`, `OT $`, `T2 $`, `Total $`, `Status`.
- Status replaces Tags and shows system badges (HOLIDAY/OFF-DAY/TIME-OFF/BREAK) plus entry tags.
- Description column is intentionally omitted to keep the table readable.
- `config.showDecimalTime` switches display formatting only (no calculation changes).

## Commands
- Run all tests: `npm test`
- Run single test file: `npm test -- __tests__/unit/calc.test.js`
- Run tests matching pattern: `npm test -- --testNamePattern="overtime"`
- Watch mode: `npm run test:watch`
- Coverage report: `npm run test:coverage` (enforces 80% threshold)

If adding new tooling (lint/e2e), add it as an npm script and document here.

## Clockify API constraints (critical)
- Auth: token comes from `auth_token` URL param and is sent as `X-Addon-Token`.
- Rate limiting: keep total request rate **<= documented addon limits**; handle `429` with backoff and retry.
- Always pass an `AbortSignal` from the controller so report generation can be cancelled.

## Data flow (high-level)
1. Controller reads range + config from Store.
2. Fetch workspace users.
3. Fetch time entries (paginated), and per-user profile + holidays (+ time off if enabled).
4. Normalize entries into day-buckets by **dateKey** (timezone-consistent).
5. Run calc engine to produce:
   - user summaries
   - group summaries (project/client/task/week)
   - detail rows (per-entry with regular/OT split)
6. Render progressively; export uses computed results (never raw unescaped fields).

> **Pro tip:** `docs/guide.md` restates this flow alongside the exact APIs and storage keys, so link it when onboarding or debugging ingestion issues.

## Calculation rules (do not change without updating tests)
### Capacity precedence (per user, per day)
`overrideCapacity ?? profileCapacity ?? globalDailyThreshold`

### Effective capacity adjustments
- If weekday not in `workingDays` => effective capacity = 0 (all work is OT that day).
- If holiday => effective capacity = 0 (all work is OT that day).
- If time off exists (when enabled): reduce effective capacity (or zero for full-day), but do not override “holiday” or “non-working day” zero-capacity rules.

### Overtime split (daily mode)
- Group entries by day.
- Sort by start timestamp.
- Apply “tail attribution”: hours beyond effective capacity are OT and assigned to the tail of the day, splitting entries when needed.

### Billable split
- Preserve the original `billable` flag.
- Compute billable/non-billable totals for worked + OT based on per-entry `regularHours/overtimeHours`.

### Rounding
- Round durations consistently (e.g., 4 decimals) at the *aggregation boundary* to avoid drift.

### Midnight-spanning entries (explicit rule)
- If the codebase implements splitting: split entries at day boundary before bucketing.
- If not implemented: document the limitation clearly and keep behavior consistent.

## Overtime Calculation Guide (Detailed Report)

### Data Source
- Uses Clockify **Reports API** (`/v1/workspaces/{id}/reports/detailed`)
- NOT the standard time-entries API
- Pagination: 200 entries per page, max 50 pages (safety limit)
- Returns enriched entries with billable flags, rates, project/client/task info

### Entry Classification

Entries are classified into 3 types for overtime purposes:

| Entry Type | Classification | Counts as Regular? | Triggers OT for Other Entries? | Can Be OT? |
|------------|----------------|-------------------|-------------------------------|-----------|
| `type === 'BREAK'` | **BREAK** | ✅ YES (duration) | ❌ NO | ❌ NO |
| `type === 'HOLIDAY'` | **PTO** | ✅ YES (duration) | ❌ NO | ❌ NO |
| `type === 'TIME_OFF'` | **PTO** | ✅ YES (duration) | ❌ NO | ❌ NO |
| All others (including `'REGULAR'`) | **WORK** | Varies (tail attribution) | ✅ YES | ✅ YES |

**Critical Rule**: BREAK and PTO entries:
- Count as regular hours in totals
- NEVER become overtime themselves
- NEVER trigger overtime for other entries (don't accumulate toward capacity)
- Still contribute to billable/non-billable breakdown if flagged as billable

### Effective Capacity Calculation

**Precedence** (per user, per day):
1. Per-day user override (`overrides[userId].perDayOverrides[dateKey].capacity`)
2. Global user override (`overrides[userId].capacity`)
3. Profile capacity (`profiles.get(userId).workCapacityHours`) — if `useProfileCapacity` enabled
4. Global daily threshold (`calcParams.dailyThreshold`, default 8h)

**Adjustments**:
- **Non-working day** (per profile `workingDays`): capacity → 0
- **Holiday**: capacity → 0
- **Time-off**: capacity → max(0, capacity - timeOffHours)
  - Full-day time-off: capacity → 0
  - Half-day: reduced by half
  - Hourly: reduced by hours

**Precedence for Anomalies**:
- Holiday takes precedence over time-off (both result in 0 capacity)
- Non-working day takes precedence over time-off

### Day Context Detection

**Dual-source detection** (fallback mechanism):
1. **Primary**: API-derived Maps (from holiday/time-off API endpoints)
2. **Fallback**: Entry type detection from Detailed Report entries

**Holiday Detection**:
- If `applyHolidays` enabled AND holiday API returns data → use API Map
- OR if `applyHolidays` **disabled** AND any entry has `type === 'HOLIDAY'` → treat as holiday day
- Result: capacity = 0 for WORK entries (all WORK is overtime)

**Time-Off Detection**:
- If `applyTimeOff` enabled AND time-off API returns data → use API Map
- OR if `applyTimeOff` **disabled** AND any entry has `type === 'TIME_OFF'` → sum durations, reduce capacity
- Result: capacity reduced by time-off hours

**Why dual-source?**
- Graceful degradation if API fetch fails or is disabled
- Ensures correct overtime even with partial data
- **Only activates when API is disabled** to avoid conflicts

### Tail Attribution Algorithm

For each day:
1. Sort all entries by `timeInterval.start` (chronological order)
2. Initialize `dailyAccumulator = 0`
3. For each entry:
   - **If BREAK or PTO**: `regular = duration, overtime = 0`, skip accumulation
   - **If WORK**:
     - If `dailyAccumulator >= capacity`: entire entry is OT (`regular = 0, overtime = duration`)
     - Else if `dailyAccumulator + duration <= capacity`: entire entry is regular (`regular = duration, overtime = 0`)
     - Else: **split entry** at capacity boundary:
       ```javascript
       regular = capacity - dailyAccumulator
       overtime = duration - regular
       ```
     - Increment `dailyAccumulator += duration`

**Example**:
- Day capacity: 8h
- Entries: [3h WORK, 2h BREAK, 5h WORK]
- Processing:
  - 3h WORK: accumulator=0, 0+3≤8 → regular=3h, overtime=0h, accumulator→3h
  - 2h BREAK: regular=2h, overtime=0h, accumulator→3h (unchanged)
  - 5h WORK: accumulator=3h, 3+5>8 → split: regular=5h, overtime=0h, accumulator→8h
- Result: regular=10h (3+2+5), overtime=0h

### Billable Breakdown

Tracks 4 independent buckets:
- `billableWorked` = sum of `entry.analysis.regular` where `entry.billable === true`
- `nonBillableWorked` = sum of `entry.analysis.regular` where `entry.billable === false`
- `billableOT` = sum of `entry.analysis.overtime` where `entry.billable === true`
- `nonBillableOT` = sum of `entry.analysis.overtime` where `entry.billable === false`

**Important**: BREAK and PTO entries contribute to worked buckets if flagged as billable, at regular rate (no premium).

### Cost Calculation

For each entry:
```javascript
const regularCost = entry.analysis.regular * (entry.hourlyRate.amount / 100);
const overtimeCost = entry.analysis.overtime * (entry.hourlyRate.amount / 100) * effectiveMultiplier;
entry.analysis.cost = regularCost + overtimeCost;
```

**Multiplier precedence**:
1. Per-day user override
2. Global user override
3. Global overtime multiplier (`calcParams.overtimeMultiplier`, default 1.5)

**OT Premium**: `(effectiveMultiplier - 1) * overtimeHours * hourlyRate`

### Rounding

- Apply `round()` at aggregation boundary (after summing totals)
- Precision: 4 decimals for hours, 2 decimals for currency
- Prevents floating-point drift across large summations

### Edge Cases

- **Midnight-spanning entries**: Attributed entirely to start day (no splitting across dates)
- **Missing rate**: Defaults to 0, no crash
- **Malformed duration**: Skipped with warning, doesn't break calculation
- **Unknown users**: Initialized with fallback profile (global defaults)
- **Empty date range**: Returns empty analysis, no error

## Performance budget (optimize safely)
- Target: <5s for 100 users / ~1 month.
- Prefer:
  - caching profiles/holidays/timeoff (workspace-scoped keys)
  - incremental rendering (batch rows; requestAnimationFrame)
  - minimizing DOM thrash (DocumentFragment)
- Avoid:
  - re-rendering whole tables on small state changes
  - storing huge raw payloads in localStorage (quota + perf)

## Error handling & diagnostics
- Distinguish: Auth vs Network vs API (429/5xx).
- “Graceful degradation”: missing profile/holiday/timeoff data must not crash report; show banner + counts.
- Provide a single “Retry failed fetches” action instead of rerunning everything.

## Security requirements
### XSS
- Treat all server-provided strings (names, project/client/task) as untrusted.
- Always escape HTML in UI output (no innerHTML without sanitization).

### CSV / Formula Injection (export)
- Prevent spreadsheet formula execution in CSV exports.
- Prefix a single quote `'` for cells that begin with any risky prefix, including:
  - `=`, `+`, `-`, `@`, tab `\t`, carriage return `\r`
- Apply the rule even when the value is quoted (e.g. starts with `"=...`).
- Export includes `TotalHoursDecimal` alongside `TotalHours` (decimal hours only).

## Work style for Claude
- Before edits: write a 5–10 step plan and identify touched files.
- Make changes in small commits; run `npm test` after each logical chunk.
- If results change: add/adjust tests in the same PR.
- Prefer pure functions + explicit inputs/outputs; keep `calc.js` side-effect free.

## When in doubt
- Read `docs/spec.md` for “what exists”.
- Read `docs/prd.md` for “what is correct”.
- Update this file when conventions change.
