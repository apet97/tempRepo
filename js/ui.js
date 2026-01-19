/**
 * @fileoverview UI Rendering Module
 * Handles direct DOM manipulation, HTML template generation, and UI state updates.
 * Responsible for rendering the summary strip, tables, loading states, and error banners.
 * Uses a lazy initialization pattern for DOM elements.
 */

import { store } from './state.js';
import { escapeHtml, formatHours, formatCurrency, IsoUtils, formatDate, getWeekKey, formatWeekKey, classifyEntryForOvertime, parseIsoDuration } from './utils.js';

let Elements = null;

/**
 * Initialize UI elements (call after DOM is ready).
 * This lazy initialization prevents null references in tests or if the script loads before the body.
 * 
 * @param {boolean} force - Force re-initialization even if already initialized.
 * @returns {Object} Map of cached DOM elements.
 */
export function initializeElements(force = false) {
  if (Elements && !force) return Elements; // Already initialized

  Elements = {
    resultsContainer: document.getElementById('resultsContainer'),
    summaryStrip: document.getElementById('summaryStrip'),
    summaryTableBody: document.getElementById('summaryTableBody'),
    userOverridesBody: document.getElementById('userOverridesBody'),
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),
    apiStatusBanner: document.getElementById('apiStatusBanner'),
  };

  return Elements;
}

/**
 * Helper to get initialized elements, ensuring they're available.
 * @throws {Error} If called before initializeElements.
 * @returns {Object} Elements map.
 */
function getElements() {
  if (!Elements) {
    throw new Error('UI elements not initialized. Call initializeElements() first.');
  }
  return Elements;
}

// --- Renderers ---

/**
 * Toggles the loading state visualization.
 * @param {boolean} isLoading - True to show loading skeletons, false to hide.
 */
export function renderLoading(isLoading) {
  const Elements = getElements();
  if (isLoading) {
    Elements.loadingState.classList.remove('hidden');
    Elements.resultsContainer.classList.add('hidden');
    Elements.emptyState.classList.add('hidden');
  } else {
    Elements.loadingState.classList.add('hidden');
  }
}

/**
 * Renders the API status banner (warnings for failed fetches).
 * Shows which data sources (profiles, holidays, etc.) failed, implying fallback usage.
 */
export function renderApiStatus() {
  const Elements = getElements();
  const banner = Elements.apiStatusBanner;
  if (!banner) return;

  const { profilesFailed, holidaysFailed, timeOffFailed } = store.apiStatus;
  const parts = [];

  if (profilesFailed > 0) parts.push(`Profiles: ${profilesFailed} failed`);
  if (holidaysFailed > 0) parts.push(`Holidays: ${holidaysFailed} failed`);
  if (timeOffFailed > 0) parts.push(`Time Off: ${timeOffFailed} failed`);

  if (parts.length === 0) {
    banner.classList.add('hidden');
    banner.textContent = '';
  } else {
    banner.classList.remove('hidden');
    banner.textContent = `⚠️ ${parts.join(' | ')} — using fallback values`;
  }
}

/**
 * Renders the high-level summary strip (Totals).
 * Aggregates data from all processed users to display global metrics.
 * 
 * @param {Array<Object>} users - List of user analysis objects.
 */
