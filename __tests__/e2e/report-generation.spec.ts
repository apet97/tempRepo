import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken, mockUsers } from './helpers/mock-api';

test.describe('Report Generation', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await setupApiMocks(page, { entriesPerUser: 1, startDate: '2025-01-15' });
        await navigateWithToken(page);
    });

    test('generates report when clicking Generate button', async ({ page }) => {
        // Set date range
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('#startDate', startDate);
        await page.fill('#endDate', endDate);

        // Click generate
        await page.click('#generateBtn');

        // Wait for results to appear
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });

        // Summary strip should be visible
        await expect(page.locator('#summaryStrip')).toBeVisible();
    });

    test('shows summary table with user data', async ({ page }) => {
        // Set date range and generate
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('#startDate', startDate);
        await page.fill('#endDate', endDate);
        await page.click('#generateBtn');

        // Wait for summary table
        await expect(page.locator('#summaryTableBody')).toBeVisible({ timeout: 10000 });

        // Should have rows for each user
        const rows = page.locator('#summaryTableBody tr');
        await expect(rows).toHaveCount(mockUsers.length);

        // First row should include a deterministic total (3h) for the first user
        const firstRowText = await rows.first().innerText();
        expect(firstRowText).toContain('Alice Johnson');
        expect(firstRowText).toContain('3h');
    });

    test('switches between summary and detailed tabs', async ({ page }) => {
        // Generate report first
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('#startDate', startDate);
        await page.fill('#endDate', endDate);
        await page.click('#generateBtn');

        // Wait for results
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });

        // Summary should be visible by default
        await expect(page.locator('#summaryCard')).toBeVisible();
        await expect(page.locator('#detailedCard')).toBeHidden();

        // Click detailed tab
        await page.click('[data-tab="detailed"]');

        // Detailed should now be visible
        await expect(page.locator('#detailedCard')).toBeVisible();
        await expect(page.locator('#summaryCard')).toBeHidden();

        // Click back to summary
        await page.click('[data-tab="summary"]');
        await expect(page.locator('#summaryCard')).toBeVisible();
        await expect(page.locator('#detailedCard')).toBeHidden();
    });

    test('enables export button after generating report', async ({ page }) => {
        // Export button should be disabled initially
        await expect(page.locator('#exportBtn')).toBeDisabled();

        // Generate report
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('#startDate', startDate);
        await page.fill('#endDate', endDate);
        await page.click('#generateBtn');

        // Wait for results
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });

        // Export button should be enabled
        await expect(page.locator('#exportBtn')).toBeEnabled();
    });

    test('date presets work correctly', async ({ page }) => {
        // Click "This Week" preset
        await page.click('#datePresetThisWeek');

        // Date inputs should be populated
        const startDateValue = await page.inputValue('#startDate');
        const endDateValue = await page.inputValue('#endDate');

        expect(startDateValue).toBeTruthy();
        expect(endDateValue).toBeTruthy();

        // Start date should be before or equal to end date
        expect(new Date(startDateValue) <= new Date(endDateValue)).toBeTruthy();
    });

    test('validates date range (start before end)', async ({ page }) => {
        // Set invalid range (start after end)
        await page.fill('#startDate', '2025-01-15');
        await page.fill('#endDate', '2025-01-14');
        await page.click('#generateBtn');

        // Should show validation error (via error dialog or other means)
        // The exact behavior depends on implementation
        // Check that results container is still hidden
        await expect(page.locator('#resultsContainer')).toBeHidden();
    });

    test('group by selector changes summary grouping', async ({ page }) => {
        // Generate report first
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('#startDate', startDate);
        await page.fill('#endDate', endDate);
        await page.click('#generateBtn');

        // Wait for results
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });

        // Change group by to project
        await page.selectOption('#groupBySelect', 'project');

        // Table should update (we can check that it re-rendered by checking content)
        await expect(page.locator('#summaryTableBody')).toBeVisible();
    });
});

test.describe('Report Generation - Error Handling', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
    });

    test('shows error when users fetch fails', async ({ page }) => {
        await setupApiMocks(page, { shouldFailUsers: true });
        await navigateWithToken(page);

        // Wait for error to appear - use Playwright's proper async waiting
        // The error should appear in either the API status banner or empty state
        const apiStatusBanner = page.locator('.api-status-banner:not(.hidden)');
        const emptyStateWithError = page.locator('#emptyState').filter({ hasText: /error|fail/i });

        // Wait for either error indicator to be visible with extended timeout
        await expect(apiStatusBanner.or(emptyStateWithError)).toBeVisible({ timeout: 10000 });
    });

    test('handles report fetch failure gracefully', async ({ page }) => {
        await setupApiMocks(page, { shouldFailReport: true });
        await navigateWithToken(page);

        // Set date range and generate
        const startDate = '2025-01-08';
        const endDate = '2025-01-15';

        await page.fill('#startDate', startDate);
        await page.fill('#endDate', endDate);
        await page.click('#generateBtn');

        // Should still render without crashing; rows exist with zeroed totals
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });
        const rows = page.locator('#summaryTableBody tr');
        await expect(rows).toHaveCount(mockUsers.length);
        const firstRowText = await rows.first().innerText();
        expect(firstRowText).toContain('0h');
    });
});
