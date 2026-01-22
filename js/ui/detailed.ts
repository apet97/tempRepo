/**
 * @fileoverview Detailed Table UI Module
 * Handles rendering of detailed entries table with pagination and filtering.
 */

import { store } from '../state.js';
import {
    formatHoursDisplay,
    formatCurrency,
    escapeHtml,
    getAmountDisplayMode,
    buildProfitStacks,
} from './shared.js';
import { classifyEntryForOvertime } from '../utils.js';
import type { UserAnalysis, TimeEntry, DayMeta } from '../types.js';

/**
 * Extended entry with day metadata for rendering
 */
interface DetailedEntry extends TimeEntry {
    dayMeta: DayMeta;
}

const NARROW_HEADER_WIDTH = 900;
let detailedHeaderObserver: ResizeObserver | null = null;
let observedDetailedCard: HTMLElement | null = null;

function updateDetailedHeaderLayout(card: HTMLElement): void {
    const isProfitMode = card.classList.contains('amount-profit');
    const width = card.getBoundingClientRect().width;
    card.classList.toggle('narrow-headers', isProfitMode && width < NARROW_HEADER_WIDTH);
}

function ensureDetailedHeaderObserver(card: HTMLElement): void {
    updateDetailedHeaderLayout(card);
    if (typeof ResizeObserver === 'undefined') return;
    if (!detailedHeaderObserver) {
        detailedHeaderObserver = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.target instanceof HTMLElement) {
                    updateDetailedHeaderLayout(entry.target);
                }
            });
        });
    }
    if (observedDetailedCard !== card) {
        if (observedDetailedCard) {
            detailedHeaderObserver.unobserve(observedDetailedCard);
        }
        observedDetailedCard = card;
        detailedHeaderObserver.observe(card);
    }
}

/**
 * Renders the Detailed Table (granular entries).
 * Supports client-side filtering and pagination.
 *
 * @param users - List of user analysis objects.
 * @param activeFilter - Filter key ('all', 'holiday', 'offday', 'billable').
 */