export function renderSummaryStrip(users) {
  const Elements = getElements();
  const strip = Elements.summaryStrip;
  if (!strip) return;

  const totals = users.reduce((acc, u) => {
    acc.users += 1;
    acc.capacity += u.totals.expectedCapacity;
    acc.worked += u.totals.total;
    acc.regular += u.totals.regular;
    acc.overtime += u.totals.overtime;
    acc.breaks += u.totals.breaks;
    acc.billableWorked += u.totals.billableWorked;
    acc.nonBillableWorked += u.totals.nonBillableWorked;
    acc.billableOT += u.totals.billableOT;
    acc.nonBillableOT += u.totals.nonBillableOT;
    acc.amount += u.totals.amount;
    acc.amountBase += (u.totals.amountBase || 0);
    acc.otPremium += u.totals.otPremium;
    acc.otPremiumTier2 += (u.totals.otPremiumTier2 || 0);
    acc.holidayCount += u.totals.holidayCount;
    acc.timeOffCount += u.totals.timeOffCount;
    acc.holidayHours += (u.totals.holidayHours || 0);
    acc.timeOffHours += (u.totals.timeOffHours || 0);
    return acc;
  }, { users: 0, capacity: 0, worked: 0, regular: 0, overtime: 0, breaks: 0, billableWorked: 0, nonBillableWorked: 0, billableOT: 0, nonBillableOT: 0, amount: 0, amountBase: 0, otPremium: 0, otPremiumTier2: 0, holidayCount: 0, timeOffCount: 0, holidayHours: 0, timeOffHours: 0 });

  const showBillable = store.config.showBillableBreakdown;

  // Time metrics (always on top row)
  const timeMetrics = `
    <div class="summary-item"><span class="summary-label">Users</span><span class="summary-value">${totals.users}</span></div>
    <div class="summary-item"><span class="summary-label">Capacity</span><span class="summary-value">${formatHours(totals.capacity)}</span></div>
    <div class="summary-item"><span class="summary-label">Total time</span><span class="summary-value">${formatHours(totals.worked)}</span></div>
    <div class="summary-item"><span class="summary-label">Break</span><span class="summary-value">${formatHours(totals.breaks)}</span></div>
    <div class="summary-item"><span class="summary-label">Regular</span><span class="summary-value">${formatHours(totals.regular)}</span></div>
    <div class="summary-item danger"><span class="summary-label">Overtime</span><span class="summary-value">${formatHours(totals.overtime)}</span></div>
    ${showBillable ? `
      <div class="summary-item"><span class="summary-label">Billable time</span><span class="summary-value">${formatHours(totals.billableWorked)}</span></div>
      <div class="summary-item"><span class="summary-label">Non-billable time</span><span class="summary-value">${formatHours(totals.nonBillableWorked)}</span></div>
      <div class="summary-item"><span class="summary-label">Billable OT</span><span class="summary-value">${formatHours(totals.billableOT)}</span></div>
      <div class="summary-item"><span class="summary-label">Non-billable OT</span><span class="summary-value">${formatHours(totals.nonBillableOT)}</span></div>
    ` : ''}
    <div class="summary-item"><span class="summary-label">Holidays</span><span class="summary-value">${totals.holidayCount}</span></div>
    <div class="summary-item"><span class="summary-label">Time Off</span><span class="summary-value">${totals.timeOffCount}</span></div>
  `;

  // Money metrics (on bottom row when billable breakdown is ON)
  const moneyMetrics = `
    <div class="summary-item highlight"><span class="summary-label">Total (with OT)</span><span class="summary-value">${formatCurrency(totals.amount)}</span></div>
    <div class="summary-item"><span class="summary-label">OT Premium</span><span class="summary-value">${formatCurrency(totals.otPremium)}</span></div>
    <div class="summary-item"><span class="summary-label">Tier 2 Premium</span><span class="summary-value">${formatCurrency(totals.otPremiumTier2)}</span></div>
    <div class="summary-item"><span class="summary-label">Amount (no OT)</span><span class="summary-value">${formatCurrency(totals.amountBase)}</span></div>
  `;

  // Two-row layout when billable breakdown is ON
  if (showBillable) {
    strip.innerHTML = `
      <div class="summary-row summary-row-top">${timeMetrics}</div>
      <div class="summary-row summary-row-bottom">${moneyMetrics}</div>
    `;
  } else {
    // Single row layout when OFF
    strip.innerHTML = timeMetrics + moneyMetrics;
  }
}

/**
 * Renders the summary expand/collapse toggle button.
 * Only shows when billable breakdown is enabled.
 */
export function renderSummaryExpandToggle() {
  const container = document.getElementById('summaryExpandToggleContainer');
  if (!container) return;

  // Only render if billable breakdown is enabled
  if (!store.config.showBillableBreakdown) {
    container.innerHTML = '';
    return;
  }

  const expanded = store.ui.summaryExpanded;
  const icon = expanded ? '▾' : '▸';
  const text = expanded ? 'Hide breakdown' : 'Show breakdown';

  container.innerHTML = `
    <button type="button" id="summaryExpandToggle" class="btn-text btn-xs"
            style="display: flex; align-items: center; gap: 4px;">
      <span class="expand-icon">${icon}</span>
      <span class="expand-text">${text}</span>
    </button>
  `;
}

/**
 * Computes summary rows grouped by the specified criterion.
 *
 * @param {Array<Object>} analysisUsers - List of user analysis objects.
 * @param {string} groupBy - Grouping criterion ('user', 'project', 'client', 'task', 'date', 'week').
 * @returns {Array<Object>} Array of grouped summary rows.
 */
