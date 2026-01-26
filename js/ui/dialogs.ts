/**
 * @fileoverview Dialogs and Status UI Module
 * Handles error banners, loading states, and API status indicators.
 */

import { store } from '../state.js';
import type { FriendlyError } from '../types.js';
import { getElements, escapeHtml } from './shared.js';

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

/**
 * Shows a warning dialog for large date ranges.
 * @param days - Number of days in the selected range.
 * @returns Promise that resolves to true if user confirms, false if cancelled.
 */
export function showLargeDateRangeWarning(days: number): Promise<boolean> {
    const isVeryLarge = days > 730; // More than 2 years
    const message = isVeryLarge
        ? `You selected a ${days}-day range (over 2 years).\n\n` +
          'Very large ranges may cause significant slowdowns and may exceed API limits.\n\n' +
          'Are you sure you want to proceed?'
        : `You selected a ${days}-day range.\n\n` +
          'Large date ranges may take longer to process.\n\n' +
          'Continue?';

    return Promise.resolve(window.confirm(message));
}

/**
 * Updates the loading progress display during fetch operations.
 * @param current - Current item number.
 * @param phase - Current phase description (e.g., 'entries', 'profiles').
 */
export function updateLoadingProgress(current: number, phase: string): void {
    const Elements = getElements();
    const loadingState = Elements.loadingState;
    if (!loadingState) return;

    // Find or create the progress text element
    let progressText = loadingState.querySelector('.loading-progress') as HTMLElement | null;
    if (!progressText) {
        progressText = document.createElement('div');
        progressText.className = 'loading-progress';
        progressText.style.cssText = 'font-size: 13px; color: var(--text-muted); margin-top: 8px; text-align: center;';
        loadingState.appendChild(progressText);
    }

    progressText.textContent = `Fetching ${phase} (page ${current})...`;
}

/**
 * Clears the loading progress display.
 */
export function clearLoadingProgress(): void {
    const Elements = getElements();
    const loadingState = Elements.loadingState;
    if (!loadingState) return;

    const progressText = loadingState.querySelector('.loading-progress');
    if (progressText) {
        progressText.remove();
    }
}

/**
 * Renders the throttle status banner when rate limiting is detected.
 * @param retryCount - Number of 429 retries encountered.
 */
export function renderThrottleStatus(retryCount: number): void {
    const Elements = getElements();
    const banner = Elements.apiStatusBanner;
    if (!banner) return;

    // Only show throttle warning if 3+ retries occurred
    if (retryCount < 3) {
        return;
    }

    // Don't replace existing error content, append throttle info
    const existingContent = banner.textContent || '';
    if (existingContent.includes('Rate limiting')) {
        return; // Already showing throttle warning
    }

    const throttleMessage = `\u26A0\uFE0F Rate limiting detected (${retryCount} retries). Report generation may be slower than usual.`;

    if (existingContent && !existingContent.includes('Rate limiting')) {
        banner.textContent = existingContent + ' | ' + throttleMessage;
    } else {
        banner.textContent = throttleMessage;
    }
    banner.classList.remove('hidden');
}

/**
 * Cache action type for report caching
 */
export type CacheAction = 'use' | 'refresh';

/**
 * Shows a prompt asking the user whether to use cached report data or refresh.
 * @param cacheAgeSeconds - Age of the cache in seconds.
 * @returns Promise resolving to 'use' to use cache, 'refresh' to fetch fresh data.
 */
export function showCachePrompt(cacheAgeSeconds: number): Promise<CacheAction> {
    const ageMinutes = Math.round(cacheAgeSeconds / 60);
    const ageText = ageMinutes < 1 ? 'less than a minute' : `${ageMinutes} minute${ageMinutes !== 1 ? 's' : ''}`;

    const message =
        `Cached report data found (${ageText} old).\n\n` +
        'Use cached data for faster loading, or refresh to fetch the latest?\n\n' +
        'Click OK to use cache, Cancel to refresh.';

    const useCached = window.confirm(message);
    return Promise.resolve(useCached ? 'use' : 'refresh');
}
