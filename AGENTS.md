# AGENTS.md — OTPLUS (Clockify Overtime Summary Addon)

## Purpose
This repo is a Clockify addon that generates overtime summaries and a detailed overtime breakdown using Clockify’s Detailed Report data.

Primary objectives:
- Correct overtime/break/holiday/time-off classification
- Accurate totals + premiums (including Tier 2 premium)
- Clean, Clockify-native UI with working grouping + breakdown

## Working agreements
- Prefer small, targeted changes and incremental diffs, unless the user says "OVERRIDE SMALL".
- Do not add new dependencies/frameworks.
- After modifying JS, run:
  - `npm test`
- If you change calculation logic, add/adjust a unit test.

## Repo map (key files)
- `js/main.ts`: entry point / wiring / orchestration
- `js/ui/`: UI module directory containing:
  - `index.ts`: UI exports and coordination
  - `summary.ts`: Summary strip and Summary table rendering
  - `detailed.ts`: Detailed table with pagination
  - `overrides.ts`: Override mode UI and controls
  - `config.ts`: Configuration panel UI
- `css/styles.css`: addon styling (must remain Clockify-like)
- `js/state.ts`: config + overrides persistence (LocalStorage)
- `js/api.ts`: Clockify API calls (prefer Detailed Report aggregation for entries)
- `js/calc.ts`: core calculations (regular/overtime split, premiums, aggregation/grouping)
- `js/utils.ts`: formatting helpers (durations, money, dates)
- `js/export.ts`: CSV export
- `js/worker-manager.ts`: Web Worker lifecycle management for calculations
- `js/constants.ts`: shared constants, flags, and defaults
- `docs/guide.md`: explains the addon's dependencies, persistence schema, and the exact API calls it makes.

## Data and API assumptions (Detailed Report)
Entries are expected to contain:
- `timeInterval.start`, `timeInterval.end` (ISO timestamps)
- `hourlyRate.amount` (cents) when available
- `billable` flag
- project/client/task metadata when present
Do not silently drop fields needed for the UI; preserve and pass through what the UI needs.

## Business rules (do not violate)
### Hours classification
- Break entries:
  - Do NOT count as overtime triggers on regular days.
  - Must be tagged as BREAK in UI.
- Regular day:
  - Overtime is time beyond capacity.
- Holiday day:
  - Any time worked counts as overtime EXCEPT “HOLIDAY TIME ENTRY” or “TIME OFF TIME ENTRY”.
- Time off day:
  - Full day off: any worked time counts as overtime.
  - Half day off: overtime begins after half of capacity.
  - Hourly time off: calculate remaining capacity correctly.
- “HOLIDAY TIME ENTRY” and “TIME OFF TIME ENTRY” NEVER trigger overtime.

### Tiered overtime (premium-only)
- Tier 2 does not change OT hours.
- Tier 2 only changes premium dollars applied after `tier2StartsAfterOtHours`.
- Tier 2 premium must appear anywhere OT premium is presented (summary strip, per-entry columns, exports if present).

## UI requirements (from screenshots)
- Avoid fixed-width layouts that leave large empty whitespace on wide screens.
- Summary strip:
  - When Billable breakdown ON: time KPIs (row 1), money KPIs (row 2), with no huge empty region.
  - When Billable breakdown OFF: hide billable-specific KPIs and hide “Show breakdown”.
- Summary table:
  - Must render as a standard table (no “cardified” boxed cells).
  - Group by: User, Project, Client, Task, Date, Week must change aggregation.
  - “Show/Hide breakdown” only visible when Billable breakdown ON.
- Detailed table:
  - Must show Start/End time columns.
  - Must show Billable, Rate $/h, Regular $, OT $, Tier2 $, Total $, and Status.
  - Status replaces Tags; includes system badges (HOLIDAY/OFF-DAY/TIME-OFF/BREAK) plus entry tags.
  - Must not clip Status column; avoid horizontal scrolling that hides right-most columns.
  - Description column is intentionally omitted to keep columns readable.
  - Decimal time toggle (`showDecimalTime`) changes display only (no recalculation).

## Persistence (settings + overrides)
- Settings are stored in LocalStorage (see `state.js` and `STORAGE_KEYS` in `constants.js`).
- Do not change storage keys without a migration that preserves existing user settings.
- Weekly overrides must persist and should be editable for the whole week (Mon–Sun or workspace-defined week).

## Debugging checklist
1) UI layout issues:
   - Check container widths, max-width, overflow rules, table layout CSS.
2) Grouping not working:
   - Verify aggregation keys and ensure the group-by selection actually changes reducer/grouping.
3) Breakdown toggle:
   - Ensure it is gated by `showBillableBreakdown` config and does not render when OFF.
4) Detailed clipping:
   - Ensure the table wrapper uses sane overflow rules; prefer responsive column sizing and avoid fixed widths that force clipping.

## How to scope prompts (for Codex sessions)
- Treat each Codex prompt like a GitHub issue:
- list the files/components involved
- define acceptance criteria
- include repro/validation steps

## Operational Guide Reference
- Refer to `docs/guide.md` for a quick rundown of what OTPLUS uses (modules, storage, feature toggles) and every Clockify API call it executes (headers, parameters, fallbacks). Use it before filing issues or modifying data ingestion logic.