function computeSummaryRows(analysisUsers, groupBy) {
  const groups = new Map();

  for (const user of analysisUsers) {
    for (const [dateKey, dayData] of user.days) {
      for (const entry of dayData.entries) {
        // Determine group key and name
        let groupKey, groupName;
        switch (groupBy) {
          case 'user':
            groupKey = user.userId;
            groupName = user.userName;
            break;
          case 'project':
            groupKey = entry.projectId || '(No Project)';
            groupName = entry.projectName || '(No Project)';
            break;
          case 'client':
            groupKey = entry.clientId || '(No Client)';
            groupName = entry.clientName || '(No Client)';
            break;
          case 'task':
            groupKey = entry.taskId || '(No Task)';
            groupName = entry.taskName || '(No Task)';
            break;
          case 'date':
            groupKey = dateKey;
            groupName = formatDate(dateKey);
            break;
          case 'week':
            groupKey = getWeekKey(dateKey);
            groupName = formatWeekKey(groupKey);
            break;
          default:
            groupKey = user.userId;
            groupName = user.userName;
        }

        // Initialize group if not exists
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            groupKey,
            groupName,
            capacity: groupBy === 'user' ? user.totals.expectedCapacity : null,
            regular: 0,
            overtime: 0,
            breaks: 0,
            total: 0,
            billableWorked: 0,
            billableOT: 0,
            nonBillableOT: 0,
            vacationEntryHours: 0,
            amount: 0,
            otPremium: 0
          });
        }

        const group = groups.get(groupKey);
        const duration = parseIsoDuration(entry.timeInterval?.duration || 'PT0H');

        // Accumulate regular and overtime from entry analysis
        group.regular += entry.analysis?.regular || 0;
        group.overtime += entry.analysis?.overtime || 0;
        group.total += duration;

        // Accumulate breaks and vacation
        const entryClass = classifyEntryForOvertime(entry);
        if (entryClass === 'break') {
          group.breaks += duration;
        } else if (entryClass === 'pto') {
          group.vacationEntryHours += duration;
        }

        // Billable breakdown
        if (entry.billable) {
          group.billableWorked += entry.analysis?.regular || 0;
          group.billableOT += entry.analysis?.overtime || 0;
        } else {
          // Non-billable includes both worked and OT, but we only track non-billable OT separately
          group.nonBillableOT += entry.analysis?.overtime || 0;
        }

        // Cost
        group.amount += entry.analysis?.cost || 0;

        // Calculate OT premium
        const regularCost = (entry.analysis?.regular || 0) * ((entry.hourlyRate?.amount || 0) / 100);
        const otCost = (entry.analysis?.cost || 0) - regularCost;
        const otPremiumOnly = otCost - ((entry.analysis?.overtime || 0) * ((entry.hourlyRate?.amount || 0) / 100));
        group.otPremium += otPremiumOnly;
      }
    }

    // For user grouping, if a user has no entries, still include them
    if (groupBy === 'user' && !groups.has(user.userId)) {
      groups.set(user.userId, {
        groupKey: user.userId,
        groupName: user.userName,
        capacity: user.totals.expectedCapacity,
        regular: 0,
        overtime: 0,
        breaks: 0,
        total: 0,
        billableWorked: 0,
        billableOT: 0,
        nonBillableOT: 0,
        vacationEntryHours: 0,
        amount: 0,
        otPremium: 0
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.groupName.localeCompare(b.groupName));
}

/**
 * Renders summary table headers based on grouping and expanded state.
 *
 * @param {string} groupBy - Grouping criterion.
 * @param {boolean} expanded - Whether advanced columns are shown.
 * @param {boolean} showBillable - Whether billable breakdown is enabled.
 * @returns {string} HTML string for table headers.
 */
function renderSummaryHeaders(groupBy, expanded, showBillable) {
  const groupLabel = {
    user: 'User',
    project: 'Project',
    client: 'Client',
    task: 'Task',
    date: 'Date',
    week: 'Week'
  }[groupBy] || 'User';

  let headers = `<th>${groupLabel}</th>`;

  // Capacity only shown for user grouping
  if (groupBy === 'user') {
    headers += `<th class="text-right">Capacity</th>`;
  }

  headers += `
    <th class="text-right">Regular</th>
    <th class="text-right">Overtime</th>
    <th class="text-right">Breaks</th>
  `;

  // Advanced columns (shown when expanded and billable breakdown enabled)
  if (expanded && showBillable) {
    headers += `
      <th class="text-right">Bill. Worked</th>
      <th class="text-right">Bill. OT</th>
      <th class="text-right">Non-Bill OT</th>
    `;
  }

  headers += `
    <th class="text-right">Total</th>
    <th class="text-right">Vacation</th>
    <th class="text-right">Amount</th>
  `;

  return headers;
}

/**
 * Renders a single summary table row.
 *
 * @param {Object} row - Summary row data.
 * @param {string} groupBy - Grouping criterion.
 * @param {boolean} expanded - Whether advanced columns are shown.
 * @param {boolean} showBillable - Whether billable breakdown is enabled.
 * @returns {string} HTML string for table row.
 */
function renderSummaryRow(row, groupBy, expanded, showBillable) {
  const isHighOt = row.total > 0 && (row.overtime / row.total) > 0.3;

  // For user grouping, show avatar
  let nameCell;
  if (groupBy === 'user') {
    const initials = row.groupName.slice(0, 2).toUpperCase();
    nameCell = `
      <td class="text-left">
        <div class="user-cell" style="display:flex; align-items:center; gap:8px;">
          <span class="user-avatar" style="display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; background:#03a9f4; color:#fff; border-radius:50%; font-size:10px;">${escapeHtml(initials)}</span>
          <span class="user-name">${escapeHtml(row.groupName)}</span>
          ${isHighOt ? '<span style="font-size:9px; color:red; border:1px solid red; padding:0 4px; border-radius:4px;">HIGH OT</span>' : ''}
        </div>
      </td>
    `;
  } else {
    nameCell = `<td class="text-left">${escapeHtml(row.groupName)}</td>`;
  }

  let html = nameCell;

  // Capacity column (only for user grouping)
  if (groupBy === 'user') {
    html += `<td class="text-right">${formatHours(row.capacity || 0)}</td>`;
  }

  html += `
    <td class="text-right">${formatHours(row.regular)}</td>
    <td class="text-right ${row.overtime > 0 ? 'text-danger' : ''}">${formatHours(row.overtime)}</td>
    <td class="text-right">${formatHours(row.breaks)}</td>
  `;

  // Advanced columns
  if (expanded && showBillable) {
    html += `
      <td class="text-right">${formatHours(row.billableWorked)}</td>
      <td class="text-right">${formatHours(row.billableOT)}</td>
      <td class="text-right">${formatHours(row.nonBillableOT)}</td>
    `;
  }

  html += `
    <td class="text-right font-bold">${formatHours(row.total)}</td>
    <td class="text-right" title="Vacation Entry Hours">${formatHours(row.vacationEntryHours)}</td>
    <td class="text-right font-bold">${formatCurrency(row.amount)}</td>
  `;

  return html;
}

/**
 * Renders the Summary Table (per-user rows).
 *
 * @param {Array<Object>} users - List of user analysis objects.
 */
export function renderSummaryTable(users) {
  const Elements = getElements();
  const groupBy = store.ui.summaryGroupBy || 'user';
  const expanded = store.ui.summaryExpanded || false;
  const showBillable = store.config.showBillableBreakdown;

  // Compute grouped rows
  const rows = computeSummaryRows(users, groupBy);

  // Update header
  const thead = document.querySelector('#summaryCard thead tr');
  if (thead) {
    thead.innerHTML = renderSummaryHeaders(groupBy, expanded, showBillable);
  }

  // Render rows
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = 'summary-row';
    tr.innerHTML = renderSummaryRow(row, groupBy, expanded, showBillable);
    fragment.appendChild(tr);
  }

  Elements.summaryTableBody.innerHTML = '';
  Elements.summaryTableBody.appendChild(fragment);
  Elements.resultsContainer.classList.remove('hidden');
}

