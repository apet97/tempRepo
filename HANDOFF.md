# HANDOFF.md — AI Continuity Guide for OTPLUS

This document enables another AI agent to seamlessly continue development on OTPLUS. It provides architectural context, module responsibilities, common tasks, and safety rules.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              index.html                                  │
│                         (Entry Point / DOM)                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           js/main.ts                                     │
│                    (Controller / Orchestrator)                          │
│  - Parses auth token from URL                                           │
│  - Manages AbortController for cancellation                             │
│  - Coordinates parallel API fetches                                     │
│  - Triggers calculation and render cycles                               │
└─────────────────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   js/api.ts      │  │   js/state.ts    │  │   js/ui/         │
│  (Data Layer)    │  │  (State Store)   │  │  (UI Modules)    │
│                  │  │                  │  │                  │
│ - Clockify API   │  │ - Pub/Sub store  │  │ - summary.ts     │
│ - Rate limiting  │  │ - Config persist │  │ - detailed.ts    │
│ - Retry logic    │  │ - Override data  │  │ - overrides.ts   │
│ - Pagination     │  │ - Diagnostics    │  │ - dialogs.ts     │
└──────────────────┘  └──────────────────┘  └──────────────────┘
           │                    │                    │
           └────────────────────┼────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          js/calc.ts                                      │
│                    (Pure Calculation Engine)                            │
│  - Daily overtime with tail attribution                                 │
│  - Billable/non-billable split                                          │
│  - Tiered overtime multipliers                                          │
│  - NO side effects, NO DOM, NO fetch                                    │
└─────────────────────────────────────────────────────────────────────────┘
           │                                        │
           ▼                                        ▼
┌──────────────────────────┐           ┌──────────────────────────┐
│   js/worker-manager.ts   │           │      js/export.ts        │
│  (Web Worker Lifecycle)  │           │    (CSV Generation)      │
│                          │           │                          │
│ - Offloads heavy calc    │           │ - Formula injection      │
│ - Manages worker pool    │           │   protection             │
│ - Fallback to main       │           │ - Decimal hours export   │
│   thread if needed       │           │                          │
└──────────────────────────┘           └──────────────────────────┘

Supporting Modules:
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  js/utils.ts     │  │ js/constants.ts  │  │   js/types.ts    │
│  (Utilities)     │  │   (Constants)    │  │  (TypeScript)    │
│                  │  │                  │  │                  │
│ - Date parsing   │  │ - Storage keys   │  │ - Interface defs │
│ - ISO duration   │  │ - Default values │  │ - Type guards    │
│ - Rounding       │  │ - Feature flags  │  │                  │
│ - HTML escaping  │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## 2. Module Responsibility Table

| Module | File(s) | Responsibility | Side Effects |
|--------|---------|----------------|--------------|
| **Controller** | `js/main.ts` | Orchestrates init, fetch, calc, render | DOM events, API calls |
| **API Client** | `js/api.ts` | Clockify API communication | Network requests |
| **State Store** | `js/state.ts` | Centralized reactive state, persistence | localStorage R/W |
| **Calculations** | `js/calc.ts` | Pure OT/billable logic | **None** (pure) |
| **Worker Manager** | `js/worker-manager.ts` | Web Worker lifecycle | Worker threads |
| **UI - Summary** | `js/ui/summary.ts` | Summary strip + table rendering | DOM mutations |
| **UI - Detailed** | `js/ui/detailed.ts` | Detailed table + pagination | DOM mutations |
| **UI - Overrides** | `js/ui/overrides.ts` | User override panel | DOM mutations |
| **UI - Dialogs** | `js/ui/dialogs.ts` | Modal dialogs (clear data, etc.) | DOM mutations |
| **Export** | `js/export.ts` | CSV generation with security | File download |
| **Utilities** | `js/utils.ts` | Date/time/format helpers | **None** (pure) |
| **Constants** | `js/constants.ts` | Shared constants, keys, defaults | **None** |
| **Types** | `js/types.ts` | TypeScript interfaces | **None** |
| **Error Reporting** | `js/error-reporting.ts` | Sentry integration | Network (optional) |
| **Logger** | `js/logger.ts` | Structured logging | Console output |

---

## 3. Common Development Tasks

### Add a New Configuration Option

1. **Define the type** in `js/types.ts` (add to `Config` interface)
2. **Add default value** in `js/constants.ts` (in `DEFAULT_CONFIG`)
3. **Add storage key** if needed in `js/constants.ts` (`STORAGE_KEYS`)
4. **Update state** in `js/state.ts` (getter/setter if needed)
5. **Add UI control** in `js/ui/` (likely `summary.ts` config section)
6. **Wire to calculation** in `js/calc.ts` if it affects OT logic
7. **Add test** in `__tests__/unit/` for the new behavior

### Modify Overtime Calculation

1. **Read existing logic** in `js/calc.ts` (`calculateAnalysis`, `analyzeDay`)
2. **Write tests first** in `__tests__/unit/calc.test.js`
3. **Modify pure function** in `js/calc.ts`
4. **Run `npm test`** to verify no regressions
5. **Update CLAUDE.md** if calculation rules changed

### Add a New API Endpoint

1. **Add method** in `js/api.ts` following existing patterns
2. **Respect rate limiting** (use `waitForToken()`)
3. **Accept AbortSignal** for cancellation
4. **Handle errors** (429, 5xx, network)
5. **Add to orchestration** in `js/main.ts` if needed
6. **Update `docs/guide.md`** with new endpoint documentation

### Add a New UI Component

