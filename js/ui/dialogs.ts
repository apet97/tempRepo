/**
 * @fileoverview Dialogs and Status UI Module
 * Handles error banners, loading states, and API status indicators.
 */

import { store } from '../state.js';
import { getElements, escapeHtml } from './shared.js';
import type { FriendlyError } from '../types.js';

/**
 * Toggles the loading state visualization.
 * @param isLoading - True to show loading skeletons, false to hide.
 */
export function renderLoading(isLoading: boolean): void {
    const Elements = getElements();
    if (isLoading) {
        Elements.loadingState?.classList.remove('hidden');
        Elements.resultsContainer?.classList.add('hidden');
        Elements.emptyState?.classList.add('hidden');
    } else {
        Elements.loadingState?.classList.add('hidden');
    }
}

/**
 * Renders the API status banner (warnings for failed fetches).
 * Shows which data sources (profiles, holidays, etc.) failed, implying fallback usage.
 */
export function renderApiStatus(): void {
    const Elements = getElements();
    const banner = Elements.apiStatusBanner;
    if (!banner) return;

    const { profilesFailed, holidaysFailed, timeOffFailed } = store.apiStatus;
    const parts: string[] = [];

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
 * Display error banner for user-friendly error messages.
 * @param error - Error object or message string.
 */
export function showError(error: FriendlyError | string): void {
    const Elements = getElements();

    // Hide loading state if visible
    Elements.loadingState?.classList.add('hidden');

    const errorData: FriendlyError =
        typeof error === 'string'
            ? {
                  title: 'Error',
                  message: error,
                  action: 'none',
                  type: 'UNKNOWN',
                  timestamp: new Date().toISOString(),
              }
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

    // Attach event listener properly instead of using onclick
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
export function hideError(): void {
    const Elements = getElements();
    const banner = Elements.apiStatusBanner;
    if (banner) {
        banner.classList.add('hidden');
        banner.textContent = '';
    }
}

/**
 * Creates the error banner DOM element if it doesn't exist.
 * @returns The banner element.
 */
function createErrorBanner(): HTMLElement {
    const banner = document.createElement('div');
    banner.id = 'apiStatusBanner';
    banner.className = 'api-status-banner';
    const container = document.querySelector('.container');
    if (container) {
        document.body.insertBefore(banner, container);
    } else {
        document.body.appendChild(banner);
    }
    // Update cached elements
    const Elements = getElements();
    Elements.apiStatusBanner = banner;
    return banner;
}

/**
 * Shows a confirmation dialog for clearing all data.
 * @param onConfirm - Callback when user confirms.
 */
export function showClearDataConfirmation(onConfirm: () => void): void {
    const confirmed = window.confirm(
        'Are you sure you want to clear all stored data? This will remove:\n\n' +
            '• All saved configuration settings\n' +
            '• User override settings\n' +
            '• Cached profile data\n\n' +
            'This action cannot be undone.'
    );

    if (confirmed) {
        onConfirm();
    }
}
