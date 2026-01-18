/**
 * @fileoverview UI Rendering Module
 * Handles direct DOM manipulation, HTML template generation, and UI state updates.
 * Responsible for rendering the summary strip, tables, loading states, and error banners.
 * Uses a lazy initialization pattern for DOM elements.
 */

import { store } from './state.js';
import { escapeHtml, formatHours, formatCurrency } from './utils.js';

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
    acc.otPremium += u.totals.otPremium;
    acc.holidayCount += u.totals.holidayCount;
    acc.timeOffCount += u.totals.timeOffCount;
    return acc;
  }, { users: 0, capacity: 0, worked: 0, regular: 0, overtime: 0, breaks: 0, billableWorked: 0, nonBillableWorked: 0, billableOT: 0, nonBillableOT: 0, amount: 0, otPremium: 0, holidayCount: 0, timeOffCount: 0 });

  const showBillable = store.config.showBillableBreakdown;

  strip.innerHTML = `
    <div class="summary-item"><span class="summary-label">Users</span><span class="summary-value">${totals.users}</span></div>
    <div class="summary-item"><span class="summary-label">Capacity</span><span class="summary-value">${formatHours(totals.capacity)}</span></div>
    <div class="summary-item"><span class="summary-label">Worked</span><span class="summary-value">${formatHours(totals.worked)}</span></div>
    <div class="summary-item"><span class="summary-label">Break</span><span class="summary-value">${formatHours(totals.breaks)}</span></div>
    <div class="summary-item"><span class="summary-label">Regular</span><span class="summary-value">${formatHours(totals.regular)}</span></div>
    <div class="summary-item danger"><span class="summary-label">Overtime</span><span class="summary-value">${formatHours(totals.overtime)}</span></div>
    ${showBillable ? `
      <div class="summary-item more"><span class="summary-label">Billable Worked</span><span class="summary-value">${formatHours(totals.billableWorked)}</span></div>
      <div class="summary-item more"><span class="summary-label">Non-Bill Worked</span><span class="summary-value">${formatHours(totals.nonBillableWorked)}</span></div>
      <div class="summary-item more"><span class="summary-label">Billable OT</span><span class="summary-value">${formatHours(totals.billableOT)}</span></div>
      <div class="summary-item more"><span class="summary-label">Non-Bill OT</span><span class="summary-value">${formatHours(totals.nonBillableOT)}</span></div>
    ` : ''}
    <div class="summary-item"><span class="summary-label">Holidays</span><span class="summary-value">${totals.holidayCount}</span></div>
    <div class="summary-item"><span class="summary-label">Time Off</span><span class="summary-value">${totals.timeOffCount}</span></div>
    <div class="summary-item highlight"><span class="summary-label">Total</span><span class="summary-value">${formatCurrency(totals.amount)}</span></div>
    <div class="summary-item"><span class="summary-label">OT Premium</span><span class="summary-value">${formatCurrency(totals.otPremium)}</span></div>
  `;
}

/**
 * Renders the Summary Table (per-user rows).
 * 
 * @param {Array<Object>} users - List of user analysis objects.
 */
export function renderSummaryTable(users) {
  const Elements = getElements();
  const fragment = document.createDocumentFragment();
  const showBillable = store.config.showBillableBreakdown;

  // Update header
  const thead = document.querySelector('#summaryCard thead tr');
  if (thead) {
    thead.innerHTML = `
      <th>User</th>
      <th class="text-right">Capacity</th>
      <th class="text-right">Regular</th>
      <th class="text-right">Overtime</th>
      <th class="text-right">Breaks</th>
      ${showBillable ? '<th class="text-right">Bill. Worked</th><th class="text-right">Bill. OT</th><th class="text-right">Non-Bill OT</th>' : ''}
      <th class="text-right">Total</th>
      <th class="text-right">Utilization</th>
      <th class="text-right">Amount</th>
    `;
  }

  users.forEach(user => {
    const tr = document.createElement('tr');
    tr.className = 'summary-row';
    const initials = user.userName.slice(0, 2).toUpperCase();
    const utilization = user.totals.expectedCapacity > 0
      ? Math.round((user.totals.total / user.totals.expectedCapacity) * 100)
      : 0;
    const isHighOt = user.totals.total > 0 && (user.totals.overtime / user.totals.total) > 0.3;

    tr.innerHTML = `
      <td class="text-left">
        <div class="user-cell" style="display:flex; align-items:center; gap:8px;">
          <span class="user-avatar" style="display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; background:#03a9f4; color:#fff; border-radius:50%; font-size:10px;">${escapeHtml(initials)}</span>
          <span class="user-name">${escapeHtml(user.userName)}</span>
          ${isHighOt ? '<span style="font-size:9px; color:red; border:1px solid red; padding:0 4px; border-radius:4px;">HIGH OT</span>' : ''}
        </div>
      </td>
      <td class="text-right">${formatHours(user.totals.expectedCapacity)}</td>
      <td class="text-right">${formatHours(user.totals.regular)}</td>
      <td class="text-right ${user.totals.overtime > 0 ? 'text-danger' : ''}">${formatHours(user.totals.overtime)}</td>
      <td class="text-right">${formatHours(user.totals.breaks)}</td>
      ${showBillable ? `
        <td class="text-right">${formatHours(user.totals.billableWorked)}</td>
        <td class="text-right">${formatHours(user.totals.billableOT)}</td>
        <td class="text-right">${formatHours(user.totals.nonBillableOT)}</td>
      ` : ''}
      <td class="text-right font-bold">${formatHours(user.totals.total)}</td>
      <td class="text-right">${utilization}%</td>
      <td class="text-right font-bold">${formatCurrency(user.totals.amount)}</td>
    `;
    fragment.appendChild(tr);
  });

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

  let html = `
  <div class="table-scroll" style="margin-top: 10px;">
    <table class="report-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>User</th>
          <th>Description</th>
          <th class="text-right">Regular</th>
          <th class="text-right">Overtime</th>
          <th class="text-right">Billable</th>
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
        <td>${escapeHtml(e.userName)}</td>
        <td>${escapeHtml(e.description || '(No description)')}</td>
        <td class="text-right">${formatHours(e.analysis?.regular || 0)}</td>
        <td class="text-right ${(e.analysis?.overtime || 0) > 0 ? 'text-danger' : ''}">${formatHours(e.analysis?.overtime || 0)}</td>
        <td class="text-right">${billable}</td>
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
 * Renders the User Overrides table (configuration inputs per user).
 */
export function renderOverridesTable() {
  const Elements = getElements();
  const fragment = document.createDocumentFragment();

  if (!store.users.length) return;

  store.users.forEach(user => {
    const override = store.getUserOverride(user.id);
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
    `;
    fragment.appendChild(tr);
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
    if (e.target.matches('input.override-input')) {
      const { userid, field } = e.target.dataset;
      callbacks.onOverrideChange(userid, field, e.target.value);
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
