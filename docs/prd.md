# OTPLUS v2.1 — Product Requirements Document

**Project:** Overtime Summary Addon (OTPLUS)  
**Version:** 2.1  
**Date:** January 2026  
**Status:** Implementation Complete / Optimized

---

## 1. Background
OTPLUS is a high-performance Clockify addon that provides advanced overtime analysis. It allows managers and payroll admins to accurately track working hours, capacity utilization, and billable hour breakdowns while respecting individual employee schedules and regional holidays.

---

## 2. Problem Statement
The v2.0 baseline suffered from performance bottlenecks when handling large teams, lacked persistence for user settings, and had minor accuracy issues due to timezone shifts. Users also lacked the ability to cancel long-running reports or navigate massive detailed logs efficiently.

---

## 3. Goals & v2.1 Improvements

### 3.1 Performance & Reliability
- **Parallel Data Orchestration:** v2.1 fetches Time Entries, Member Profiles, Holidays, and Time Off requests concurrently using `Promise.all`.
- **Iterative Rate Limiting:** Implements a global client-side token bucket (50 req/s) with an iterative wait loop to ensure stack safety and strict API compliance.
- **Request Cancellation:** Supports instant termination of pending network activity via `AbortController` when a user cancels or restarts a report.

### 3.2 Accuracy & Compliance
- **Timezone Awareness:** Uses the browser's local time for date grouping, ensuring evening work is attributed to the correct calendar day rather than shifting to the next day in UTC.
- **Holiday Compliance:** Strictly adheres to the API requirement for `YYYY-MM-DD` date formatting.
- **Precision Math:** All duration and cost calculations use `utils.round()` to eliminate floating-point drift.

### 3.3 Enhanced UX/UI
- **Persisted Configuration:** User preferences (toggles, thresholds) are automatically saved to `localStorage`, eliminating repetitive configuration.
- **Decimal Time Toggle:** UI can render time values in decimal hours (e.g., `8.50`) or `xh ym` without changing calculations.
- **Detailed Log Pagination:** High-performance rendering of granular entry logs using client-side pagination (50 entries per page).
- **Detailed Columns Fit:** Detailed view prioritizes time, rate, and money columns; status badges replace the Description column to prevent clipping.
- **Quick Selectors:** One-click presets for "Last Month" and "This Month" date ranges.
- **Accessibility:** Full ARIA support (`aria-live`, `aria-busy`) for dynamic updates and screen reader compatibility.
- **Theme Support:** Automatic application of Dark Mode if the user's Clockify profile preference is set to DARK.

---

## 4. Functional Requirements

### 4.1 Advanced Capacity Engine
- **Source Precedence:** 
  1. Manual UI Override
  2. Member Profile `workCapacity` (API)
  3. Global Default (Configurable)
- **Anomaly Detection:** Automatically sets `capacity = 0` for holidays, off-days (per profile `workingDays`), and full-day time-off requests.

### 4.2 Calculation Specification (Tail Attribution)
- Entries are sorted chronologically. 
- Regular hours are allocated first until daily capacity is reached.
- All remaining time in subsequent entries is categorized as Overtime.
- Billable and Non-Billable metrics are tracked independently for both Regular and OT buckets.

### 4.3 Secure Data Export
- **CSV Sanitization:** Implements "Smart Escaping" to double-quote fields only when necessary.
- **Formula Injection Protection:** Prevents CSV injection attacks by prepending a single quote (`'`) to any field starting with `=`, `+`, `-`, or `@`.
- **Decimal Hours Column:** Adds `TotalHoursDecimal` to CSV output while preserving existing columns.

---

## 5. UI/UX Requirements
- **Density Settings:** Supports `compact` and `spacious` layout modes via body classes.
- **Feedback Loops:** Real-time API status banner alerts users to partial failures (e.g., specific profiles failing to load) while allowing the report to finish using fallback values.
- **Interactive Reports:** Tabbed navigation between Summary (aggregated) and Detailed (granular) views with active filter chips.
- **Detailed Headers:** Columns include Rate (`Rate $/h`) and money breakdown (`Regular $`, `OT $`, `T2 $`, `Total $`) plus Status tags.

---

## 6. Success Metrics
- **Load Time:** < 3 seconds for workspaces with 50+ users.
- **Zero Freeze:** UI remains responsive during massive data fetches due to pagination and parallelization.
- **Persistence:** 100% of configuration choices survive a browser reload.
