/**
 * @fileoverview UI Module Entry Point
 * Re-exports all UI functions and handles event binding.
 */

import { store } from '../state.js';
import type { UICallbacks } from '../types.js';

// Re-export all public functions
export { initializeElements, getElements } from './shared.js';
export { renderSummaryStrip, renderSummaryExpandToggle, renderSummaryTable } from './summary.js';
export { renderDetailedTable } from './detailed.js';
export { showOverridesPage, hideOverridesPage, renderOverridesPage } from './overrides.js';
export { renderLoading, renderApiStatus, showError, hideError, showClearDataConfirmation, showLargeDateRangeWarning, updateLoadingProgress, clearLoadingProgress, renderThrottleStatus, showCachePrompt } from './dialogs.js';
export type { CacheAction } from './dialogs.js';

// Import for internal use
import { getElements } from './shared.js';
import { renderDetailedTable } from './detailed.js';
import { showOverridesPage, hideOverridesPage, renderOverridesPage } from './overrides.js';

/**
 * Binds global UI events (scrolling, inputs, buttons).
 * Uses delegation for dynamic elements like pagination.
 *
 * @param callbacks - Callback functions for actions (onGenerate, onOverrideChange).
 */
export function bindEvents(callbacks: UICallbacks): void {
    const Elements = getElements();

    // Prevent scroll wheel from changing number inputs when focused
    document.addEventListener(
        'wheel',
        (e) => {
            const target = e.target as HTMLElement;
            if (
                target.tagName === 'INPUT' &&
                (target as HTMLInputElement).type === 'number' &&
                document.activeElement === target
            ) {
                e.preventDefault();
            }
        },
        { passive: false }
    );

    // Detailed table event delegation (pagination + status popover)
    const detailedContainer = document.getElementById('detailedTableContainer');
    if (detailedContainer) {
        detailedContainer.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // Pagination
            if (target.matches('.pagination-btn')) {
                const newPage = parseInt(target.dataset.page || '', 10);
                if (!isNaN(newPage)) {
                    store.ui.detailedPage = newPage;
                    if (store.analysisResults) {
                        renderDetailedTable(store.analysisResults);
                    }
                }
                return;
            }

            // Status info popover toggle
            const btn = target.closest('.status-info-btn') as HTMLElement | null;
            if (btn) {
                e.stopPropagation();
                const headerCell = btn.closest('.status-header-cell');
                if (!headerCell) return;

                let popover = headerCell.querySelector('.status-info-popover') as HTMLElement | null;

                if (popover) {
                    popover.classList.toggle('hidden');
                } else {
                    popover = document.createElement('div');
                    popover.className = 'status-info-popover';
                    popover.innerHTML = `
                        <h4>Status Badges</h4>
                        <dl>
                            <dt>HOLIDAY ENTRY</dt>
                            <dd>PTO entry (counts as regular hours)</dd>
                            <dt>TIME-OFF ENTRY</dt>
                            <dd>PTO entry (counts as regular hours)</dd>
                            <dt>HOLIDAY</dt>
                            <dd>Work on a holiday (all work is overtime)</dd>
                            <dt>TIME-OFF</dt>
                            <dd>Day has time-off reducing capacity</dd>
                            <dt>OFF-DAY</dt>
                            <dd>Non-working day (weekend)</dd>
                            <dt>BREAK</dt>
                            <dd>Break entry (counts as regular hours)</dd>
                        </dl>
                    `;
                    headerCell.appendChild(popover);
                }
                return;
            }

            // Close popover when clicking outside (but inside container)
            const openPopover = detailedContainer.querySelector('.status-info-popover:not(.hidden)');
            if (openPopover && !openPopover.contains(target)) {
                openPopover.classList.add('hidden');
            }
        });
    }

    // Generate button
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', () => callbacks.onGenerate());
    }

    // Overrides page navigation
    if (Elements.openOverridesBtn) {
        Elements.openOverridesBtn.addEventListener('click', () => {
            showOverridesPage();
        });
    }

    if (Elements.closeOverridesBtn) {
        Elements.closeOverridesBtn.addEventListener('click', () => {
            hideOverridesPage();
            // Trigger recalculation if report data exists
            if (store.analysisResults) {
                callbacks.onGenerate();
            }
        });
    }

    // Overrides page event delegation (for card-based inputs)
    if (Elements.overridesUserList) {
        Elements.overridesUserList.addEventListener('input', (e) => {
            const target = e.target as HTMLElement;

            // Global override handler
            if (target.matches('input.override-input')) {
                const input = target as HTMLInputElement;
                const { userid, field } = input.dataset;
                if (userid && field) {
                    callbacks.onOverrideChange(userid, field, input.value);
                    // Update card styling
                    const card = target.closest('.override-user-card');
                    if (card) {
                        const override = store.overrides[userid] || {};
                        const hasCustom = override.capacity || override.multiplier || override.tier2Threshold || override.tier2Multiplier;
                        card.classList.toggle('has-custom', !!hasCustom);
                    }
                }
            }

            // Per-day override handler
            if (target.matches('input.per-day-input')) {
                const input = target as HTMLInputElement;
                const { userid, datekey, field } = input.dataset;
                if (userid && datekey && field) {
                    callbacks.onPerDayOverrideChange(userid, datekey, field, input.value);
                }
            }

            // Weekly input handler
            if (target.matches('input.weekly-input')) {
                const input = target as HTMLInputElement;
                const { userid, weekday, field } = input.dataset;
                if (userid && weekday && field) {
                    callbacks.onWeeklyOverrideChange(userid, weekday, field, input.value);
                }
            }
        });

        Elements.overridesUserList.addEventListener('change', (e) => {
            const target = e.target as HTMLElement;

            // Mode select dropdown handler
            if (target.matches('select.mode-select')) {
                const select = target as HTMLSelectElement;
                const { userid } = select.dataset;
                if (userid) {
                    callbacks.onOverrideModeChange(userid, select.value);
                    // Re-render the overrides page to show/hide expanded sections
                    renderOverridesPage();
                }
            }
        });

        Elements.overridesUserList.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // Toggle collapsed state when clicking header
            const header = target.closest('.override-user-header');
            if (header) {
                const card = header.closest('.override-user-card');
                if (card) {
                    card.classList.toggle('collapsed');
                    const isExpanded = !card.classList.contains('collapsed');
                    header.setAttribute('aria-expanded', String(isExpanded));
                    const toggleIcon = header.querySelector('.toggle-icon');
                    if (toggleIcon) {
                        toggleIcon.innerHTML = isExpanded ? '&#9660;' : '&#9654;';
                    }
                }
                return;
            }

            // Copy from global button (per-day mode)
            if (target.matches('button.copy-from-global-btn')) {
                const { userid } = target.dataset;
                if (userid) {
                    callbacks.onCopyFromGlobal(userid);
                    renderOverridesPage();
                }
            }

            // Copy global to weekly button (weekly mode)
            if (target.matches('button.copy-global-to-weekly-btn')) {
                const { userid } = target.dataset;
                if (userid) {
                    callbacks.onCopyGlobalToWeekly(userid);
                    renderOverridesPage();
                }
            }
        });
    }
}
