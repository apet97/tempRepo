# OTPLUS Complete Knowledge Base

> **Purpose**: This document provides a complete, self-contained reference for understanding OTPLUS - the Clockify Overtime Addon. It is designed to enable anyone (including AI assistants without code access) to fully understand the project's architecture, business rules, calculation algorithms, and development practices.

**Version**: 2.1
**Last Updated**: January 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Golden Rules](#2-golden-rules)
3. [Architecture Overview](#3-architecture-overview)
4. [Module Reference](#4-module-reference)
5. [Type Definitions](#5-type-definitions)
6. [Overtime Calculation Algorithm](#6-overtime-calculation-algorithm)
7. [Clockify API Reference](#7-clockify-api-reference)
8. [State Management](#8-state-management)
9. [UI Conventions](#9-ui-conventions)
10. [Security](#10-security)
11. [Testing & Commands](#11-testing--commands)
12. [Edge Cases & Constraints](#12-edge-cases--constraints)
13. [Architecture Decision Records](#13-architecture-decision-records)

---

## 1. Project Overview

### One-Line Goal

Maintain and improve OTPLUS: a **read-only** Clockify addon that generates accurate overtime + billable/non-billable reports, at scale (100+ users), with deterministic calculations and strong safety guarantees.

### What is OTPLUS?

OTPLUS is a high-performance Clockify addon that provides advanced overtime analysis for managers and payroll administrators. It enables accurate tracking of:

- Working hours vs. overtime hours
- Capacity utilization (expected vs. actual)
- Billable/non-billable hour breakdowns
- Tiered overtime premiums (Tier 1 and Tier 2)
- Holiday and time-off compliance

### Scale Target

- **100+ users** in a single workspace
- **<5 seconds** report generation for typical workloads
- **10,000+ entries** per report (50 pages × 200 entries)

### Key Guarantees

| Guarantee | Description |
|-----------|-------------|
| **Read-Only** | Never modifies Clockify data (no POST/PATCH/DELETE) |
| **Deterministic** | Same inputs always produce the same outputs |
| **Secure** | Never logs/persists tokens, emails, or workspace IDs |
| **Auditable** | Calculation logic is testable and transparent |

### Security at a Glance

- **No PII Logging**: Tokens, emails, workspace IDs never logged or persisted
- **XSS Protected**: All user content HTML-escaped before render (`escapeHtml()`)
- **CSV Safe**: Formula injection prevented with `'` prefix on dangerous characters
- **Read-Only**: No write operations to Clockify ever (no POST/PATCH/DELETE)

---

## 2. Golden Rules

These rules must **never be broken**:

### 2.1 Read-Only Forever

```
NEVER add POST/PATCH/DELETE against Clockify APIs.
The addon is purely for reporting and analysis.
```

### 2.2 No Secrets

```
NEVER log, persist, or commit:
- Authentication tokens
- Workspace IDs (in logs)
- User email addresses
- Any PII
```

### 2.3 Deterministic Math

```
Same inputs => Same outputs
- Avoid hidden timezone drift
- Use consistent rounding (4 decimals for hours, 2 for currency)
- Calculation invariants must be tested
```

### 2.4 Calculation Invariants Are Tests

```
If calculation results change:
1. Update tests to match new expected behavior, OR
2. Revert the code change

Never silently change calculation logic.
```

---

## 3. Architecture Overview

### 3.1 Module Responsibility Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Layer (ui/)                           │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐ ┌────────┐ │
│  │ detailed │ │ summary  │ │ overrides │ │ shared │ │dialogs │ │
│  └──────────┘ └──────────┘ └───────────┘ └────────┘ └────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Controller (main.ts)                         │
│  ┌────────────────┐ ┌─────────────────┐ ┌───────────────────┐  │
│  │ Initialization │ │ Fetch Orchestr. │ │ AbortController   │  │
│  └────────────────┘ └─────────────────┘ └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐
│  state.ts      │  │  api.ts        │  │  Business Logic      │
│  ┌──────────┐  │  │  ┌──────────┐  │  │  ┌────────────────┐  │
│  │ Pub/Sub  │  │  │  │TokenBucket│  │  │  │    calc.ts     │  │
│  │ Store    │  │  │  │ Limiter  │  │  │  │  (Pure Logic)  │  │
│  │ Persist  │  │  │  │ Retry    │  │  │  └────────────────┘  │
│  └──────────┘  │  │  └──────────┘  │  │  ┌────────────────┐  │
└────────────────┘  └────────────────┘  │  │   export.ts    │  │
                                        │  │  (Secure CSV)  │  │
                                        │  └────────────────┘  │
                                        │  ┌────────────────┐  │
                                        │  │   utils.ts     │  │
                                        │  │(Date/Escaping) │  │
                                        │  └────────────────┘  │
                                        └──────────────────────┘
```

### 3.2 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERACTION                            │
│  1. User selects date range                                         │
│  2. User clicks "Generate Report"                                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CONTROLLER (main.ts)                           │
│  • Cancel previous report (AbortController)                         │
│  • Show loading state                                               │
│  • Orchestrate parallel fetches                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      PARALLEL API FETCHES                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│  │Time Entries │ │  Profiles   │ │  Holidays   │ │  Time Off   │   │
│  │(Reports API)│ │ (Batched 5) │ │ (Per User)  │ │ (Per User)  │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
│                                                                     │
│  Token Bucket Rate Limiter: 50 req/s, exponential backoff on 429   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      STATE POPULATION                               │
│  store.rawEntries    = time entries                                 │
│  store.profiles      = Map<userId, UserProfile>                     │
│  store.holidays      = Map<userId, Map<dateKey, Holiday>>           │
│  store.timeOff       = Map<userId, Map<dateKey, TimeOffInfo>>       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CALCULATION ENGINE (calc.ts)                   │
│  For each user:                                                     │
│    For each date in range:                                          │
│      1. Determine effective capacity (overrides → profile → default)│
│      2. Adjust for holidays/time-off/non-working days               │
│      3. Sort entries by start time                                  │
│      4. Apply tail attribution (regular until capacity, then OT)    │
│      5. Calculate tier2 premium if applicable                       │
│      6. Compute amounts (earned/cost/profit)                        │
│      7. Track billable/non-billable breakdown                       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      STORE ANALYSIS RESULTS                         │
│  store.analysisResults = UserAnalysis[]                             │
│    ├── userId, userName                                             │
│    ├── days: Map<dateKey, DayData>                                  │
│    │     ├── entries[] (with analysis attached)                     │
│    │     └── meta (capacity, isHoliday, isNonWorking, isTimeOff)    │
│    └── totals: UserTotals                                           │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      UI RENDERING                                   │
│  • Summary Strip (key metrics)                                      │
│  • Summary Table (grouped by user/project/client/task/date/week)    │
│  • Detailed Table (paginated, 50 rows/page)                         │
│  • Overrides Table (editable user overrides)                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      OPTIONAL EXPORT                                │
│  • CSV with formula injection protection                            │
│  • All text fields sanitized                                        │
│  • TotalHoursDecimal column for data analysis                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 State Management Pattern (Pub/Sub)

```typescript
// Simplified Store pattern
class Store {
    private listeners = new Set<(store: Store) => void>();

    // Subscribe to state changes
    subscribe(fn: (store: Store) => void) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    // Notify all subscribers
    notify() {
        this.listeners.forEach(listener => listener(this));
    }

    // State modification triggers notify()
    setAnalysisResults(results: UserAnalysis[]) {
        this.analysisResults = results;
        this.notify();
    }
}
```

### 3.4 Worker Architecture

OTPLUS supports offloading calculations to a Web Worker for non-blocking UI:

```
Main Thread                    Worker Thread
┌──────────────┐              ┌──────────────┐
│ main.ts      │   postMsg    │ calc-worker  │
│              │ ──────────▶  │              │
│ UI rendering │              │ calculateAnalysis()
│              │  ◀────────── │              │
│ Results      │   onmessage  │              │
└──────────────┘              └──────────────┘

Fallback: If Worker unavailable, calc runs on main thread
```

---

## 4. Module Reference

### 4.1 main.ts — Controller/Orchestrator

**Purpose**: Entry point and orchestrator for the application.

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `init()` | Parse JWT from URL, apply theme, load initial data |
| `loadInitialData()` | Fetch users, render overrides table, bind events |
| `handleGenerateReport()` | Cancel previous, fetch data, calculate, render |
| `handleCancelReport()` | Abort in-flight requests via AbortController |
| `handleExport()` | Trigger CSV download |

**Dependencies**: api.ts, state.ts, calc.ts, ui/*, export.ts

**Key Behavior**:
- Maintains `AbortController` for cancellation
- Uses `Promise.all` to parallelize API fetches
- Increments `currentRequestId` to detect stale results

### 4.2 api.ts — Clockify API Client

**Purpose**: All network communication with Clockify APIs.

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `fetchWithAuth(url, options)` | Base fetch with auth header and rate limiting |
| `fetchUsers(workspaceId)` | Get all workspace users |
| `fetchDetailedReport(params)` | Fetch time entries (Reports API) |
| `fetchAllProfiles(workspaceId, userIds)` | Batch fetch user profiles |
| `fetchAllHolidays(workspaceId, userIds, range)` | Fetch holidays per user |
| `fetchAllTimeOff(workspaceId, userIds, range)` | Fetch time-off per user |

**Rate Limiting**:
```
Token Bucket Configuration:
- Capacity: 50 tokens
- Refill: 50 tokens per 1000ms
- On empty: waitForToken() blocks until refill
- On 429: Exponential backoff (1s, 2s, 4s) with Retry-After header
```

**Error Handling**:
```
Non-retryable: 401, 403, 404 (auth/permission issues)
Retryable: Network errors, 5xx, 429 (up to 2 retries, 0 in tests)
```

### 4.3 state.ts — Centralized Store

**Purpose**: Single source of truth for all application state.

**Key Methods**:

| Method | Purpose |
|--------|---------|
| `subscribe(fn)` | Register listener for state changes |
| `notify()` | Trigger all listeners |
| `setToken(token)` | Parse JWT, load overrides for workspace |
| `saveConfig()` | Persist config to localStorage |
| `saveOverrides()` | Persist overrides to localStorage |
| `updateOverride(userId, field, value)` | Validate and save user override |
| `clearCaches()` | Clear profiles/holidays/timeOff maps |

**State Sections**:
```typescript
{
  // Authentication
  token: string | null,
  claims: TokenClaims | null,

  // API Data
  users: User[],
  rawEntries: TimeEntry[] | null,
  analysisResults: UserAnalysis[] | null,
  currentDateRange: DateRange | null,

  // Configuration
  config: OvertimeConfig,
  calcParams: CalculationParams,

  // Caches
  profiles: Map<string, UserProfile>,
  holidays: Map<string, Map<string, Holiday>>,
  timeOff: Map<string, Map<string, TimeOffInfo>>,

  // Per-user overrides
  overrides: Record<string, UserOverride>,

  // API error tracking
  apiStatus: ApiStatus,

  // Rate limit tracking
  throttleStatus: { retryCount: number, lastRetryTime: number },

  // UI state
  ui: UIState
}
```

### 4.4 calc.ts — Calculation Engine

**Purpose**: Pure calculation logic for overtime analysis. **No side effects** (no DOM, no fetch, no localStorage).

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `calculateAnalysis(entries, store, dateRange)` | Main calculation entry point |
| `getEffectiveCapacity(userId, dateKey, store)` | Resolve capacity with precedence |
| `getEffectiveMultiplier(userId, dateKey, store)` | Resolve OT multiplier |
| `getEffectiveTier2Threshold(userId, dateKey, store)` | Resolve tier2 threshold |
| `classifyEntryForOvertime(entry)` | Classify as 'break', 'pto', or 'work' |

**Business Rules** (see Section 6 for details):
1. BREAK and PTO entries count as regular but never trigger/become OT
2. Effective capacity = override ?? profile ?? global default
3. Capacity is zeroed on holidays/non-working days
4. Tail attribution assigns OT to the last entries of the day

### 4.5 export.ts — CSV Export

**Purpose**: Generate secure CSV exports with sanitization.

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `downloadCsv(analysisResults, filename)` | Generate and download CSV |
| `sanitizeFormulaInjection(value)` | Prefix dangerous characters with `'` |
| `escapeCsv(value)` | Quote fields with special characters |

**CSV Columns**:
```
Date, User, Description, EffectiveCapacityHours, RegularHours,
OvertimeHours, BillableWorkedHours, BillableOTHours,
NonBillableWorkedHours, NonBillableOTHours, TotalHours,
TotalHoursDecimal, isHoliday, holidayName, isNonWorkingDay, isTimeOff
```

### 4.6 ui/ — Rendering Modules

**ui/detailed.ts** — Detailed table with pagination
- 50 entries per page
- Filter chips: 'all', 'holiday', 'offday', 'billable'
- Columns: Date, Start, End, User, Regular, Overtime, Billable, Rate, Regular$, OT$, T2$, Total$, Status

**ui/summary.ts** — Summary table with grouping
- Group by: user, project, client, task, date, week
- Shows aggregated totals per group

**ui/overrides.ts** — Override editor
- Per-user capacity/multiplier/tier2 settings
- Modes: global, weekly, perDay
- Copy actions (global → weekly, global → perDay)

**ui/shared.ts** — Shared UI utilities
- `formatHoursDisplay()` — Decimal or "Xh Ym" format
- `getAmountDisplayMode()` — Current display mode
- `buildProfitStacks()` — Cost/earned/profit breakdown

**ui/dialogs.ts** — Modal dialogs
- Confirmation dialogs
- Error displays

### 4.7 utils.ts — Utility Functions

**Date/Timezone (IsoUtils)**:

| Function | Purpose |
|----------|---------|
| `extractDateKey(isoString)` | ISO timestamp → YYYY-MM-DD (LOCAL time) |
| `toISODate(date)` | Date → YYYY-MM-DD (UTC) |
| `parseDate(dateStr)` | YYYY-MM-DD → Date at UTC midnight |
| `getWeekdayKey(dateKey)` | YYYY-MM-DD → 'MONDAY', 'TUESDAY', etc. |
| `generateDateRange(start, end)` | Generate inclusive date array |
| `getISOWeek(date)` | Get ISO week number (1-53) |

**Math**:

| Function | Purpose |
|----------|---------|
| `round(num, decimals)` | Precision rounding with epsilon correction |
| `parseIsoDuration(duration)` | ISO 8601 duration → hours |

**Security**:

| Function | Purpose |
|----------|---------|
| `escapeHtml(str)` | Escape &, <, >, ", ' for XSS prevention |
| `escapeCsv(str)` | Quote fields for CSV safety |

**Validation**:

| Function | Purpose |
|----------|---------|
| `validateRequiredFields(obj, fields)` | Check required object fields |
| `validateNumber(value, min, max)` | Validate numeric range |
| `validateTimeEntry(entry)` | Validate entry structure |

### 4.8 constants.ts — Shared Constants

**Defaults**:
```typescript
DEFAULT_DAILY_CAPACITY: 8      // hours
DEFAULT_WEEKLY_CAPACITY: 40    // hours
DEFAULT_MULTIPLIER: 1.5        // 1.5x OT rate
DEFAULT_TIER2_THRESHOLD: 0     // disabled by default
DEFAULT_TIER2_MULTIPLIER: 2.0  // 2.0x tier2 rate
```

**API Limits**:
```typescript
DEFAULT_MAX_PAGES: 50          // 10,000 entries max
HARD_MAX_PAGES_LIMIT: 500      // Absolute safety limit
```

**Storage Keys**:
```typescript
DENSITY: 'overtime_density'
OVERRIDES_PREFIX: 'overtime_overrides_'
UI_STATE: 'otplus_ui_state'
REPORT_CACHE: 'otplus_report_cache'  // 5-minute TTL
```

**Error Types**:
```typescript
NETWORK_ERROR   // Network/connectivity issues
AUTH_ERROR      // 401/403 authentication issues
VALIDATION_ERROR // Invalid data
API_ERROR       // Clockify API errors
UNKNOWN_ERROR   // Unclassified errors
```

---

## 5. Type Definitions

### 5.1 Core Entities

#### TimeEntry
```typescript
interface TimeEntry {
    id: string;                    // Unique identifier
    userId: string;                // User ID
    userName: string;              // User display name
    userEmail?: string;            // User email (optional)
    description?: string;          // Entry description
    billable?: boolean;            // Is entry billable
    type?: string;                 // 'REGULAR' | 'BREAK' | 'HOLIDAY' | 'TIME_OFF'
    timeInterval: {
        start: string;             // ISO 8601 start timestamp
        end: string;               // ISO 8601 end timestamp
        duration?: string;         // ISO 8601 duration (PT8H30M)
    };
    project?: { id?: string; name?: string };
    projectId?: string;
    projectName?: string;
    clientId?: string | null;
    clientName?: string | null;
    taskId?: string;
    taskName?: string;
    hourlyRate?: { amount: number; currency?: string };
    earnedRate?: number | { amount: number };  // In cents
    costRate?: number | { amount: number };    // In cents
    amounts?: Amount[];            // From Reports API
    tags?: Tag[];
    analysis?: EntryAnalysis;      // Attached during calculation
    dayMeta?: DayMeta;             // Day context
}
```

#### User
```typescript
interface User {
    id: string;
    name: string;
    email?: string;
    status?: string;  // e.g., 'ACTIVE'
}
```

#### UserProfile
```typescript
interface UserProfile {
    userId?: string;
    workCapacityHours: number;    // Daily capacity (e.g., 7.5)
    workingDays?: string[];       // ['MONDAY', 'TUESDAY', ...]
    workCapacity?: string;        // ISO duration (PT8H)
}
```

#### Holiday
```typescript
interface Holiday {
    name: string;
    datePeriod: {
        startDate: string;
        endDate?: string;
    };
    projectId?: string;
}
```

#### TimeOffInfo
```typescript
interface TimeOffInfo {
    isFullDay: boolean;
    hours: number;
}
```

### 5.2 Analysis Results

#### EntryAnalysis
```typescript
interface EntryAnalysis {
    regular: number;               // Regular hours
    overtime: number;              // Overtime hours
    isBillable: boolean;
    isBreak?: boolean;
    cost: number;                  // Total amount (selected display mode)
    profit: number;                // Profit amount
    tags: string[];                // ['HOLIDAY', 'OFF-DAY', 'TIME-OFF', 'BREAK']
    hourlyRate?: number;
    regularRate?: number;
    overtimeRate?: number;
    regularAmount?: number;
    overtimeAmountBase?: number;
    tier1Premium?: number;
    tier2Premium?: number;
    totalAmountWithOT?: number;
    totalAmountNoOT?: number;
    amounts?: {
        earned: AmountBreakdown;
        cost: AmountBreakdown;
        profit: AmountBreakdown;
    };
}
```

#### AmountBreakdown
```typescript
interface AmountBreakdown {
    rate: number;                  // Hourly rate
    regularAmount: number;
    overtimeAmountBase: number;
    baseAmount: number;            // regular + overtimeBase
    tier1Premium: number;
    tier2Premium: number;
    totalAmountWithOT: number;
    totalAmountNoOT: number;
    overtimeRate: number;          // rate * multiplier
}
```

#### DayMeta
```typescript
interface DayMeta {
    capacity?: number;             // Effective capacity
    isHoliday: boolean;
    holidayName?: string;
    isNonWorking: boolean;
    isTimeOff: boolean;
    holidayProjectId?: string | null;
}
```

#### DayData
```typescript
interface DayData {
    entries: TimeEntry[];          // Entries for this day
    meta?: DayMeta;                // Day metadata
}
```

#### UserTotals
```typescript
interface UserTotals {
    regular: number;
    overtime: number;
    total: number;                 // regular + overtime
    breaks: number;
    billableWorked: number;
    nonBillableWorked: number;
    billableOT: number;
    nonBillableOT: number;
    amount: number;                // Primary display mode amount
    amountBase: number;            // Without OT premium
    amountEarned: number;
    amountCost: number;
    amountProfit: number;
    profit: number;
    otPremium: number;             // Tier 1 premium
    otPremiumTier2: number;        // Additional tier 2 premium
    expectedCapacity: number;
    holidayCount: number;
    timeOffCount: number;
    holidayHours: number;
    timeOffHours: number;
    vacationEntryHours: number;    // Actual HOLIDAY/TIME_OFF entry durations
}
```

#### UserAnalysis
```typescript
interface UserAnalysis {
    userId: string;
    userName: string;
    days: Map<string, DayData>;    // dateKey → DayData
    totals: UserTotals;
}
```

### 5.3 Configuration

#### OvertimeConfig
```typescript
interface OvertimeConfig {
    useProfileCapacity: boolean;      // Use profile capacity if available
    useProfileWorkingDays: boolean;   // Respect profile working days
    applyHolidays: boolean;           // Apply holidays to capacity
    applyTimeOff: boolean;            // Apply time off to capacity
    showBillableBreakdown: boolean;   // Show billable split in UI
    showDecimalTime: boolean;         // Decimal vs h:m format
    amountDisplay: 'earned' | 'cost' | 'profit';
    overtimeBasis: 'daily' | 'weekly';
    maxPages?: number;                // Max pages from Reports API
}
```

#### CalculationParams
```typescript
interface CalculationParams {
    dailyThreshold: number;        // Default daily capacity (8)
    weeklyThreshold: number;       // Default weekly capacity (40)
    overtimeMultiplier: number;    // OT premium multiplier (1.5)
    tier2ThresholdHours: number;   // Threshold for tier 2 (0 = disabled)
    tier2Multiplier: number;       // Tier 2 multiplier (2.0)
}
```

#### UserOverride
```typescript
interface UserOverride {
    mode?: 'global' | 'weekly' | 'perDay';
    capacity?: string | number;          // Global capacity override
    multiplier?: string | number;        // Global OT multiplier
    tier2Threshold?: string | number;    // Global tier2 threshold
    tier2Multiplier?: string | number;   // Global tier2 multiplier
    perDayOverrides?: Record<string, PerDayOverride>;   // dateKey → override
    weeklyOverrides?: Record<string, WeeklyOverride>;   // weekday → override
}

interface PerDayOverride {
    capacity?: string | number;
    multiplier?: string | number;
    tier2Threshold?: string | number;
    tier2Multiplier?: string | number;
}

interface WeeklyOverride {
    capacity?: string | number;
    multiplier?: string | number;
    tier2Threshold?: string | number;
    tier2Multiplier?: string | number;
}
```

### 5.4 API Types

#### TokenClaims
```typescript
interface TokenClaims {
    workspaceId: string;
    backendUrl: string;
    reportsUrl?: string;
    theme?: 'DARK' | 'LIGHT';
    [key: string]: unknown;
}
```

#### ApiStatus
```typescript
interface ApiStatus {
    profilesFailed: number;
    holidaysFailed: number;
    timeOffFailed: number;
}
```

#### UIState
```typescript
interface UIState {
    isLoading: boolean;
    summaryExpanded: boolean;
    summaryGroupBy: 'user' | 'project' | 'client' | 'task' | 'date' | 'week';
    overridesCollapsed: boolean;
    activeTab: 'summary' | 'detailed';
    detailedPage: number;
    detailedPageSize: number;
    activeDetailedFilter: 'all' | 'holiday' | 'offday' | 'billable';
    hasCostRates: boolean;
}
```

---

## 6. Overtime Calculation Algorithm

This section documents the complete overtime calculation logic as implemented in `calc.ts`.

### 6.1 Entry Classification

Every time entry is classified into one of three categories:

| Entry Type | Classification | Counts as Regular? | Accumulates Toward Capacity? | Can Become OT? |
|------------|----------------|-------------------|------------------------------|---------------|
| `type === 'BREAK'` | **break** | Yes | No | No |
| `type === 'HOLIDAY'` | **pto** | Yes | No | No |
| `type === 'TIME_OFF'` | **pto** | Yes | No | No |
| All others | **work** | Varies | Yes | Yes |

**Classification Function**:
```typescript
function classifyEntryForOvertime(entry: TimeEntry): 'break' | 'pto' | 'work' {
    const type = (entry.type || '').toUpperCase();
    if (type === 'BREAK') return 'break';
    if (type === 'HOLIDAY' || type === 'TIME_OFF' ||
        type === 'HOLIDAY_TIME_ENTRY' || type === 'TIME_OFF_TIME_ENTRY') {
        return 'pto';
    }
    return 'work';
}
```

**Critical Rule**: BREAK and PTO entries:
- Count toward total hours
- Are always recorded as regular (never overtime)
- Do NOT accumulate toward the daily capacity threshold
- Do NOT trigger overtime for other entries

### 6.2 Capacity Precedence Rules

For each user on each day, effective capacity is resolved in this order:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Per-Day Override (highest priority)                          │
│    overrides[userId].perDayOverrides[dateKey].capacity          │
│    └─ Only if mode === 'perDay' AND value exists                │
├─────────────────────────────────────────────────────────────────┤
│ 2. Weekly Override                                               │
│    overrides[userId].weeklyOverrides[weekday].capacity          │
│    └─ Only if mode === 'weekly' AND value exists                │
├─────────────────────────────────────────────────────────────────┤
│ 3. Global User Override                                          │
│    overrides[userId].capacity                                    │
│    └─ Always checked if value exists                            │
├─────────────────────────────────────────────────────────────────┤
│ 4. Profile Capacity                                              │
│    profiles.get(userId).workCapacityHours                       │
│    └─ Only if config.useProfileCapacity === true                │
├─────────────────────────────────────────────────────────────────┤
│ 5. Global Default (lowest priority)                              │
│    calcParams.dailyThreshold (default: 8 hours)                 │
└─────────────────────────────────────────────────────────────────┘
```

**Same precedence applies for**:
- `multiplier` (OT premium rate)
- `tier2Threshold` (hours before tier 2 kicks in)
- `tier2Multiplier` (tier 2 premium rate)

### 6.3 Effective Capacity Adjustments

After resolving the base capacity, adjustments are applied:

```
┌─────────────────────────────────────────────────────────────────┐
│ CAPACITY ADJUSTMENTS (in order of precedence)                   │
├─────────────────────────────────────────────────────────────────┤
│ 1. Is it a HOLIDAY? (API data or entry type fallback)           │
│    └─ Yes: effectiveCapacity = 0 (all work is OT)               │
├─────────────────────────────────────────────────────────────────┤
│ 2. Is it a NON-WORKING day? (per profile workingDays)           │
│    └─ Yes: effectiveCapacity = 0 (all work is OT)               │
├─────────────────────────────────────────────────────────────────┤
│ 3. Is there TIME-OFF? (API data or entry type fallback)         │
│    └─ Full day: effectiveCapacity = 0                           │
│    └─ Partial: effectiveCapacity = max(0, capacity - hours)     │
└─────────────────────────────────────────────────────────────────┘
```

**Example**:
```
User's profile capacity: 8 hours
Tuesday is a holiday → effectiveCapacity = 0
User works 4 hours → All 4 hours are overtime

User's profile capacity: 8 hours
Wednesday has 2 hours time-off → effectiveCapacity = 6 hours
User works 8 hours → 6 regular + 2 overtime
```

### 6.4 Tail Attribution Algorithm

The core algorithm for splitting work into regular vs. overtime hours:

```
┌─────────────────────────────────────────────────────────────────┐
│                   TAIL ATTRIBUTION                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. Get all entries for the user on this date                    │
│ 2. Sort entries by timeInterval.start (chronological)           │
│ 3. Initialize dailyAccumulator = 0                              │
│ 4. For each entry in sorted order:                              │
│    ├─ Get entry duration                                        │
│    ├─ Classify entry (break/pto/work)                           │
│    │                                                            │
│    ├─ IF break or pto:                                          │
│    │   regular = duration                                       │
│    │   overtime = 0                                             │
│    │   (do NOT add to accumulator)                              │
│    │                                                            │
│    └─ ELSE (work entry):                                        │
│        IF accumulator >= capacity:                              │
│           regular = 0                                           │
│           overtime = duration (entire entry is OT)              │
│        ELSE IF accumulator + duration <= capacity:              │
│           regular = duration                                    │
│           overtime = 0 (entire entry is regular)                │
│        ELSE:                                                    │
│           regular = capacity - accumulator (partial)            │
│           overtime = duration - regular (remainder)             │
│        END IF                                                   │
│        accumulator += duration                                  │
│                                                                 │
│ 5. Attach analysis to entry with regular/overtime split         │
└─────────────────────────────────────────────────────────────────┘
```

**Why "Tail Attribution"**: Overtime is assigned to the "tail" (later) entries of the day. This models the common business practice where the first hours worked are considered regular, and hours beyond capacity are overtime.

### 6.5 Tiered Overtime (Tier 1 + Tier 2)

For premium calculations, overtime can be split into two tiers:

```
┌─────────────────────────────────────────────────────────────────┐
│                   TIERED OVERTIME                               │
├─────────────────────────────────────────────────────────────────┤
│ Parameters:                                                     │
│   multiplier = 1.5 (tier 1 rate, e.g., time-and-a-half)        │
│   tier2Threshold = 4 (hours of OT before tier 2)               │
│   tier2Multiplier = 2.0 (tier 2 rate, e.g., double-time)       │
│                                                                 │
│ User-level OT accumulator tracks total OT across all days       │
│                                                                 │
│ For each OT entry:                                              │
│   otBefore = userOTAccumulator                                  │
│   otAfter = otBefore + overtimeHours                            │
│                                                                 │
│   IF otBefore >= tier2Threshold:                                │
│      tier2Hours = overtimeHours (all is tier 2)                 │
│      tier1Hours = 0                                             │
│   ELSE IF otAfter <= tier2Threshold:                            │
│      tier1Hours = overtimeHours (all is tier 1)                 │
│      tier2Hours = 0                                             │
│   ELSE:                                                         │
│      tier1Hours = tier2Threshold - otBefore (straddles)         │
│      tier2Hours = overtimeHours - tier1Hours                    │
│                                                                 │
│   userOTAccumulator = otAfter                                   │
├─────────────────────────────────────────────────────────────────┤
│ Premium Calculations:                                           │
│   tier1Premium = overtimeHours * rate * (multiplier - 1)        │
│   tier2Premium = tier2Hours * rate * (tier2Multiplier - mult.)  │
│                                                                 │
│ Note: tier1Premium applies to ALL OT hours (base premium)       │
│       tier2Premium is ADDITIONAL premium for tier2 hours only   │
└─────────────────────────────────────────────────────────────────┘
```

**Example**:
```
Rate: $50/hr, Multiplier: 1.5x, Tier2: 2.0x after 4 hours OT

Day 1: 2 hours OT
  tier1Hours = 2, tier2Hours = 0
  tier1Premium = 2 * $50 * 0.5 = $50
  tier2Premium = 0
  Total OT pay: 2 * $50 * 1.5 = $150

Day 2: 5 hours OT (accumulator was 2, now 7)
  tier1Hours = 4 - 2 = 2 (up to threshold)
  tier2Hours = 5 - 2 = 3 (beyond threshold)
  tier1Premium = 5 * $50 * 0.5 = $125
  tier2Premium = 3 * $50 * (2.0 - 1.5) = $75
  Total OT pay: 5 * $50 + $125 + $75 = $450
```

### 6.6 Billable Split Logic

Billable/non-billable tracking is done independently:

```
┌─────────────────────────────────────────────────────────────────┐
│                   BILLABLE BREAKDOWN                            │
├─────────────────────────────────────────────────────────────────┤
│ Four independent buckets (per entry, summed to totals):         │
│                                                                 │
│ 1. billableWorked                                               │
│    = sum of regular hours where entry.billable === true         │
│                                                                 │
│ 2. nonBillableWorked                                            │
│    = sum of regular hours where entry.billable === false        │
│                                                                 │
│ 3. billableOT                                                   │
│    = sum of overtime hours where entry.billable === true        │
│    (Only WORK entries can have overtime)                        │
│                                                                 │
│ 4. nonBillableOT                                                │
│    = sum of overtime hours where entry.billable === false       │
│    (Only WORK entries can have overtime)                        │
├─────────────────────────────────────────────────────────────────┤
│ BREAK and PTO entries:                                          │
│ - Contribute to billableWorked/nonBillableWorked                │
│ - Never contribute to OT buckets (they can't have OT)           │
│ - Amounts calculated at regular rate (no premium)               │
└─────────────────────────────────────────────────────────────────┘
```

### 6.7 Amount Calculations

For each entry, three amount types are calculated: earned, cost, and profit.

```
┌─────────────────────────────────────────────────────────────────┐
│                   AMOUNT CALCULATION                            │
├─────────────────────────────────────────────────────────────────┤
│ Rate Extraction (per entry):                                    │
│   earnedRate = entry.earnedRate OR entry.hourlyRate             │
│                (non-billable entries: 0)                        │
│   costRate = entry.costRate OR 0                                │
│   profitRate = earnedRate - costRate                            │
│                                                                 │
│ For each rate (earned/cost/profit):                             │
│   regularAmount = regularHours * rate                           │
│   overtimeAmountBase = overtimeHours * rate                     │
│   tier1Premium = overtimeHours * rate * (multiplier - 1)        │
│   tier2Premium = tier2Hours * rate * (tier2Mult - multiplier)   │
│   totalAmountWithOT = regularAmount + overtimeAmountBase        │
│                     + tier1Premium + tier2Premium               │
│                                                                 │
│ Primary amount (for display) selected by config.amountDisplay   │
├─────────────────────────────────────────────────────────────────┤
│ Rounding:                                                       │
│   - Hours: 4 decimal places                                     │
│   - Currency: 2 decimal places                                  │
│   - Applied at aggregation boundary (after summing)             │
└─────────────────────────────────────────────────────────────────┘
```

### 6.8 Worked Example

**Scenario**:
- User: Alice
- Date: 2026-01-20 (Monday, regular working day)
- Profile capacity: 8 hours
- No overrides, no holidays, no time-off
- OT multiplier: 1.5x
- Tier2: 2.0x after 4 hours OT (user has 3 hours OT from previous days)

**Entries** (sorted by start time):
| # | Start | Duration | Type | Billable | Rate |
|---|-------|----------|------|----------|------|
| 1 | 09:00 | 3 hours | REGULAR | Yes | $100/hr |
| 2 | 12:00 | 1 hour | BREAK | No | - |
| 3 | 13:00 | 4 hours | REGULAR | Yes | $100/hr |
| 4 | 17:00 | 3 hours | REGULAR | No | $0/hr |

**Processing**:

```
Effective capacity = 8 hours (profile, no adjustments)
Daily accumulator = 0
User OT accumulator = 3 hours (from previous days)

Entry 1 (3h REGULAR):
  Classification: work
  Accumulator: 0, 0 + 3 = 3 ≤ 8
  → regular = 3h, overtime = 0h
  → accumulator = 3h
  Billable: Yes → billableWorked += 3
  Amount: 3 * $100 = $300

Entry 2 (1h BREAK):
  Classification: break
  → regular = 1h, overtime = 0h
  → accumulator unchanged (still 3h)
  Billable: No → nonBillableWorked += 1
  Amount: $0 (break, no rate)

Entry 3 (4h REGULAR):
  Classification: work
  Accumulator: 3, 3 + 4 = 7 ≤ 8
  → regular = 4h, overtime = 0h
  → accumulator = 7h
  Billable: Yes → billableWorked += 4
  Amount: 4 * $100 = $400

Entry 4 (3h REGULAR):
  Classification: work
  Accumulator: 7, 7 + 3 = 10 > 8
  → regular = 8 - 7 = 1h, overtime = 2h
  → accumulator = 10h
  Billable: No → nonBillableWorked += 1, nonBillableOT += 2

  Tier2 calculation:
    userOT before = 3, after = 3 + 2 = 5
    tier2Threshold = 4
    tier1Hours = 4 - 3 = 1h (up to threshold)
    tier2Hours = 2 - 1 = 1h (beyond threshold)
    userOT accumulator = 5

  Amount: $0 (non-billable, earned rate = 0)

DAILY TOTALS:
  total = 11h
  regular = 9h (3 + 1 + 4 + 1)
  overtime = 2h
  breaks = 1h
  billableWorked = 7h (3 + 4)
  nonBillableWorked = 2h (1 + 1)
  billableOT = 0h
  nonBillableOT = 2h
  amountEarned = $700 (300 + 0 + 400 + 0)
  otPremium = $0 (non-billable OT)
```

### 6.9 Daily vs Weekly Overtime Modes

OTPLUS supports three overtime calculation modes via `config.overtimeBasis`:

| Mode | Description | Threshold Used |
|------|-------------|----------------|
| `daily` | OT calculated per day (tail attribution within each day) | `dailyThreshold` (default 8h) |
| `weekly` | OT calculated per week (tail attribution across the week) | `weeklyThreshold` (default 40h) |
| `both` | Reports 4 separate metrics for comprehensive analysis | Both thresholds |

**Daily Mode** (default):
- Each day is processed independently
- Tail attribution sorts entries by start time within each day
- Hours beyond daily capacity become OT
- Most common for US-style overtime rules

**Weekly Mode**:
- Entries across the entire week are processed together
- Tail attribution sorts entries by start time across all 7 days
- Hours beyond weekly capacity become OT
- Common for EU-style overtime rules

**Combined Mode** (`both`):
When both modes are needed (e.g., for compliance reporting), OTPLUS calculates 4 metrics:

```
┌─────────────────────────────────────────────────────────────────┐
│                   COMBINED OT METRICS                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. dailyOvertimeHours                                           │
│    = Sum of OT calculated using daily tail attribution          │
│                                                                 │
│ 2. weeklyOvertimeHours                                          │
│    = Sum of OT calculated using weekly tail attribution         │
│                                                                 │
│ 3. overlapOvertimeHours                                         │
│    = Hours that are OT under BOTH daily AND weekly rules        │
│    (intersection of daily and weekly OT)                        │
│                                                                 │
│ 4. combinedOvertimeHours (recommended for display)              │
│    = dailyOT + weeklyOT - overlapOT                             │
│    (union: avoids double-counting overlapping hours)            │
└─────────────────────────────────────────────────────────────────┘
```

**Example (Combined Mode)**:
```
Week: Mon-Sun, daily capacity 8h, weekly capacity 40h

Mon: 10h worked → 2h daily OT (exceeded 8h)
Tue: 10h worked → 2h daily OT
Wed: 10h worked → 2h daily OT
Thu: 10h worked → 2h daily OT
Fri: 8h worked → 0h daily OT (exactly 8h)

Weekly total: 48h
  dailyOT = 8h (2+2+2+2+0)
  weeklyOT = 8h (48 - 40)
  overlapOT = 8h (all daily OT also exceeds weekly)
  combinedOT = 8h + 8h - 8h = 8h
```

---

## 7. Clockify API Reference

### 7.1 Authentication

All requests include the addon token in the header:

```
Header: X-Addon-Token: <jwt_token>
```

The token is a JWT passed via URL parameter `auth_token` when the addon loads. It contains:
- `workspaceId`: The workspace to query
- `backendUrl`: Base URL for API calls
- `reportsUrl`: Base URL for Reports API (optional)
- `theme`: User's theme preference ('DARK' or 'LIGHT')

### 7.2 Endpoint Catalog

| Endpoint | Method | Purpose | Payload/Query |
|----------|--------|---------|---------------|
| `/v1/workspaces/{wid}/users` | GET | List workspace users | none |
| `/v1/workspaces/{wid}/reports/detailed` | POST | Time entries (paginated) | See below |
| `/v1/workspaces/{wid}/member-profile/{uid}` | GET | User profile/capacity | none |
| `/v1/workspaces/{wid}/holidays/in-period` | GET | Holidays for user | `start`, `end`, `assigned-to` |
| `/v1/workspaces/{wid}/time-off/requests` | POST | Time-off requests | See below |

### 7.3 Detailed Report Request

```typescript
// POST /v1/workspaces/{wid}/reports/detailed
{
    dateRangeStart: "2026-01-01T00:00:00Z",
    dateRangeEnd: "2026-01-31T23:59:59Z",
    amountShown: "HIDE_AMOUNT",  // or "EARNED", "COST"
    amounts: ["EARNED", "COST", "PROFIT"],
    detailedFilter: {
        page: 1,
        pageSize: 200
    }
}
```

**Response**:
```typescript
{
    timeentries: TimeEntry[],  // May also be "timeEntries"
    totals: { ... }
}
```

### 7.4 Holidays Request

```
GET /v1/workspaces/{wid}/holidays/in-period
    ?start=2026-01-01T00:00:00Z
    &end=2026-01-31T23:59:59Z
    &assigned-to={userId}
```

**Response**: Array of Holiday objects

### 7.5 Time-Off Request

```typescript
// POST /v1/workspaces/{wid}/time-off/requests
{
    page: 1,
    pageSize: 200,
    users: [userId1, userId2, ...],
    statuses: ["APPROVED"],
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-31T23:59:59Z"
}
```

**Response**:
```typescript
{
    requests: TimeOffRequest[]  // May be array directly
}
```

### 7.6 Rate Limiting Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                   TOKEN BUCKET RATE LIMITER                     │
├─────────────────────────────────────────────────────────────────┤
│ Configuration:                                                  │
│   tokens = 50                                                   │
│   refillInterval = 1000ms                                       │
│   tokensPerRefill = 50                                          │
│                                                                 │
│ waitForToken():                                                 │
│   while (true) {                                                │
│     if (tokens > 0) {                                           │
│       tokens--;                                                 │
│       return;                                                   │
│     }                                                           │
│     await delay(refillInterval - elapsed);                      │
│     tokens = 50; // refill                                      │
│   }                                                             │
├─────────────────────────────────────────────────────────────────┤
│ On HTTP 429:                                                    │
│   1. Parse Retry-After header (or default 5s)                   │
│   2. Apply exponential backoff: 1s, 2s, 4s                      │
│   3. Retry up to 2 times (0 in tests)                           │
│   4. Track throttle status for UI banner                        │
├─────────────────────────────────────────────────────────────────┤
│ Non-Retryable Errors:                                           │
│   401 Unauthorized                                              │
│   403 Forbidden                                                 │
│   404 Not Found                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.7 Error Handling

```typescript
// Error classification
function classifyError(error: Error): ErrorType {
    if (isNetworkError(error)) return 'NETWORK_ERROR';
    if (isAuthError(error)) return 'AUTH_ERROR';
    if (isValidationError(error)) return 'VALIDATION_ERROR';
    if (isApiError(error)) return 'API_ERROR';
    return 'UNKNOWN_ERROR';
}

// User-friendly error messages
const ERROR_MESSAGES = {
    NETWORK_ERROR: {
        title: 'Network Error',
        message: 'Unable to connect. Check your internet connection.',
        action: 'retry'
    },
    AUTH_ERROR: {
        title: 'Authentication Error',
        message: 'Session expired. Please reload the addon.',
        action: 'reload'
    },
    // ...
};
```

**Resilience Features**:

```
┌─────────────────────────────────────────────────────────────────┐
│                   ERROR RESILIENCE                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. Partial Failure Handling                                     │
│    • If profiles fetch fails → continue with global defaults    │
│    • If holidays fetch fails → fall back to entry-type detect   │
│    • If time-off fetch fails → fall back to entry-type detect   │
│    • Report generation continues; shows warning banner          │
│                                                                 │
│ 2. Per-Dataset Error Tracking                                   │
│    store.apiStatus = {                                          │
│        profilesFailed: number,  // Count of failed profile fetches
│        holidaysFailed: number,  // Count of failed holiday fetches
│        timeOffFailed: number    // Count of failed time-off fetches
│    }                                                            │
│                                                                 │
│ 3. Retry Failed Fetches                                         │
│    • UI action: "Retry failed fetches" button                   │
│    • Only retries datasets that previously failed               │
│    • Does not re-run successful fetches                         │
│    • Merges successful retries into existing data               │
│                                                                 │
│ 4. Throttle Status Tracking                                     │
│    store.throttleStatus = {                                     │
│        retryCount: number,      // Current retry attempt        │
│        lastRetryTime: number    // Timestamp of last 429        │
│    }                                                            │
│    • Shows throttle banner when rate-limited                    │
│    • Displays countdown to next retry attempt                   │
└─────────────────────────────────────────────────────────────────┘
```

**Graceful Degradation Priority**:

| Data Source | Fallback Behavior | Impact |
|-------------|-------------------|--------|
| Profiles | Use global `dailyThreshold` | Capacity may not match user settings |
| Holidays | Detect via `entry.type === 'HOLIDAY'` | Works if entries exist |
| Time-Off | Detect via `entry.type === 'TIME_OFF'` | Works if entries exist |
| Rates | Default to 0 | Amounts show as $0 |

---

## 8. State Management

### 8.1 Store Structure

```typescript
const store = {
    // === Authentication ===
    token: string | null,          // Raw JWT
    claims: TokenClaims | null,    // Decoded JWT payload

    // === API Data ===
    users: User[],                 // Workspace users
    rawEntries: TimeEntry[] | null,
    analysisResults: UserAnalysis[] | null,
    currentDateRange: DateRange | null,

    // === Configuration ===
    config: OvertimeConfig,        // Feature toggles
    calcParams: CalculationParams, // Numeric parameters

    // === Caches ===
    profiles: Map<string, UserProfile>,
    holidays: Map<string, Map<string, Holiday>>,
    timeOff: Map<string, Map<string, TimeOffInfo>>,

    // === Per-User Overrides ===
    overrides: Record<string, UserOverride>,

    // === API Status ===
    apiStatus: {
        profilesFailed: number,
        holidaysFailed: number,
        timeOffFailed: number
    },

    // === Throttle Tracking ===
    throttleStatus: {
        retryCount: number,
        lastRetryTime: number
    },

    // === UI State ===
    ui: UIState,

    // === Pub/Sub ===
    listeners: Set<Function>
};
```

### 8.2 Persistence Keys

| Key | Storage | Purpose |
|-----|---------|---------|
| `otplus_config` | localStorage | Config toggles + calcParams |
| `overtime_overrides_{workspaceId}` | localStorage | Per-user overrides |
| `otplus_ui_state` | localStorage | UI preferences (grouping, expand states) |
| `otplus_report_cache` | sessionStorage | Report cache (5-minute TTL) |
| `overtime_density` | localStorage | Layout density preference |

### 8.3 Config Persistence Format

```json
// localStorage['otplus_config']
{
    "config": {
        "useProfileCapacity": true,
        "useProfileWorkingDays": true,
        "applyHolidays": true,
        "applyTimeOff": true,
        "showBillableBreakdown": false,
        "showDecimalTime": false,
        "amountDisplay": "earned",
        "overtimeBasis": "daily",
        "maxPages": 50
    },
    "calcParams": {
        "dailyThreshold": 8,
        "weeklyThreshold": 40,
        "overtimeMultiplier": 1.5,
        "tier2ThresholdHours": 0,
        "tier2Multiplier": 2.0
    }
}
```

### 8.4 Override Persistence Format

```json
// localStorage['overtime_overrides_{workspaceId}']
{
    "user123": {
        "mode": "global",
        "capacity": "7.5",
        "multiplier": "1.5",
        "tier2Threshold": "4",
        "tier2Multiplier": "2.0"
    },
    "user456": {
        "mode": "weekly",
        "capacity": "8",
        "weeklyOverrides": {
            "MONDAY": { "capacity": "8" },
            "TUESDAY": { "capacity": "8" },
            "FRIDAY": { "capacity": "6" }
        }
    },
    "user789": {
        "mode": "perDay",
        "capacity": "8",
        "perDayOverrides": {
            "2026-01-15": { "capacity": "0", "multiplier": "2.0" },
            "2026-01-20": { "capacity": "4" }
        }
    }
}
```

### 8.5 Override Management

**Mode Options**:
- `global`: Same capacity/multiplier for all days
- `weekly`: Different values per weekday (MONDAY, TUESDAY, etc.)
- `perDay`: Specific overrides for specific dates

**Validation Rules**:
- Capacity must be ≥ 0
- Multiplier must be ≥ 1
- Tier2Threshold must be ≥ 0
- Tier2Multiplier must be ≥ multiplier

**Copy Actions**:
- "Copy to Weekly": Copies global values to all weekday slots
- "Copy to Per-Day": Copies global values to specific date
- "Copy from Global": Seeds weekly/perDay from global

### 8.6 Caching Strategy

OTPLUS caches API responses to improve performance and reduce rate limit pressure for repeated reports.

**Cached Data**:

| Data | Storage | Key Pattern | Scope | TTL |
|------|---------|-------------|-------|-----|
| User Profiles | localStorage | workspace-scoped | Per workspace | Session-based |
| Holidays | localStorage | workspace-scoped | Per workspace | Session-based |
| Time-Off | localStorage | workspace-scoped | Per workspace | Session-based |
| Report Results | sessionStorage | `otplus_report_cache` | Per tab | 5 minutes |

**Cache Architecture**:

```
┌─────────────────────────────────────────────────────────────────┐
│                   CACHING LAYERS                                │
├─────────────────────────────────────────────────────────────────┤
│ Layer 1: In-Memory Maps (fastest)                               │
│   store.profiles: Map<userId, UserProfile>                      │
│   store.holidays: Map<userId, Map<dateKey, Holiday>>            │
│   store.timeOff: Map<userId, Map<dateKey, TimeOffInfo>>         │
│                                                                 │
│ Layer 2: localStorage (persists across page reloads)            │
│   Key: workspace-scoped to prevent cross-workspace leakage      │
│   Format: Serialized JSON with version marker                   │
│                                                                 │
│ Layer 3: sessionStorage (per-tab, auto-cleared)                 │
│   Report cache with 5-minute TTL                                │
│   Prevents redundant recalculations on UI interactions          │
└─────────────────────────────────────────────────────────────────┘
```

**Cache Invalidation**:

| Trigger | Action |
|---------|--------|
| Workspace change | Clear all caches (profiles, holidays, timeOff) |
| Manual "Refresh" | Bypass cache, force re-fetch from API |
| TTL expiry (report cache) | Re-generate report on next request |
| Page reload | In-memory cleared; localStorage persists |
| Session end | sessionStorage (report cache) cleared |

**Versioned Cache Keys**:
- Cache keys include version markers to handle schema changes
- Old cache format auto-invalidated on version mismatch
- Prevents stale data issues after addon updates

**Performance Impact**:
- First report: Full API fetch (profiles, holidays, time-off)
- Subsequent reports (same workspace): Uses cached data
- Report cache: Immediate re-render without recalculation
- Target: <2s for cached reports vs <5s for fresh fetches

---

## 9. UI Conventions

### 9.1 Table Columns

**Detailed Table**:
| Column | Description |
|--------|-------------|
| Date | Entry date (YYYY-MM-DD) |
| Start | Start time |
| End | End time |
| User | User name |
| Regular | Regular hours |
| Overtime | Overtime hours |
| Billable | Billable flag (Yes/No) |
| Rate $/h | Hourly rate |
| Regular $ | Regular amount |
| OT $ | Overtime amount (with premium) |
| T2 $ | Tier 2 premium (additional) |
| Total $ | Total amount |
| Status | System badges + entry tags |

**Summary Table**:
| Column | Description |
|--------|-------------|
| Group | Group key (user/project/client/task/date/week) |
| Capacity | Expected capacity |
| Regular | Total regular hours |
| Overtime | Total overtime hours |
| Total | Total hours |
| Break | Break hours |
| Billable Worked | Billable regular hours |
| Billable OT | Billable overtime hours |
| Non-Billable OT | Non-billable overtime hours |
| Time off | Time off hours |
| Amount | Total amount (selected mode) |
| Profit | Profit amount |

### 9.2 Status Badges

Status column shows system badges plus entry tags:

| Badge | Meaning | Color |
|-------|---------|-------|
| HOLIDAY | Holiday day | Teal/Cyan |
| OFF-DAY | Non-working day (per profile) | Orange |
| TIME-OFF | Time off request | Purple |
| BREAK | Break entry | Gray |

Entry tags from Clockify are displayed after system badges.

### 9.3 Grouping Options

Summary table can be grouped by:
- **User**: One row per user
- **Project**: One row per project
- **Client**: One row per client
- **Task**: One row per task
- **Date**: One row per calendar day
- **Week**: One row per ISO week

### 9.4 Display Formatting

**Decimal Time Toggle** (`config.showDecimalTime`):
- `true`: Display as decimal hours (e.g., "8.50")
- `false`: Display as hours:minutes (e.g., "8h 30m")

**Amount Display Mode** (`config.amountDisplay`):
- `earned`: Show billable/earned amounts
- `cost`: Show cost amounts
- `profit`: Show profit amounts (earned - cost)

### 9.5 Pagination

**Detailed Table**:
- 50 entries per page
- Client-side pagination
- Filter chips for filtering before pagination

**API Pagination**:
- 200 entries per page (Reports API)
- Default max: 50 pages (10,000 entries)
- Hard limit: 500 pages

### 9.6 Filter Chips

Filter options in detailed view:
- **All**: Show all entries
- **Holiday**: Show only entries on holiday days
- **Off-day**: Show only entries on non-working days
- **Billable**: Show only billable entries

### 9.7 Resilience & User Feedback

OTPLUS provides visual feedback during operations and gracefully handles errors.

**Progress Indicators**:

| Indicator | When Shown | Location |
|-----------|------------|----------|
| Loading spinner | During report generation | Generate button / main area |
| Progress percentage | During large fetches (100+ users) | Status bar |
| "Fetching profiles..." | During profile batch fetch | Status message |
| "Fetching holidays..." | During holiday fetch | Status message |

**Warning Banners**:

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠ Throttle Warning Banner                                       │
│   Shown when: Rate limited by Clockify API (HTTP 429)           │
│   Content: "Rate limited. Retrying in X seconds..."             │
│   Action: Auto-dismiss after successful retry                   │
├─────────────────────────────────────────────────────────────────┤
│ ⚠ Partial Failure Banner                                        │
│   Shown when: Some data fetches failed but report generated     │
│   Content: "3 profiles failed to load. Using defaults."         │
│   Action: "Retry failed fetches" button                         │
├─────────────────────────────────────────────────────────────────┤
│ ⚠ Date Range Warning                                            │
│   Shown when: Selected range > 3 months with 100+ users         │
│   Content: "Large date range may impact performance"            │
│   Action: Informational only                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Graceful Degradation in UI**:

| Scenario | UI Behavior |
|----------|-------------|
| Missing profile | Shows user with default capacity (8h) |
| Missing holidays | Detects from entry types; no badge if undetectable |
| Missing time-off | Detects from entry types; no badge if undetectable |
| Missing rate | Shows $0 for amounts; hours still accurate |
| Network error | Shows error dialog with retry option |

**"Retry Failed Fetches" Button**:
- Appears when `apiStatus.profilesFailed > 0 || holidaysFailed > 0 || timeOffFailed > 0`
- Only retries failed datasets (not all data)
- Updates report in place after successful retry
- Shows count of items to retry

---

## 10. Security

### 10.1 XSS Prevention

All server-provided strings must be treated as untrusted:

```typescript
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

**Escaped Fields**:
- User names
- Project names
- Client names
- Task names
- Entry descriptions
- Tag names

**Never use** `innerHTML` without sanitization.

### 10.2 CSV Formula Injection Mitigation

Prevent spreadsheet formula execution in CSV exports:

```typescript
function sanitizeFormulaInjection(value: string): string {
    if (!value || typeof value !== 'string') return value;

    // Dangerous prefixes that can execute formulas
    const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
    const trimmed = value.trim();

    for (const prefix of dangerousPrefixes) {
        if (trimmed.startsWith(prefix)) {
            return "'" + value;  // Prefix with single quote
        }
    }

    // Also check quoted values like "=SUM(1,1)"
    if (trimmed.startsWith('"') && trimmed.length > 1) {
        const inner = trimmed.slice(1);
        for (const prefix of dangerousPrefixes) {
            if (inner.startsWith(prefix)) {
                return "'" + value;
            }
        }
    }

    return value;
}
```

**Applied to**:
- All user-provided text (names, descriptions)
- All Clockify-provided text (project names, etc.)
- Applied before CSV escaping

### 10.3 No Secrets Policy

**Never log or persist**:
- Authentication tokens (except in memory)
- Workspace IDs (in logs)
- User email addresses
- Any PII

**Token Handling**:
- Passed via URL parameter `auth_token`
- Stored only in memory (`store.token`)
- Used only in `X-Addon-Token` header
- Cleared on page unload

---

## 11. Testing & Commands

### 11.1 NPM Scripts

```bash
# Run all tests
npm test

# Run single test file
npm test -- __tests__/unit/calc.test.js

# Run tests matching pattern
npm test -- --testNamePattern="overtime"

# Watch mode (re-run on changes)
npm run test:watch

# Coverage report (enforces 80% threshold)
npm run test:coverage

# E2E tests (requires Playwright browsers)
npm run test:e2e

# Lint
npm run lint

# Type check
npm run typecheck

# Build for production
npm run build:prod
```

### 11.2 Test Coverage Requirements

- Minimum threshold: **80%**
- Coverage report generated in `coverage/` directory
- CI fails if coverage drops below threshold

### 11.3 Key Test Scenarios

**Calculation Tests** (`calc.test.js`):
- Basic OT calculation (work beyond capacity)
- BREAK entries don't accumulate toward capacity
- PTO entries don't trigger OT
- Holiday days have zero capacity
- Non-working days have zero capacity
- Time-off reduces capacity
- Tier 2 premium calculation
- Billable/non-billable split
- Edge case: midnight-spanning entries

**API Tests** (`api.test.js`):
- Rate limiting (token bucket)
- Retry on 429
- No retry on 401/403/404
- Pagination handling
- Abort signal propagation

**State Tests** (`state.test.js`):
- Config persistence
- Override validation
- Cache management
- Pub/Sub notifications

**Export Tests** (`export.test.js`):
- Formula injection prevention
- CSV escaping
- Column headers

### 11.4 Build Process

```bash
# Development
npm run dev           # Start dev server

# Production build
npm run build:prod    # TypeScript compile + bundle + minify

# Type checking only
npm run typecheck
```

---

## 12. Edge Cases & Constraints

### 12.1 Midnight-Spanning Entries

**Rule**: Entries spanning midnight are attributed entirely to the **start day**.

```
Entry: 10 PM (Day 1) to 2 AM (Day 2) = 4 hours
Result: All 4 hours count on Day 1

Rationale:
- Matches Clockify's native reporting behavior
- Simplifies implementation (no splitting across dates)
- Predictable for users
```

**Consequence**: Late-night work crossing midnight may show unexpected OT if Day 1's capacity is already met.

### 12.2 Missing Data Handling

**Missing Profile**:
- Fall back to global daily threshold
- No error, just use defaults

**Missing Holidays**:
- Fall back to entry-type detection
- If entry.type === 'HOLIDAY' and applyHolidays is off, treat as holiday

**Missing Time-Off**:
- Fall back to entry-type detection
- If entry.type === 'TIME_OFF', sum durations for capacity reduction

**Missing Rate**:
- Default to 0
- No crash, amounts will be $0

**Malformed Duration**:
- Log warning
- Calculate from start/end timestamps
- If both fail, duration = 0

### 12.3 Memory Considerations

**Large Date Ranges**:
- Analysis results kept in memory
- Extremely large ranges (>1 year) for large teams may exceed memory
- Recommend limiting to 3 months for teams >100 users

**Report Cache**:
- Stored in sessionStorage
- 5-minute TTL
- Automatically cleared on session end
- May hit quota limits on very large reports

### 12.4 Concurrent Usage

**Multiple Tabs**:
- Each tab has its own memory state
- Config persists to localStorage (shared)
- Report cache in sessionStorage (per-tab)
- May trigger more 429s if same user runs multiple reports

### 12.5 Timezone Considerations

**dateKey Extraction**:
- Uses LOCAL time, not UTC
- Prevents evening work from shifting to next day
- Example: 11 PM local time stays on current day

**API Date Formats**:
- ISO 8601 with timezone (e.g., `2026-01-20T23:00:00Z`)
- Holidays API requires `YYYY-MM-DD` date parts

---

## 13. Architecture Decision Records

### ADR-0001: Record Architecture Decisions

**Date**: 2026-01-18
**Status**: Accepted

**Decision**: We record architecturally significant decisions as ADRs in `docs/adr/` using the Michael Nygard format.

**Consequences**:
- Future changes are easier to reason about and review
- Some overhead for significant changes
- ADR trail becomes part of quality and auditability

---

### ADR-0002: Timezone, dateKey, and Midnight-Spanning Entries

**Date**: 2026-01-18
**Status**: Accepted

**Context**: Overtime is computed by day/week. Incorrect timezone handling causes miscomputed capacity and OT.

**Decision**:
1. Canonical timezone priority: workspace → user setting → browser
2. dateKey derived from (instant + canonicalTimezone), DST-safe
3. Midnight-spanning entries attributed entirely to start day (no splitting)

**Consequences**:
- Reports stable across DST transitions
- Midnight-spanning entries may attribute all OT to start day
- Users aware that late-night work shows on day it began

---

### ADR-0003: Daily vs Weekly Overtime and Overlap

**Date**: 2026-01-18
**Status**: Accepted

**Context**: Some organizations use daily OT rules, others weekly, some need both.

**Decision**:
- Support 3 modes: daily, weekly, both
- Daily OT: tail attribution within each day
- Weekly OT: tail attribution across the week
- When mode = both, report 4 metrics:
  1. dailyOvertimeHours
  2. weeklyOvertimeHours
  3. overlapOvertimeHours
  4. combinedOvertimeHours (recommended for display)

**Consequences**:
- Both legal interpretations can be represented
- Requires interval math (merge/union/intersection)
- Remains deterministic and auditable

---

### ADR-0004: Caching and Rate Limiting Strategy

**Date**: 2026-01-18
**Status**: Accepted

**Context**: Large workspaces need fast reports. Clockify API has rate limits.

**Decision**:
- Token bucket rate limiter (50 req/s)
- On HTTP 429: exponential backoff + jitter + retry (capped)
- Cache profiles/holidays/time-off in localStorage (workspace-scoped)
- Use TTL and versioned cache keys
- Support cancellation via AbortController
- Track per-dataset errors, enable "Retry failed fetches"

**Consequences**:
- Significant speedup for repeated reporting
- Lower risk of 429s, better recovery
- Requires careful cache invalidation discipline

---

### ADR-0005: CSV Export Formula Injection Mitigation

**Date**: 2026-01-18
**Status**: Accepted

**Context**: CSV exports opened in spreadsheets may interpret cell values as formulas. User-controlled fields can trigger injection.

**Decision**:
- Before writing CSV cells, if trimmed value begins with: `=`, `+`, `-`, `@`, `\t`, `\r`
- Prefix with single quote (`'`)
- Rule applies even to quoted values like `"=SUM(1,1)"`

**Consequences**:
- Prevents common spreadsheet formula execution vectors
- Users can remove prefix after export if needed
- Export tests must cover edge cases

---

## Appendix A: Quick Reference Card

### Calculation Summary

```
Effective Capacity:
  perDayOverride > weeklyOverride > globalOverride > profile > default(8h)

Capacity Adjustments:
  Holiday → 0
  Non-working day → 0
  Full-day time-off → 0
  Partial time-off → capacity - hours

Entry Classification:
  BREAK → regular only, no accumulation
  HOLIDAY/TIME_OFF → regular only, no accumulation
  Others (REGULAR) → subject to OT rules

Tail Attribution:
  Sort by start time
  accumulator = 0
  For each WORK entry:
    if (acc >= cap): all OT
    if (acc + dur <= cap): all regular
    else: split at boundary
    acc += dur
```

### API Quick Reference

```
Users:     GET  /v1/workspaces/{wid}/users
Entries:   POST /v1/workspaces/{wid}/reports/detailed
Profiles:  GET  /v1/workspaces/{wid}/member-profile/{uid}
Holidays:  GET  /v1/workspaces/{wid}/holidays/in-period
Time-Off:  POST /v1/workspaces/{wid}/time-off/requests
```

### Storage Keys

```
Config:    localStorage['otplus_config']
Overrides: localStorage['overtime_overrides_{workspaceId}']
UI State:  localStorage['otplus_ui_state']
Cache:     sessionStorage['otplus_report_cache']
```

---

*End of OTPLUS Knowledge Base*
