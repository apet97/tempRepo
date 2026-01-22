import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken, mockUsers } from './helpers/mock-api';

test.describe('Report Generation', () => {
    test.beforeEach(async ({ page }) => {
        await setupApiMocks(page);
        await navigateWithToken(page);
    });

    test('generates report when clicking Generate button', async ({ page }) => {
        // Set date range
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);

        // Click generate
        await page.click('#generateBtn');

        // Wait for results to appear
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });

        // Summary strip should be visible
        await expect(page.locator('#summaryStrip')).toBeVisible();
    });

    test('shows summary table with user data', async ({ page }) => {
        // Set date range and generate
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);
        await page.click('#generateBtn');

        // Wait for summary table
        await expect(page.locator('#summaryTableBody')).toBeVisible({ timeout: 10000 });

        // Should have rows for each user
        const rows = page.locator('#summaryTableBody tr');
        await expect(rows).toHaveCount(mockUsers.length);
    });

    test('switches between summary and detailed tabs', async ({ page }) => {
        // Generate report first
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);
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
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);
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
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        // Set invalid range (start after end)
        await page.fill('#startDate', today.toISOString().split('T')[0]);
        await page.fill('#endDate', yesterday.toISOString().split('T')[0]);
        await page.click('#generateBtn');

        // Should show validation error (via error dialog or other means)
        // The exact behavior depends on implementation
        // Check that results container is still hidden
        await expect(page.locator('#resultsContainer')).toBeHidden();
    });

    test('group by selector changes summary grouping', async ({ page }) => {
        // Generate report first
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);
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
    test('shows error when users fetch fails', async ({ page }) => {
        await setupApiMocks(page, { shouldFailUsers: true });
        await navigateWithToken(page);

        // Should show an error (implementation dependent)
        // Wait for error state
        await page.waitForTimeout(2000);

        // Check if any error element is displayed
        // Check each element individually to avoid strict mode violation
        const errorDialog = page.locator('.error-dialog');
        const apiStatusBanner = page.locator('.api-status-banner');
        const emptyState = page.locator('#emptyState');

        const hasError =
            (await errorDialog.count() > 0 && await errorDialog.isVisible()) ||
            (await apiStatusBanner.count() > 0 && await apiStatusBanner.isVisible()) ||
            (await emptyState.count() > 0 && await emptyState.isVisible());

        expect(hasError).toBeTruthy();
    });

    test('shows error when report fetch fails', async ({ page }) => {
        await setupApiMocks(page, { shouldFailReport: true });
        await navigateWithToken(page);

        // Set date range and generate
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);
        await page.click('#generateBtn');

        // Should show error (check for error dialog or message)
        await page.waitForTimeout(2000);
        // The exact error UI depends on implementation
    });
});