export function renderDetailedTable(
    users: UserAnalysis[],
    activeFilter: string | null = null
): void {
    const container = document.getElementById('detailedTableContainer');
    if (!container) return;
    const detailedCard = document.getElementById('detailedCard');
    const showBillable = store.config.showBillableBreakdown;
    const amountDisplay = getAmountDisplayMode();
    const isProfitMode = amountDisplay === 'profit';
    if (detailedCard) {
        detailedCard.classList.toggle('billable-off', !showBillable);
        detailedCard.classList.toggle('amount-profit', isProfitMode);
        ensureDetailedHeaderObserver(detailedCard);
    }

    // Use stored filter if not provided, otherwise update store
    if (activeFilter) {
        store.ui.activeDetailedFilter = activeFilter as typeof store.ui.activeDetailedFilter;
        store.ui.detailedPage = 1; // Reset to page 1 on filter change
    }
    let currentFilter = store.ui.activeDetailedFilter || 'all';
    if (!showBillable && currentFilter === 'billable') {
        currentFilter = 'all';
        store.ui.activeDetailedFilter = 'all';
    }

    // Flatten entries, attach day-level metadata, and sort by start time
    let allEntries: DetailedEntry[] = users.flatMap((u) =>
        Array.from(u.days.values()).flatMap((d) =>
            d.entries.map((e) => ({
                ...e,
                userName: u.userName,
                dayMeta: {
                    isHoliday: d.meta?.isHoliday || false,
                    holidayName: d.meta?.holidayName || '',
                    isNonWorking: d.meta?.isNonWorking || false,
                    isTimeOff: d.meta?.isTimeOff || false,
                },
            }))
        )
    ).sort((a, b) =>
        (b.timeInterval.start || '').localeCompare(a.timeInterval.start || '')
    );

    // Apply user-selected filter chips
    if (currentFilter === 'holiday') {
        allEntries = allEntries.filter((e) => e.dayMeta.isHoliday);
    } else if (currentFilter === 'offday') {
        allEntries = allEntries.filter((e) => e.dayMeta.isNonWorking);
    } else if (currentFilter === 'billable') {
        allEntries = allEntries.filter((e) => e.analysis?.isBillable);
    }

    // Update Chips UI
    document.querySelectorAll('#detailedFilters .chip').forEach((chip) => {
        const el = chip as HTMLElement;
        el.classList.toggle('active', el.dataset.filter === currentFilter);
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
    const formatTime = (isoString: string | undefined): string => {
        if (!isoString) return '—';
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
        } catch {
            return '—';
        }
    };

    const amountHeaderNote = isProfitMode
        ? '<div class="amount-header-sub">Amt / Cost / Profit</div>'
        : '';
    const detailedRateLabel = amountDisplay === 'cost' ? 'Rate (Cost)' : 'Rate';
    const headerLabel = (long: string, short?: string): string =>
        short
            ? `<span class="header-label header-label-long">${long}</span><span class="header-label header-label-short">${short}</span>`
            : long;

    let html = `
  <div class="table-scroll" style="margin-top: 10px;">
    <table class="report-table">
      <thead>
        <tr>
          <th>${headerLabel('Date')}</th>
          <th>${headerLabel('Start', 'St')}</th>
          <th>${headerLabel('End', 'En')}</th>
          <th>${headerLabel('User')}</th>
          <th class="text-right">${headerLabel('Regular', 'Reg')}</th>
          <th class="text-right">${headerLabel('Overtime', 'OT')}</th>
          <th class="text-right">${headerLabel('Billable', 'Bill')}</th>
          <th class="text-right amount-cell">${detailedRateLabel}${amountHeaderNote}</th>
          <th class="text-right amount-cell">${headerLabel('Regular', 'Reg')} $${amountHeaderNote}</th>
          <th class="text-right amount-cell">${headerLabel('Overtime', 'OT')} $${amountHeaderNote}</th>
          <th class="text-right amount-cell">T2 $${amountHeaderNote}</th>
          <th class="text-right amount-cell">Total $${amountHeaderNote}</th>
          <th class="text-right">Status</th>
        </tr>
      </thead>
      <tbody>`;

    // Build table rows for the current page
    pageEntries.forEach((e) => {
        const date = (e.timeInterval.start || '').split('T')[0];
        const tags: string[] = [];
        const tagKeys = new Set<string>();
        const addTag = (key: string, tagHtml: string) => {
            if (tagKeys.has(key)) return;
            tagKeys.add(key);
            tags.push(tagHtml);
        };

        const normalizeTag = (tag: unknown): string =>
            String(tag || '')
                .toUpperCase()
                .replace(/[_-]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

        const entryTags = Array.isArray(e.tags) ? e.tags : [];
        const normalizedType = String(e.type || '')
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/g, '_');
        const entryClass = classifyEntryForOvertime(e);
        const isHolidayEntry =
            normalizedType === 'HOLIDAY' || normalizedType === 'HOLIDAY_TIME_ENTRY';
        const isTimeOffEntry =
            normalizedType === 'TIME_OFF' ||
            normalizedType === 'TIMEOFF' ||
            normalizedType === 'TIME_OFF_TIME_ENTRY';
        const isPtoEntry = isHolidayEntry || isTimeOffEntry;

        if (isHolidayEntry) {
            addTag(
                'HOLIDAY-TIME-ENTRY',
                '<span class="badge badge-holiday">HOLIDAY TIME ENTRY</span>'
            );
        }
        if (isTimeOffEntry) {
            addTag(
                'TIME-OFF-TIME-ENTRY',
                '<span class="badge badge-timeoff">TIME OFF TIME ENTRY</span>'
            );
        }

        if (!isPtoEntry) {
            if (e.dayMeta.isHoliday) {
                addTag(
                    'HOLIDAY',
                    `<span class="badge badge-holiday" title="${escapeHtml(e.dayMeta.holidayName || 'Holiday')}">HOLIDAY</span>`
                );
            }
            if (e.dayMeta.isTimeOff) {
                addTag('TIME-OFF', '<span class="badge badge-timeoff">TIME-OFF</span>');
            }
            if (e.dayMeta.isNonWorking) {
                addTag('OFF-DAY', '<span class="badge badge-offday">OFF-DAY</span>');
            }
            if (entryClass === 'break') {
                addTag('BREAK', '<span class="badge badge-break">BREAK</span>');
            }
        }

        // Existing entry tags (user-defined)
        if (!isPtoEntry) {
            const systemTags = new Set([
                'HOLIDAY',
                'OFF DAY',
                'TIME OFF',
                'BREAK',
                'HOLIDAY TIME ENTRY',
                'TIME OFF TIME ENTRY',
            ]);
            (e.analysis?.tags || []).forEach((t) => {
                if (!systemTags.has(normalizeTag(t))) {
                    addTag(t, `<span class="badge badge-offday">${escapeHtml(t)}</span>`);
                }
            });
            entryTags.forEach((t) => {
                const tagName = typeof t === 'string' ? t : t?.name || '';
                if (tagName && !systemTags.has(normalizeTag(tagName))) {
                    addTag(tagName, `<span class="badge badge-offday">${escapeHtml(tagName)}</span>`);
                }
            });
        }

        // Billable indicator
        const billable = e.analysis?.isBillable
            ? '<span class="badge badge-billable">✓</span>'
            : '<span style="color:var(--text-muted)">—</span>';

        // Use precomputed amount breakdowns
        const amountsByType = e.analysis?.amounts || {};
        const rateCell = isProfitMode
            ? buildProfitStacks(amountsByType, (amount) => amount.rate || 0, 'right')
            : formatCurrency(e.analysis?.hourlyRate || 0);
        const regularCell = isProfitMode
            ? buildProfitStacks(amountsByType, (amount) => amount.regularAmount || 0, 'right')
            : formatCurrency(e.analysis?.regularAmount || 0);
        const otCell = isProfitMode
            ? buildProfitStacks(
                  amountsByType,
                  (amount) =>
                      (amount.overtimeAmountBase || 0) + (amount.tier1Premium || 0),
                  'right'
              )
            : formatCurrency(
                  (e.analysis?.overtimeAmountBase || 0) + (e.analysis?.tier1Premium || 0)
              );
        const t2Cell = isProfitMode
            ? buildProfitStacks(amountsByType, (amount) => amount.tier2Premium || 0, 'right')
            : formatCurrency(e.analysis?.tier2Premium || 0);
        const totalCell = isProfitMode
            ? buildProfitStacks(
                  amountsByType,
                  (amount) => amount.totalAmountWithOT || 0,
                  'right'
              )
            : formatCurrency(e.analysis?.totalAmountWithOT || 0);

        html += `
    <tr>
        <td>${escapeHtml(date)}</td>
        <td>${formatTime(e.timeInterval?.start)}</td>
        <td>${formatTime(e.timeInterval?.end)}</td>
        <td>${escapeHtml(e.userName)}</td>
        <td class="text-right">${formatHoursDisplay(e.analysis?.regular || 0)}</td>
        <td class="text-right ${(e.analysis?.overtime || 0) > 0 ? 'text-danger' : ''}">${formatHoursDisplay(e.analysis?.overtime || 0)}</td>
        <td class="text-right">${billable}</td>
        <td class="text-right amount-cell">${rateCell}</td>
        <td class="text-right amount-cell">${regularCell}</td>
        <td class="text-right amount-cell">${otCell}</td>
        <td class="text-right amount-cell">${t2Cell}</td>
        <td class="text-right highlight amount-cell">${totalCell}</td>
        <td class="text-right"><div class="tags-cell">${tags.join(' ') || '—'}</div></td>
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
