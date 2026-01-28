# OTPLUS v2.1 — Technical Specification

**Version:** 2.1  
**Last Updated:** January 2026  
**Status:** Implementation Complete / Optimized

---

## 1. Architecture Overview
OTPLUS is a modular vanilla JavaScript application built with ES Modules. It follows a Controller-driven architecture with a centralized, reactive state store.

```mermaid
flowchart TB
    subgraph UI_Layer["UI Layer (ui.js)"]
        Components[DOM Components]
        Pagination[Client-side Pagination]
        Events[Event Listeners]
    end
    
    subgraph Controller["Controller (main.js)"]
        Init[Initialization]
        Orchestrator[Parallel Fetch Orchestrator]
        Aborts[AbortController Management]
    end

    subgraph Logic["Business Logic"]
        Calc[calc.js (Pure Logic)]
        Utils[utils.js (Smart Escaping / Precision Math)]
        Export[export.js (Secure CSV)]
    end
    
    subgraph State["State Management (state.js)"]
        Store[Central Reactive Store]
        PubSub[Pub/Sub Engine]
        Persistence[LocalStorage Sync]
    end
    
    subgraph Data["Data Layer (api.js)"]
        API[Clockify API]
        Limiter[Iterative Token Bucket]
        Auth[X-Addon-Token Handler]
    end
    
    UI_Layer --> Controller
    Controller --> Logic
    Controller --> State
    Controller --> Data
    Logic --> State
    Data --> API
```

---

## 2. State Management (Pub/Sub)
The `Store` class implements a simple Publisher/Subscriber pattern to allow UI components to react to state changes without direct coupling.

```javascript
class Store {
    constructor() {
        this.listeners = new Set();
        this.ui = { 
            detailedPage: 1, 
            detailedPageSize: 50, 
            activeDetailedFilter: 'all' 
        };
        // ... initial state
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    notify() { this.listeners.forEach(l => l(this)); }
}
```

### 2.1 UI Rendering Notes
- **Decimal Time Toggle:** `config.showDecimalTime` switches display formatting between `xh ym` and decimal hours without changing calculations.
- **Detailed Columns:** `Date`, `Start`, `End`, `User`, `Regular`, `Overtime`, `Billable`, `Rate $/h`, `Regular $`, `OT $`, `T2 $`, `Total $`, `Status`.
- **Status Tags:** Status combines system tags (HOLIDAY, OFF-DAY, TIME-OFF, BREAK) plus entry tags.

---

## 3. High-Performance Data Orchestration
v2.1 uses parallel fetches with cache-aware orchestration to saturate the client-side rate limiter and minimize waiting time.

```javascript
// Orchestration Logic in main.js
const promises = [
    Api.fetchEntries(..., { signal }),
    Api.fetchAllProfiles(..., { signal }),
    Api.fetchAllHolidays(..., { signal }),
    Api.fetchAllTimeOff(..., { signal })
];
await Promise.allSettled(promises);
```

Cached profiles, holidays, and time-off maps are loaded from localStorage first (6-hour TTL, versioned).
Only missing user IDs or ranges are fetched over the network, and successful results are persisted back to cache.

---

## 4. Rate Limiting Logic
A global token bucket ensures we never exceed 50 requests per second. The `waitForToken` function uses an iterative approach to prevent stack overflow.

```javascript
async function waitForToken() {
    while (true) {
        if (tokens > 0) {
            tokens--;
            return;
        }
        await delay(REFILL_INTERVAL - (now - lastRefill));
    }
}
```

---

## 5. Calculation Logic: Timezone Awareness
To prevent evening work from shifting to the next day, date extraction is performed using a canonical timezone instead of raw string splitting.
The canonical timezone is resolved in this order: workspace claim (if present), user-selected report timezone, then browser default.

```javascript
// extractDateKey in utils.js
extractDateKey(isoString) {
    const date = new Date(isoString);
    return formatDateKeyInTimeZone(date, canonicalTimeZone);
}
```

