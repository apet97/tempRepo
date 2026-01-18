# 0002. Timezone, dateKey, and midnight-spanning entry handling

Date: 2026-01-18

## Status
Proposed

## Context
Overtime is computed by day and sometimes by week. If we bucket time incorrectly (timezone drift, DST, midnight crossing),
we miscompute capacity and overtime. Current behavior must be deterministic.

## Decision
1) Canonical reporting timezone (in priority order):
   a) Workspace timezone (if available from Clockify / configuration)
   b) User-selected timezone in OTPLUS settings
   c) Browser/system timezone

2) dateKey calculation:
   - dateKey must be derived from (instant + canonicalTimezone) and must be DST-safe.
   - Implementation may use Temporal if available; otherwise use Intl.DateTimeFormat with an explicit `timeZone`.

3) Midnight-spanning entries:
   - Any time interval that crosses a local midnight boundary MUST be split into per-day segments BEFORE bucketing.
   - Segments keep a pointer to original entry id, and carry the original billable flag and metadata.

## Consequences
- Daily capacity and holiday/non-working rules apply correctly on boundary days.
- Reports become stable across DST transitions.
- Implementation complexity increases slightly due to splitting logic.