1. **Create module** in `js/ui/` or add to existing file
2. **Export from `js/ui/index.ts`**
3. **Use DocumentFragment** for batch DOM operations
4. **Subscribe to store** for reactive updates
5. **Escape all user data** (use `escapeHtml` from utils)

---

## 4. Testing Strategy

### Test Locations

| Type | Location | Framework | Command |
|------|----------|-----------|---------|
| **Unit Tests** | `__tests__/unit/` | Jest | `npm test` |
| **E2E Tests** | `__tests__/e2e/` | Playwright | `npm run test:e2e` |
| **Performance** | `__tests__/performance/` | Jest | `npm test -- performance` |

### Key Test Files

- `calc.test.js` - Core OT calculation logic
- `calc-pto-break-work.test.js` - BREAK/PTO entry handling
- `calc-holiday-detection.test.js` - Holiday detection dual-source
- `calc-tiered-ot.test.js` - Tiered multiplier logic
- `api.test.js` - API client behavior
- `api-rate-limit.test.js` - Rate limiting compliance
- `export.test.js` - CSV security (formula injection)
- `state.test.js` - State persistence
- `utils.test.js` - Utility functions

### Running Tests

```bash
# All tests
npm test

# Single file
npm test -- __tests__/unit/calc.test.js

# Pattern match
npm test -- --testNamePattern="overtime"

# Coverage (enforces 75% threshold)
npm run test:coverage

# E2E tests
npm run test:e2e
```

---

## 5. Known Issues & Limitations

### Midnight-Spanning Entries
- **Behavior**: Entries are attributed entirely to the day they *started*
- **Example**: 10 PM - 2 AM shift = 4 hours on Day 1, 0 hours on Day 2
- **Impact**: Late-night work crossing midnight won't split capacity across days
- **Decision**: See `docs/adr/0002-timezone-datekey-and-midnight-splitting.md`

### Memory Constraints
- **Issue**: Analysis results stored in memory
- **Risk**: Very large date ranges (>1 year) for 100+ users may exceed limits
- **Mitigation**: Pagination in detailed table, progressive rendering

### Concurrent Usage
- **Issue**: Multiple tabs/addons sharing same API quota
- **Risk**: 429 errors even with proper rate limiting
- **Mitigation**: Exponential backoff, retry logic in `api.ts`

### Profile/Holiday Fetch Failures
- **Behavior**: Graceful degradation - uses defaults, shows warning banner
- **Impact**: OT calculation may be less accurate without profile capacities

---

## 6. Safety Rules (Non-Negotiable)

### Read-Only Forever
```
NEVER add POST, PATCH, or DELETE operations against Clockify APIs.
The addon ONLY reads data.
```

### No Secrets
```
NEVER log, persist, or commit:
- Auth tokens
- Workspace IDs (in logs)
- User emails
- API keys
```

### Deterministic Math
```
Same inputs MUST produce same outputs.
- No hidden timezone drift
- No random values
- Consistent rounding (4 decimals for hours, 2 for currency)
```

### Calculation Invariants
```
If test results change, either:
1. The test was wrong → fix the test
2. The change was wrong → revert
3. Business rules changed → update CLAUDE.md AND tests
```

---

## 7. Files to Read by Task

### Understanding the Codebase
1. `CLAUDE.md` - AI instruction set (primary reference)
2. `docs/spec.md` - Technical specification
3. `docs/prd.md` - Product requirements
4. `docs/guide.md` - API catalog and storage schema

### Debugging Calculation Issues
1. `js/calc.ts` - Start here (pure calculation logic)
2. `__tests__/unit/calc.test.js` - Expected behaviors
3. `CLAUDE.md` - Section "Overtime Calculation Guide"

### Debugging API Issues
1. `js/api.ts` - API client implementation
2. `docs/guide.md` - API endpoints and headers
3. `__tests__/unit/api.test.js` - Expected behaviors

### Debugging UI Issues
1. `js/ui/` directory - UI modules
2. `css/styles.css` - Styling
3. `js/state.ts` - State management

### Adding Features
1. `docs/prd.md` - Product rules (what's allowed)
2. `CLAUDE.md` - Technical constraints
3. `docs/adr/` - Architecture decisions

---

## 8. Quick Reference

### Storage Keys (localStorage)
- `otplus_config` - User configuration JSON
- `overtime_overrides_{workspaceId}` - Per-user overrides
- `otplus_cache_profiles_{workspaceId}` - Cached user profiles
- `otplus_cache_holidays_{workspaceId}` - Cached holidays

### API Authentication
- Token from URL: `?auth_token=...`
- Header: `X-Addon-Token: {token}`
- Rate limit: Token bucket, ~50 req/s max

### Entry Types
| Type | Is OT Trigger? | Can Be OT? | Counts as Regular? |
|------|----------------|------------|-------------------|
| `REGULAR` | Yes | Yes | Yes (up to capacity) |
| `BREAK` | No | No | Yes |
| `HOLIDAY` | No | No | Yes |
| `TIME_OFF` | No | No | Yes |

### Build Commands
```bash
npm run build      # Production build to dist/
npm run dev        # Development mode
npm test           # Run all tests
npm run lint       # ESLint check
npm run format     # Prettier formatting
```

---

## 9. Contact & Resources

- **Architecture Decisions**: `docs/adr/`
- **API Reference**: `docs/guide.md`, `docs/reference/clockify-openapi.yaml`
- **Product Requirements**: `docs/prd.md`
- **Technical Spec**: `docs/spec.md`

---

*Last updated: January 2026*
*Version: 2.1.0*