/**
 * Renders the Detailed Table (granular entries).
 * Supports client-side filtering and pagination.
 * 
 * @param {Array<Object>} users - List of user analysis objects.
 * @param {string|null} [activeFilter] - Filter key ('all', 'holiday', 'offday', 'billable').
 */
export function renderDetailedTable(users, activeFilter = null) {
  const Elements = getElements();
  const container = document.getElementById('detailedTableContainer');
  if (!container) return;

  // Use stored filter if not provided, otherwise update store
  if (activeFilter) {
    store.ui.activeDetailedFilter = activeFilter;
    store.ui.detailedPage = 1; // Reset to page 1 on filter change
  }
  const currentFilter = store.ui.activeDetailedFilter || 'all';

  // Flatten entries and attach day metadata
  // MEDIUM FIX #18: Access d.meta.* instead of d.* for day metadata
  let allEntries = users.flatMap(u =>
    Array.from(u.days.values()).flatMap(d =>
      d.entries.map(e => ({
        ...e,
        userName: u.userName,
        dayMeta: {
          isHoliday: d.meta?.isHoliday || false,
          holidayName: d.meta?.holidayName || '',
          isNonWorking: d.meta?.isNonWorking || false,
          isTimeOff: d.meta?.isTimeOff || false
        }
      }))
    )
  ).sort((a, b) => (b.timeInterval.start || '').localeCompare(a.timeInterval.start || ''));

  // Apply filters
  if (currentFilter === 'holiday') {
    allEntries = allEntries.filter(e => e.dayMeta.isHoliday);
  } else if (currentFilter === 'offday') {
    allEntries = allEntries.filter(e => e.dayMeta.isNonWorking);
  } else if (currentFilter === 'billable') {
    allEntries = allEntries.filter(e => e.analysis?.isBillable);
  }

  // Update Chips UI
  document.querySelectorAll('#detailedFilters .chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === currentFilter);
  });

  if (allEntries.length === 0) {
    container.innerHTML = `<p style="text-align:center; padding:40px; color:var(--text-muted);">No entries found for filter: <strong>${escapeHtml(currentFilter)}</strong></p>`;
    return;
  }

  // Pagination Logic
  const pageSize = store.ui.detailedPageSize || 50;
  const page = store.ui.detailedPage || 1;
  const totalPages = Math.ceil(allEntries.length / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageEntries = allEntries.slice(start, end);

  // Helper to format time as HH:mm
  const formatTime = (isoString) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '—';
    }
  };

  let html = `
  <div class="table-scroll" style="margin-top: 10px;">
    <table class="report-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Start</th>
          <th>End</th>
          <th>User</th>
          <th>Description</th>
          <th class="text-right">Regular</th>
          <th class="text-right">Overtime</th>
          <th class="text-right">Billable</th>
          <th class="text-right">Rate ($/hr)</th>
          <th class="text-right">Regular $</th>
          <th class="text-right">OT $</th>
          <th class="text-right">Tier2 $</th>
          <th class="text-right">Total $</th>
          <th class="text-right">Tags</th>
        </tr>
      </thead>
      <tbody>`;

  pageEntries.forEach(e => {
    const date = (e.timeInterval.start || '').split('T')[0];
    const tags = [];

    if (e.dayMeta.isHoliday) {
      tags.push(`<span class="badge badge-holiday" title="${escapeHtml(e.dayMeta.holidayName || 'Holiday')}">HOLIDAY</span>`);
    }
    if (e.dayMeta.isNonWorking) {
      tags.push('<span class="badge badge-offday">OFF-DAY</span>');
    }
    if (e.dayMeta.isTimeOff) {
      tags.push('<span class="badge badge-timeoff">TIME-OFF</span>');
    }

    // BREAK badge
    const entryClass = classifyEntryForOvertime(e);
    if (entryClass === 'break') {
      tags.push('<span class="badge badge-break">BREAK</span>');
    }

    // Existing entry tags
    const systemTags = ['HOLIDAY', 'OFF-DAY', 'TIME-OFF'];
    (e.analysis?.tags || []).forEach(t => {
      if (!systemTags.includes(t)) {
        tags.push(`<span class="badge badge-offday">${escapeHtml(t)}</span>`);
      }
    });

    const billable = e.analysis?.isBillable
      ? '<span class="badge badge-billable">✓</span>'
      : '<span style="color:var(--text-muted)">—</span>';

    html += `
    <tr>
        <td>${escapeHtml(date)}</td>
        <td>${formatTime(e.timeInterval?.start)}</td>
        <td>${formatTime(e.timeInterval?.end)}</td>
        <td>${escapeHtml(e.userName)}</td>
        <td>${escapeHtml(e.description || '(No description)')}</td>
        <td class="text-right">${formatHours(e.analysis?.regular || 0)}</td>
        <td class="text-right ${(e.analysis?.overtime || 0) > 0 ? 'text-danger' : ''}">${formatHours(e.analysis?.overtime || 0)}</td>
        <td class="text-right">${billable}</td>
        <td class="text-right">${formatCurrency(e.analysis?.hourlyRate || 0)}</td>
        <td class="text-right">${formatCurrency(e.analysis?.regularAmount || 0)}</td>
        <td class="text-right">${formatCurrency((e.analysis?.overtimeAmountBase || 0) + (e.analysis?.tier1Premium || 0))}</td>
        <td class="text-right">${formatCurrency(e.analysis?.tier2Premium || 0)}</td>
        <td class="text-right highlight">${formatCurrency(e.analysis?.totalAmountWithOT || 0)}</td>
        <td class="text-right" style="gap:4px; display:flex; justify-content:flex-end;">${tags.join(' ') || '—'}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  // Pagination Controls
  if (totalPages > 1) {
    html += `
      <div class="pagination-controls" style="display:flex; justify-content:center; align-items:center; gap:10px; margin-top:16px;">
          <button class="btn-secondary btn-sm pagination-btn" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">Previous</button>
          <span style="font-size:12px; color:var(--text-secondary);">Page ${page} of ${totalPages}</span>
          <button class="btn-secondary btn-sm pagination-btn" ${page === totalPages ? 'disabled' : ''} data-page="${page + 1}">Next</button>
      </div>`;
  }

  container.innerHTML = html;
}

/**
 * Helper function to generate per-day override inputs HTML.
 * @param {string} userId - User ID.
 * @param {Object} perDayOverrides - Per-day overrides object.
 * @param {number|null} profileCapacity - Profile capacity for placeholder.
 * @param {number} defaultPlaceholder - Default placeholder capacity.
 * @returns {string} HTML string for per-day inputs.
 */
function renderPerDayInputs(userId, perDayOverrides, profileCapacity, defaultPlaceholder) {
  // Get date range from UI inputs
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');

  if (!startInput?.value || !endInput?.value) {
    return '<p class="muted" style="padding: 1rem;">Select a date range to configure per-day overrides.</p>';
  }

  const dates = IsoUtils.generateDateRange(startInput.value, endInput.value);
  const override = store.overrides[userId] || {};
  const hasGlobalValues = override.capacity || override.multiplier;

  let html = '<div class="per-day-inputs-container">';

  // Add "Copy from global" button if global values exist
  if (hasGlobalValues) {
    html += '<div class="per-day-actions">';
    html += `<button class="copy-from-global-btn" data-userid="${userId}">`;
    html += '📋 Copy from global override';
    html += '</button>';
    html += '<span class="muted"> (Capacity: ' + (override.capacity || 'default') + ', Multiplier: ' + (override.multiplier || 'default') + ')</span>';
    html += '</div>';
  }

  html += '<table class="per-day-table">';
  html += '<thead><tr><th>Date</th><th>Day</th><th>Capacity</th><th>Multiplier</th><th>Tier2 Threshold</th><th>Tier2 Mult</th></tr></thead>';
  html += '<tbody>';

  dates.forEach(dateKey => {
    const weekday = IsoUtils.getWeekdayKey(dateKey);
    const dayOverride = perDayOverrides[dateKey] || {};

    html += `<tr>
            <td>${dateKey}</td>
            <td class="weekday">${weekday}</td>
            <td>
                <input type="number"
                       class="per-day-input"
                       data-userid="${userId}"
                       data-datekey="${dateKey}"
                       data-field="capacity"
                       value="${dayOverride.capacity || ''}"
                       placeholder="${defaultPlaceholder}"
                       step="0.5" min="0" max="24" />
            </td>
            <td>
                <input type="number"
                       class="per-day-input"
                       data-userid="${userId}"
                       data-datekey="${dateKey}"
                       data-field="multiplier"
                       value="${dayOverride.multiplier || ''}"
                       placeholder="${store.calcParams.overtimeMultiplier}"
                       step="0.1" min="1" max="5" />
            </td>
            <td>
                <input type="number"
                       class="per-day-input"
                       data-userid="${userId}"
                       data-datekey="${dateKey}"
                       data-field="tier2Threshold"
                       value="${dayOverride.tier2Threshold || ''}"
                       placeholder="0"
                       step="1" min="0" max="999" />
            </td>
            <td>
                <input type="number"
                       class="per-day-input"
                       data-userid="${userId}"
                       data-datekey="${dateKey}"
                       data-field="tier2Multiplier"
                       value="${dayOverride.tier2Multiplier || ''}"
                       placeholder="${store.calcParams.tier2Multiplier || 2.0}"
                       step="0.1" min="1" max="5" />
            </td>
        </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

/**
 * Renders weekly inputs for a user (7 rows for each weekday).
 * @param {string} userId - User ID.
 * @param {Object} weeklyOverrides - Weekly overrides object.
 * @param {number} profileCapacity - Profile capacity fallback.
 * @param {string} defaultPlaceholder - Placeholder text for capacity.
 * @returns {string} HTML string for weekly inputs.
 */
function renderWeeklyInputs(userId, weeklyOverrides, profileCapacity, defaultPlaceholder) {
  const override = store.overrides[userId] || {};
  const hasGlobalValues = override.capacity || override.multiplier;
  const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  let html = '<div class="weekly-inputs-container">';

  // Copy from global button
  if (hasGlobalValues) {
    html += `<div class="weekly-actions">
        <button class="copy-global-to-weekly-btn" data-userid="${userId}">
            📋 Copy from global
        </button>
        <span class="muted">Global: ${override.capacity || 'default'}h, ${override.multiplier || 'default'}x</span>
    </div>`;
  }

  html += '<table class="weekly-table">';
  html += '<thead><tr><th>Weekday</th><th>Capacity (hrs)</th><th>Multiplier (x)</th><th>Tier2 Threshold</th><th>Tier2 Mult</th></tr></thead>';
  html += '<tbody>';

  weekdays.forEach(weekday => {
    const dayOverride = weeklyOverrides[weekday] || {};
    const label = weekday.charAt(0) + weekday.slice(1).toLowerCase();

    html += `<tr>
        <td class="weekday-label">${label}</td>
        <td>
            <input type="number" class="weekly-input"
                   data-userid="${userId}"
                   data-weekday="${weekday}"
                   data-field="capacity"
                   value="${dayOverride.capacity || ''}"
                   placeholder="${defaultPlaceholder}"
                   step="0.5" min="0" max="24" />
        </td>
        <td>
            <input type="number" class="weekly-input"
                   data-userid="${userId}"
                   data-weekday="${weekday}"
                   data-field="multiplier"
                   value="${dayOverride.multiplier || ''}"
                   placeholder="${store.calcParams.overtimeMultiplier}"
                   step="0.1" min="1" max="5" />
        </td>
        <td>
            <input type="number" class="weekly-input"
                   data-userid="${userId}"
                   data-weekday="${weekday}"
                   data-field="tier2Threshold"
                   value="${dayOverride.tier2Threshold || ''}"
                   placeholder="0"
                   step="1" min="0" max="999" />
        </td>
        <td>
            <input type="number" class="weekly-input"
                   data-userid="${userId}"
                   data-weekday="${weekday}"
                   data-field="tier2Multiplier"
                   value="${dayOverride.tier2Multiplier || ''}"
                   placeholder="${store.calcParams.tier2Multiplier || 2.0}"
                   step="0.1" min="1" max="5" />
        </td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  return html;
}

/**
 * Renders the User Overrides table (configuration inputs per user).
 */
export function renderOverridesTable() {
  const Elements = getElements();
  const fragment = document.createDocumentFragment();

  if (!store.users.length) return;

  store.users.forEach(user => {
    const override = store.getUserOverride(user.id);
    const mode = override.mode || 'global';
    const profile = store.profiles.get(user.id);
    const profileCapacity = profile?.workCapacityHours;
    const tr = document.createElement('tr');

    const hasCustom = override.capacity || override.multiplier;
    const placeholder = profileCapacity != null ? profileCapacity : store.calcParams.dailyThreshold;

    tr.innerHTML = `
      <td>
        ${escapeHtml(user.name)}
        ${hasCustom ? '<span style="font-size:9px; color:#03a9f4; font-weight:bold; margin-left:4px;">CUSTOM</span>' : ''}
        ${profileCapacity != null ? `<span style="font-size:9px; color:var(--text-muted); margin-left:4px;">(${profileCapacity}h profile)</span>` : ''}
      </td>
      <td>
        <select class="mode-select"
                data-userid="${user.id}"
                aria-label="Override mode for ${escapeHtml(user.name)}">
          <option value="global" ${mode === 'global' ? 'selected' : ''}>Global</option>
          <option value="weekly" ${mode === 'weekly' ? 'selected' : ''}>Weekly</option>
          <option value="perDay" ${mode === 'perDay' ? 'selected' : ''}>Per Day</option>
        </select>
      </td>
      <td>
        <input type="number"
               class="override-input ${override.capacity ? '' : 'inherited'}"
               data-userid="${user.id}"
               data-field="capacity"
               placeholder="${placeholder}"
               value="${override.capacity || ''}"
               step="0.5" min="0" max="24"
               aria-label="Capacity override for ${escapeHtml(user.name)}">
      </td>
      <td>
        <input type="number"
               class="override-input ${override.multiplier ? '' : 'inherited'}"
               data-userid="${user.id}"
               data-field="multiplier"
               placeholder="${store.calcParams.overtimeMultiplier}"
               value="${override.multiplier || ''}"
               step="0.1" min="1" max="5"
               aria-label="Overtime multiplier for ${escapeHtml(user.name)}">
      </td>
      <td>
        <input type="number"
               class="override-input ${override.tier2Threshold ? '' : 'inherited'}"
               data-userid="${user.id}"
               data-field="tier2Threshold"
               placeholder="0"
               value="${override.tier2Threshold || ''}"
               step="1" min="0" max="999"
               aria-label="Tier2 Threshold for ${escapeHtml(user.name)}">
      </td>
      <td>
        <input type="number"
               class="override-input ${override.tier2Multiplier ? '' : 'inherited'}"
               data-userid="${user.id}"
               data-field="tier2Multiplier"
               placeholder="${store.calcParams.tier2Multiplier || 2.0}"
               value="${override.tier2Multiplier || ''}"
               step="0.1" min="1" max="5"
               aria-label="Tier2 Multiplier for ${escapeHtml(user.name)}">
      </td>
    `;
    fragment.appendChild(tr);

    // Add per-day editor row if mode is perDay
    if (mode === 'perDay') {
      const expandedRow = document.createElement('tr');
      expandedRow.className = 'per-day-editor-row';
      expandedRow.dataset.userid = user.id;

      const expandedCell = document.createElement('td');
      expandedCell.colSpan = 6;

      // Render per-day inputs
      expandedCell.innerHTML = renderPerDayInputs(user.id, override.perDayOverrides || {}, profileCapacity, placeholder);

      expandedRow.appendChild(expandedCell);
      fragment.appendChild(expandedRow);
    }
    // Add weekly editor row if mode is weekly
    else if (mode === 'weekly') {
      const expandedRow = document.createElement('tr');
      expandedRow.className = 'weekly-editor-row';
      expandedRow.dataset.userid = user.id;

      const expandedCell = document.createElement('td');
      expandedCell.colSpan = 6;

      // Render weekly inputs
      expandedCell.innerHTML = renderWeeklyInputs(user.id, override.weeklyOverrides || {}, profileCapacity, placeholder);

      expandedRow.appendChild(expandedCell);
      fragment.appendChild(expandedRow);
    }
  });

  Elements.userOverridesBody.innerHTML = '';
  Elements.userOverridesBody.appendChild(fragment);
}

/**
 * Display error banner for user-friendly error messages.
 * MEDIUM FIX #19: Use event delegation instead of unsafe onclick attributes.
 * @param {Object|string} error - Error object or message string.
 */
export function showError(error) {
  const Elements = getElements();

  // Hide loading state if visible
  Elements.loadingState.classList.add('hidden');

  const errorData = typeof error === 'string'
    ? { title: 'Error', message: error, action: 'none', type: 'UNKNOWN' }
    : error;

  const banner = Elements.apiStatusBanner || createErrorBanner();

  // Build banner content
  const showButton = errorData.action === 'retry' || errorData.action === 'reload';
  banner.innerHTML = `
    <div class="api-status-banner-content">
      <strong>${escapeHtml(errorData.title)}</strong>: ${escapeHtml(errorData.message)}
      ${showButton ? '<button class="btn-sm btn-secondary error-action-btn">Retry</button>' : ''}
    </div>
  `;

  // MEDIUM FIX #19: Attach event listener properly instead of using onclick
  if (showButton) {
    const btn = banner.querySelector('.error-action-btn');
    if (btn) {
      btn.addEventListener('click', () => location.reload(), { once: true });
    }
  }

  banner.classList.remove('hidden');
  banner.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide error banner.
 */
export function hideError() {
  const Elements = getElements();
  const banner = Elements.apiStatusBanner;
  if (banner) {
    banner.classList.add('hidden');
    banner.textContent = '';
  }
}

/**
 * Creates the error banner DOM element if it doesn't exist.
 * @returns {HTMLElement} The banner element.
 */
function createErrorBanner() {
  const banner = document.createElement('div');
  banner.id = 'apiStatusBanner';
  banner.className = 'api-status-banner';
  document.body.insertBefore(banner, document.querySelector('.container'));
  Elements.apiStatusBanner = banner;
  return banner;
}

// --- Event Binding ---

/**
 * Binds global UI events (scrolling, inputs, buttons).
 * Uses delegation for dynamic elements like pagination.
 * 
 * @param {Object} callbacks - Callback functions for actions (onGenerate, onOverrideChange).
 */
export function bindEvents(callbacks) {
  const Elements = getElements();

  // Prevent scroll wheel from changing number inputs when focused
  document.addEventListener('wheel', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number' && document.activeElement === e.target) {
      e.preventDefault();
    }
  }, { passive: false });

  Elements.userOverridesBody.addEventListener('input', (e) => {
    // Existing global override handler
    if (e.target.matches('input.override-input')) {
      const { userid, field } = e.target.dataset;
      callbacks.onOverrideChange(userid, field, e.target.value);
    }

    // NEW: Per-day override handler
    if (e.target.matches('input.per-day-input')) {
      const { userid, datekey, field } = e.target.dataset;
      callbacks.onPerDayOverrideChange(userid, datekey, field, e.target.value);
    }

    // Weekly input handler
    if (e.target.matches('input.weekly-input')) {
      const { userid, weekday, field } = e.target.dataset;
      callbacks.onWeeklyOverrideChange(userid, weekday, field, e.target.value);
    }

    // Mode select dropdown handler
    if (e.target.matches('select.mode-select')) {
      const { userid } = e.target.dataset;
      callbacks.onOverrideModeChange(userid, e.target.value);
    }
  });

  Elements.userOverridesBody.addEventListener('click', (e) => {
    // Copy from global button (per-day mode)
    if (e.target.matches('button.copy-from-global-btn')) {
      const { userid } = e.target.dataset;
      callbacks.onCopyFromGlobal(userid);
    }

    // Copy global to weekly button (weekly mode)
    if (e.target.matches('button.copy-global-to-weekly-btn')) {
      const { userid } = e.target.dataset;
      callbacks.onCopyGlobalToWeekly(userid);
    }
  });

  // Pagination Event Delegation
  document.getElementById('detailedTableContainer')?.addEventListener('click', (e) => {
    if (e.target.matches('.pagination-btn')) {
      const newPage = parseInt(e.target.dataset.page, 10);
      if (!isNaN(newPage)) {
        store.ui.detailedPage = newPage;
        renderDetailedTable(store.analysisResults);
      }
    }
  });

  document.getElementById('generateBtn').addEventListener('click', callbacks.onGenerate);
}
