# OTPLUS Operational Guide

This guide explains what OTPLUS consumes (modules, storage, toggles) and lists every Clockify API call the addon makes so you can onboard quickly or reason about failures.

## What the addon uses

- **Detailed Report Entrypoint**: `api.fetchDetailedReport` hits `/reports/detailed`, requests 200-entry pages, and normalizes the response to look like legacy time entries with `timeInterval`, `projectId`, `taskId`, `earnedRate`, `costRate`, `tags`, and `hourlyRate` metadata.
- **Profiles, Holidays, Time Off**: Optional fetches (`fetchAllProfiles`, `fetchAllHolidays`, `fetchAllTimeOff`) populate maps that the calculation engine consults for capacity, working-day exceptions, holidays, and approved time off. Each request is batched (BATCH_SIZE = 5) and retried per the token bucket. Profile/holiday/time-off responses are persisted in localStorage with a 6-hour TTL and versioned schema; time-off hours capture `halfDayHours` or derive from period start/end when provided.
- **`state.js` store**: Single source of truth for users, overrides, config toggles, API diagnostics, and UI state. Configuration toggles (e.g., `showBillableBreakdown`, `showDecimalTime`, `useProfileCapacity`, `overtimeBasis`, `reportTimeZone`) plus numeric params (`dailyThreshold`, `weeklyThreshold`, `overtimeMultiplier`, tier 2 thresholds/multipliers) are saved under `otplus_config`. Overrides live under `overtime_overrides_{workspaceId}`, and UI settings (grouping, expansion state) under `otplus_ui_state`.
- **`calc.js` engine**: Implements tail attribution, supports daily/weekly/both overtime bases, takes per-user overrides (global/weekly/per-day), respects holidays/time-off, and tracks tier 2 premiums without altering the OT hours. Each entry receives `analysis` metadata for regular/OT hours plus daily/weekly/combined OT and money breakdowns for earned/cost/profit.
- **`ui.js` renderers**: Summary strip (two rows when billable breakdown is enabled), table grouping (user/project/client/task/date/week), detailed paginated table (Status column with badges, billable breakdown toggles), and override editors (global, weekly, per-day with copy actions).
- **`export.js`**: Builds sanitized CSVs with headers (Date, User, capacity, breakdowns, holiday flags, total/decimal hours) plus daily/weekly/combined OT columns, and protects against formula injection by prefixing `'` when cells begin with `=`, `+`, `-`, `@`, tab, or CR.

## Storage & Overrides at a glance

| Key | Contents | Notes |
|-----|----------|-------|
| `otplus_config` | `{ config: {...toggles}, calcParams: {...thresholds} }` | Loaded on startup, saved whenever toggles/inputs change. |
| `overtime_overrides_{workspaceId}` | Per-user overrides (`capacity`, `multiplier`, `tier2`), optional `.mode`, `weeklyOverrides`, `perDayOverrides`. | Copy-to-weekly/per-day helpers use the stored global values to seed editors. |
| `otplus_ui_state` | UI layout prefs (`summaryExpanded`, `summaryGroupBy`, `overridesCollapsed`). | Used to keep the last view across reloads. |
| `otplus_profiles_{workspaceId}` | Cached profile map with `{ version, timestamp, entries }`. | 6-hour TTL, versioned schema. |
| `otplus_holidays_{workspaceId}_{start}_{end}` | Cached holiday map with `{ version, timestamp, range, entries }`. | Range-scoped cache with TTL. |
| `otplus_timeoff_{workspaceId}_{start}_{end}` | Cached time-off map with `{ version, timestamp, range, entries }`. | Stores per-day hours + full-day flags. |

**Override modes**: `global`, `weekly`, `perDay`. Weekly and per-day editors expose inputs for capacity, multiplier, and tier2 controls; values are validated (no negative thresholds, multiplier >= 1) before saving.

## API call catalog

All Clockify requests go through `api.fetchWithAuth`, which attaches `X-Addon-Token`, enforces the token bucket (50 requests per second), and logs/handles 401/403/404 without retries. 429 responses trigger exponential backoff until the retry limit.

| Endpoint | Method | Purpose | Payload/Query | Notes |
|----------|--------|---------|---------------|-------|
| `/v1/workspaces/{workspaceId}/reports/detailed` | POST | Primary data source for time entries | `{ dateRangeStart, dateRangeEnd, amountShown, amounts: ['EARNED','COST','PROFIT'], detailedFilter: { page, pageSize } }` | Response may use `timeentries` or `timeEntries`; `amounts` array feeds rate/cost/profit breakdowns. |
| `/v1/workspaces/{workspaceId}/users` | GET | Seeds user list for overrides and calculations | none | Used once at load to render overrides table and ensure every user is accounted for. |
| `/v1/workspaces/{workspaceId}/member-profile/{userId}` | GET | Retrieves profile capacity and working days | none | Batched via `fetchAllProfiles`; results parsed into `{ workCapacityHours, workingDays }`. |
| `/v1/workspaces/{workspaceId}/holidays/in-period` | GET | Loads assigned holidays per user | Query: `start`, `end` (full ISO datetimes), `assigned-to=userId` | Scheduler ensures `YYYY-MM-DDTHH:mm:ssZ`; results expanded for multi-day holidays. |
| `/v1/workspaces/{workspaceId}/time-off/requests` | POST | Fetches approved time off per user list | `{ page:1, pageSize:200, users, statuses:['APPROVED'], start, end }` | Response may contain `.requests` or be an array; maps per-date hours and full-day flags. |

### Rate limiting & aborts
- `waitForToken()` refills 50 tokens every 1000 ms and pauses requests when bucket empty.
- Each fetch accepts an `AbortSignal` (provided by `AbortController` in `main.handleGenerateReport`) so the user can cancel slow reports.
- 401/403/404 errors are logged and returned without retries; 429 errors trigger delays based on `Retry-After` headers or a 5s default before retrying.

## Data flow recap
1. `main.handleGenerateReport()` cancels previous reports via the controller-level `AbortController`, increments `currentRequestId`, and shows the loading state.
2. Users are loaded once; they seed overrides and profile lookups.
3. `fetchDetailedReport()` retrieves entries for every user in a single request; optional `fetchAllProfiles`, `fetchAllHolidays`, and `fetchAllTimeOff` run in parallel and are merged with cached data when available.
4. `calculateAnalysis()` groups by user/day, determines effective capacity (overrides → profile → defaults), splits work vs OT via tail attribution with daily/weekly/both modes, and calculates money columns including tier2 premiums.
5. UI renderers consume `store.analysisResults` to display the summary strip, grouped tables, and paginated detailed entries; export and status indicators rely on the same analysis object.
