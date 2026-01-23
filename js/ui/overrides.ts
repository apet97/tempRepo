/**
 * @fileoverview User Overrides UI Module
 * Handles rendering of user override configuration and per-day/weekly editors.
 * Supports both embedded table view and full-page settings view.
 */

import { store } from '../state.js';
import { getElements, escapeHtml } from './shared.js';
import { IsoUtils } from '../utils.js';

/**
 * Shows the overrides page and hides the main view.
 */
export function showOverridesPage(): void {
    const Elements = getElements();
    if (Elements.mainView) {
        Elements.mainView.classList.add('hidden');
    }
    if (Elements.overridesPage) {
        Elements.overridesPage.classList.remove('hidden');
    }
    renderOverridesPage();
}

/**
 * Hides the overrides page and shows the main view.
 */
export function hideOverridesPage(): void {
    const Elements = getElements();
    if (Elements.overridesPage) {
        Elements.overridesPage.classList.add('hidden');
    }
    if (Elements.mainView) {
        Elements.mainView.classList.remove('hidden');
    }
}

/**
 * Renders the full-page overrides view with card-based user list.
 */
export function renderOverridesPage(): void {
    const Elements = getElements();
    const container = Elements.overridesUserList;
    if (!container) return;

    if (!store.users.length) {
        container.innerHTML = '<div class="card"><p class="muted">No users loaded. Generate a report first to see users.</p></div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    store.users.forEach((user) => {
        const override = store.getUserOverride(user.id);
        const mode = override.mode || 'global';
        const profile = store.profiles.get(user.id);
        const profileCapacity = profile?.workCapacityHours;
        const hasCustom =
            mode !== 'global' ||
            override.capacity ||
            override.multiplier ||
            override.tier2Threshold ||
            override.tier2Multiplier ||
            (override.weeklyOverrides && Object.keys(override.weeklyOverrides).length > 0) ||
            (override.perDayOverrides && Object.keys(override.perDayOverrides).length > 0);
        const placeholder = profileCapacity != null ? profileCapacity : store.calcParams.dailyThreshold;

        const card = document.createElement('div');
        card.className = `card override-user-card collapsed${hasCustom ? ' has-custom' : ''}`;
        card.dataset.userid = user.id;

        card.innerHTML = `
            <div class="override-user-header" role="button" tabindex="0" aria-expanded="false">
                <span class="toggle-icon">&#9654;</span>
                <span class="override-user-name">${escapeHtml(user.name)}</span>
                ${hasCustom ? '<span class="override-badge">CUSTOM</span>' : ''}
                ${profileCapacity != null ? `<span class="override-profile-hint">(${profileCapacity}h profile)</span>` : ''}
            </div>
            <div class="override-card-content">
            <div class="override-fields-grid">
                <div class="override-field">
                    <label>Mode</label>
                    <select class="mode-select override-select"
                            data-userid="${user.id}"
                            aria-label="Override mode for ${escapeHtml(user.name)}">
                        <option value="global" ${mode === 'global' ? 'selected' : ''}>Global</option>
                        <option value="weekly" ${mode === 'weekly' ? 'selected' : ''}>Weekly</option>
                        <option value="perDay" ${mode === 'perDay' ? 'selected' : ''}>Per Day</option>
                    </select>
                </div>
                <div class="override-field">
                    <label>Capacity (hrs)</label>
                    <input type="number"
                           class="override-input ${override.capacity ? '' : 'inherited'}"
                           data-userid="${user.id}"
                           data-field="capacity"
                           placeholder="${placeholder}"
                           value="${override.capacity || ''}"
                           step="0.5" min="0" max="24"
                           aria-label="Capacity override for ${escapeHtml(user.name)}">
                </div>
                <div class="override-field">
                    <label>Multiplier (x)</label>
                    <input type="number"
                           class="override-input ${override.multiplier ? '' : 'inherited'}"
                           data-userid="${user.id}"
                           data-field="multiplier"
                           placeholder="${store.calcParams.overtimeMultiplier}"
                           value="${override.multiplier || ''}"
                           step="0.1" min="1" max="5"
                           aria-label="Overtime multiplier for ${escapeHtml(user.name)}">
                </div>
                ${store.config.enableTieredOT ? `<div class="override-field">
                    <label>Tier2 Threshold (hrs)</label>
                    <input type="number"
                           class="override-input ${override.tier2Threshold ? '' : 'inherited'}"
                           data-userid="${user.id}"
                           data-field="tier2Threshold"
                           placeholder="0"
                           value="${override.tier2Threshold || ''}"
                           step="1" min="0" max="999"
                           aria-label="Tier2 Threshold for ${escapeHtml(user.name)}">
                </div>
                <div class="override-field">
                    <label>Tier2 Mult (x)</label>
                    <input type="number"
                           class="override-input ${override.tier2Multiplier ? '' : 'inherited'}"
                           data-userid="${user.id}"
                           data-field="tier2Multiplier"
                           placeholder="${store.calcParams.tier2Multiplier || 2.0}"
                           value="${override.tier2Multiplier || ''}"
                           step="0.1" min="1" max="5"
                           aria-label="Tier2 Multiplier for ${escapeHtml(user.name)}">
                </div>` : ''}
            </div>
            ${mode === 'perDay' ? `<div class="override-expanded-section">${renderPerDayInputs(user.id, override.perDayOverrides || {}, profileCapacity, placeholder)}</div>` : ''}
            ${mode === 'weekly' ? `<div class="override-expanded-section">${renderWeeklyInputs(user.id, override.weeklyOverrides || {}, profileCapacity, placeholder)}</div>` : ''}
            </div>
        `;

        fragment.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

/**
 * Helper function to generate per-day override inputs HTML.
 * @param userId - User ID.
 * @param perDayOverrides - Per-day overrides object.
 * @param profileCapacity - Profile capacity for placeholder.
 * @param defaultPlaceholder - Default placeholder capacity.
 * @returns HTML string for per-day inputs.
 */
function renderPerDayInputs(
    userId: string,
    perDayOverrides: Record<string, { capacity?: string | number; multiplier?: string | number; tier2Threshold?: string | number; tier2Multiplier?: string | number }>,
    _profileCapacity: number | undefined,
    defaultPlaceholder: number
): string {
    // Get date range from UI inputs
    const startInput = document.getElementById('startDate') as HTMLInputElement | null;
    const endInput = document.getElementById('endDate') as HTMLInputElement | null;

    if (!startInput?.value || !endInput?.value) {
        return '<p class="muted" style="padding: 1rem;">Select a date range to configure per-day overrides.</p>';
    }

    // Generate each calendar day in the currently selected range
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
    html += `<thead><tr><th>Date</th><th>Day</th><th>Capacity</th><th>Multiplier</th>${store.config.enableTieredOT ? '<th>Tier2 Threshold</th><th>Tier2 Mult</th>' : ''}</tr></thead>`;
    html += '<tbody>';

    dates.forEach((dateKey) => {
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
            ${store.config.enableTieredOT ? `<td>
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
            </td>` : ''}
        </tr>`;
    });

    html += '</tbody></table></div>';
    return html;
}

/**
 * Renders weekly inputs for a user (7 rows for each weekday).
 * @param userId - User ID.
 * @param weeklyOverrides - Weekly overrides object.
 * @param profileCapacity - Profile capacity fallback.
 * @param defaultPlaceholder - Placeholder text for capacity.
 * @returns HTML string for weekly inputs.
 */
function renderWeeklyInputs(
    userId: string,
    weeklyOverrides: Record<string, { capacity?: string | number; multiplier?: string | number; tier2Threshold?: string | number; tier2Multiplier?: string | number }>,
    _profileCapacity: number | undefined,
    defaultPlaceholder: number
): string {
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
    html += `<thead><tr><th>Weekday</th><th>Capacity (hrs)</th><th>Multiplier (x)</th>${store.config.enableTieredOT ? '<th>Tier2 Threshold</th><th>Tier2 Mult</th>' : ''}</tr></thead>`;
    html += '<tbody>';

    weekdays.forEach((weekday) => {
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
        ${store.config.enableTieredOT ? `<td>
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
        </td>` : ''}
    </tr>`;
    });

    html += '</tbody></table></div>';
    return html;
}

