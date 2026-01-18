# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# OTPLUS (Clockify Overtime Addon)
See `docs/adr/README.md` for architecture decisions, `docs/spec.md` for technical details, `docs/prd.md` for product rules.

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

## Work style for Claude
- Before edits: write a 5–10 step plan and identify touched files.
- Make changes in small commits; run `npm test` after each logical chunk.
- If results change: add/adjust tests in the same PR.
- Prefer pure functions + explicit inputs/outputs; keep `calc.js` side-effect free.

## When in doubt
- Read `docs/spec.md` for “what exists”.
- Read `docs/prd.md` for “what is correct”.
- Update this file when conventions change.