### 5.1 Overtime Basis Modes
OTPLUS supports three overtime bases:
- `daily` (default): overtime is calculated when daily capacity is exceeded.
- `weekly`: overtime is calculated when weeklyThreshold is exceeded across a Monday-based week.
- `both`: calculates daily and weekly overtime in parallel; combined OT uses the maximum of the two with overlap tracked separately.

---

## 6. Secure CSV Export
CSV generation uses a specialized `escapeCsv` utility to ensure data integrity and security.

| Feature | Implementation |
|----------------|----------------|
| **Smart Quoting** | Only adds double quotes if field contains `,`, `"`, `\n`, or `\r`. |
| **Quote Escaping** | Replaces `"` with `""`.
| **Injection Mitigation** | Prepends `'` to fields starting with dangerous formula characters (`=`, `+`, `-`, `@`). |
| **Decimal Hours Column** | Adds `TotalHoursDecimal` alongside `TotalHours` for decimal-friendly exports. |
| **OT Breakdown Columns** | Exports daily/weekly/overlap/combined overtime columns in addition to total OT. |

--- 

## 7. API Integration Reference

| Feature | Endpoint | Method | Note |
|---------|----------|--------|------|
| Time Entries | `/v1/workspaces/{wid}/user/{uid}/time-entries` | GET | Paginated (500/page) |
| Profiles | `/v1/workspaces/{wid}/member-profile/{uid}` | GET | Batched (5 parallel) |
| Holidays | `/v1/workspaces/{wid}/holidays/in-period` | GET | `YYYY-MM-DD` strict format |
| Time Off | `/v1/workspaces/{wid}/time-off/requests` | POST | Approved status filter |

---

## 8. Guide & Operational Reference
- The new `docs/guide.md` summarizes how each module (state, calc, UI) consumes these APIs, plus the storage schema and override workflow.
- Use the guide as a quick reference when triaging bugs or onboarding new team members—its API catalog explicitly states headers (`X-Addon-Token`), rate limiting expectations (token bucket), and abort handling via `AbortController`.

## 9. Persistence Schema (localStorage)

| Key | Value |
|-----|-------|
| `otplus_config` | JSON object containing toggles and daily/multiplier thresholds. |
| `overtime_overrides_{workspaceId}` | Map of userId -> manual overrides. |
| `otplus_profiles_{workspaceId}` | Cached profile map with `{ version, timestamp, entries }`. |
| `otplus_holidays_{workspaceId}_{start}_{end}` | Cached holiday map scoped to the report range. |
| `otplus_timeoff_{workspaceId}_{start}_{end}` | Cached time-off map scoped to the report range. |

`otplus_config.config` includes `showDecimalTime` (boolean) to persist the UI formatting toggle.

--- 

## 10. Known Technical Constraints
- **Memory Management:** Analysis results are kept in memory. Extremely large date ranges (>1 year) for large teams may exceed memory limits on low-end devices.
- **Clockify API Limits:** While we throttle to 50 req/s, concurrent usage of multiple addons or browser tabs by the same user might still trigger a server-side 429.
- **Midnight Attribution:** Entries are attributed to the day they *started*. A shift from 10 PM to 2 AM will count as 4 hours on Day 1.

---

## 11. Testing Architecture

### 11.1 Unit Testing
- Framework: Jest with ES Modules (`--experimental-vm-modules`)
- Coverage: 100% enforced via thresholds
- Test files: `__tests__/unit/*.test.js`

### 11.2 Mutation Testing
- Framework: Stryker Mutator
- Purpose: Validates test effectiveness (not just coverage)
- Config: `stryker.config.json`, `jest.stryker.config.js`

**Mutation Score (Achieved)**:
| File | Score |
|------|-------|
| calc.ts | 100% |
| utils.ts | 100% |
| api.ts | 100% |

All equivalent mutants have been addressed through targeted Stryker disable comments wrapping complete if-else chains.
