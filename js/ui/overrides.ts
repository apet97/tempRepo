/**
 * @fileoverview User Overrides UI Module
 * Handles rendering of user override configuration table and per-day/weekly editors.
 */

import { store } from '../state.js';
import { getElements, escapeHtml } from './shared.js';
import { IsoUtils } from '../utils.js';

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
    html += '<thead><tr><th>Date</th><th>Day</th><th>Capacity</th><th>Multiplier</th><th>Tier2 Threshold</th><th>Tier2 Mult</th></tr></thead>';
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
    html += '<thead><tr><th>Weekday</th><th>Capacity (hrs)</th><th>Multiplier (x)</th><th>Tier2 Threshold</th><th>Tier2 Mult</th></tr></thead>';
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
export function renderOverridesTable(): void {
    const Elements = getElements();
    const fragment = document.createDocumentFragment();

    if (!store.users.length) return;

    store.users.forEach((user) => {
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
            expandedCell.innerHTML = renderPerDayInputs(
                user.id,
                override.perDayOverrides || {},
                profileCapacity,
                placeholder
            );

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
            expandedCell.innerHTML = renderWeeklyInputs(
                user.id,
                override.weeklyOverrides || {},
                profileCapacity,
                placeholder
            );

            expandedRow.appendChild(expandedCell);
            fragment.appendChild(expandedRow);
        }
    });

    if (Elements.userOverridesBody) {
        Elements.userOverridesBody.innerHTML = '';
        Elements.userOverridesBody.appendChild(fragment);
    }
}
