# OTPLUS User Guide

This guide is for administrators and managers using the OTPLUS addon to generate overtime reports in Clockify.

---

## Getting Started

### What is OTPLUS
OTPLUS is a Clockify addon that provides advanced overtime analysis. It helps managers and payroll admins accurately track working hours, capacity utilization, and billable hour breakdowns while respecting individual employee schedules and regional holidays.

### How to Access the Addon
OTPLUS is available as an addon within your Clockify workspace. Access it through the Clockify interface where addons are installed.

---

## Generating Reports

### Selecting Date Range
Use the date picker to choose your reporting period. Two quick selectors are available:
- **Last Month** - Automatically selects the previous calendar month
- **This Month** - Automatically selects the current calendar month

If you select a very large range (more than 365 days), OTPLUS will ask for confirmation before fetching.

### Choosing Users
Select which team members to include in the report. You can select individual users or all users in your workspace.

### Generate and Cancel
- Click **Generate** to start building the report
- Click **Cancel** to stop a report in progress (useful for large date ranges that take too long)

If cached data exists for the same date range, OTPLUS will prompt you to reuse it or refresh for the latest data.

---

## Understanding the Views

### Summary View
The summary view provides aggregated data with:
- **Total hours breakdown** - Regular hours vs overtime hours
- **Billable vs non-billable** - See how time is categorized
- **Grouping options** - Organize data by:
  - User
  - Project
  - Client
  - Task
  - Date
  - Week

### Detailed View
The detailed view shows an entry-by-entry breakdown:
- **Pagination** - 50 entries per page for fast rendering
- **Status badges** - Visual indicators for special day types:
  - `HOLIDAY` - Company holiday
  - `OFF-DAY` - Non-working day per user's schedule
  - `TIME-OFF` - Approved time-off request
  - `BREAK` - Break time entries
- **Columns include**:
  - Date, Start, End
  - User
  - Regular hours, Overtime hours
  - Billable hours
  - Rate ($/h)
  - Regular $, OT $, T2 $, Total $
  - Status

---

## Configuration Options

### Daily Capacity Threshold
Set the number of hours that constitute a full workday. Hours worked beyond this threshold are counted as overtime.

### Overtime Basis (Daily, Weekly, Both)
Choose how overtime is computed:
- **Daily** - Overtime begins when daily capacity is exceeded.
- **Weekly** - Overtime begins when the weekly threshold is exceeded (Monday-based weeks).
- **Both** - Calculates daily and weekly overtime in parallel and reports the combined OT (maximum of the two). The summary strip adds OT Daily, OT Weekly, and OT Overlap metrics.

### Weekly Threshold (Weekly or Both)
Defines the number of hours in a week before overtime begins. Default is 40 hours.

### Overtime Multiplier (Tier 1)
Set the multiplier applied to overtime hours for cost calculations (e.g., 1.5x for time-and-a-half).

### Tier 2 Overtime
Configure a second overtime tier for extended overtime:
- **Threshold** - Hours after which Tier 2 applies
- **Multiplier** - Rate multiplier for Tier 2 hours

### Display Toggles

| Toggle | Description |
|--------|-------------|
| **Decimal time** | Show `8.50` instead of `8h 30m` |
| **Billable breakdown** | Show billable vs non-billable split |
| **Use profile capacity** | Pull daily capacity from user's Clockify profile |

### Report Time Zone
Select the time zone used to group entries into dates. If you set a Report Time Zone, it overrides the workspace time zone and the browser default. If left blank, OTPLUS uses the workspace time zone (when provided by Clockify), otherwise your browser time zone. You can choose any IANA time zone (for example, `America/Chicago`).

---

## User Overrides

Override capacity settings for individual users when their schedule differs from the default.

### Global Overrides
Set a custom daily capacity for a specific user that applies to all dates.

### Weekly Overrides
Define capacity for each day of the week for a specific user.

### Per-Day Overrides
Set capacity for specific dates (useful for partial days or special schedules).

### Copy Actions
Copy override configurations between users to save time when multiple users share the same schedule.

---

## Exporting Data

### CSV Export
Export your report data to CSV format for use in spreadsheets or payroll systems.

### Included Columns
The export includes all visible columns plus:
- `TotalHoursDecimal` - Total hours in decimal format for calculations
- `DailyOvertimeHours`, `WeeklyOvertimeHours`, `OverlapOvertimeHours`, `CombinedOvertimeHours` - Overtime breakdown fields for audits

### Formula Injection Protection
OTPLUS automatically sanitizes exported data to prevent spreadsheet formula injection attacks. Fields starting with `=`, `+`, `-`, or `@` are safely escaped.

---

## Settings Persistence

### How Settings Are Saved
- All configuration choices are saved in your browser's localStorage
- Each admin has their own independent settings
- Settings automatically survive page reloads and browser restarts

### Per-Workspace
Override configurations are saved per workspace, so switching workspaces loads the appropriate settings.

---

## Troubleshooting

### Report Taking Too Long
If a report is taking too long to generate:
1. Click **Cancel** to stop the current request
2. Try a smaller date range
3. Select fewer users

### Data Looks Wrong
If the numbers don't match expectations:
1. Check user overrides - custom capacity settings affect calculations
2. Verify the daily capacity threshold is set correctly
3. Confirm holidays and time-off are properly recorded in Clockify (half-day requests use their provided hours)
4. If dates look shifted, confirm the Report Time Zone matches your workspace or payroll policy

### Dark Mode
OTPLUS automatically follows your Clockify profile preference. To change:
1. Go to your Clockify profile settings
2. Change the theme preference to DARK or LIGHT
3. Reload the addon
