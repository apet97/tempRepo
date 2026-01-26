import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken } from './helpers/mock-api';

test.describe('CSV Export', () => {
    test.beforeEach(async ({ page }) => {
        await setupApiMocks(page);
        await navigateWithToken(page);
    });

    test('downloads CSV when clicking export button', async ({ page }) => {
        // Generate report first
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);
        await page.click('#generateBtn');

        // Wait for results
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });

        // Ensure export button is enabled before clicking
        await expect(page.locator('#exportBtn')).toBeEnabled({ timeout: 5000 });

        // Use Promise.all to set up listener and click simultaneously for reliability
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            page.click('#exportBtn'),
        ]);

        // Verify download filename
        const filename = download.suggestedFilename();
        expect(filename).toBe('otplus-report.csv');
    });

    test('CSV contains expected headers', async ({ page }) => {
        // Generate report first
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        await page.fill('#startDate', startDate.toISOString().split('T')[0]);
        await page.fill('#endDate', today.toISOString().split('T')[0]);
        await page.click('#generateBtn');

        // Wait for results
        await expect(page.locator('#resultsContainer')).toBeVisible({ timeout: 10000 });

        // Ensure export button is enabled before clicking
        await expect(page.locator('#exportBtn')).toBeEnabled({ timeout: 5000 });

        // Use Promise.all to set up listener and click simultaneously for reliability
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            page.click('#exportBtn'),
        ]);
        const path = await download.path();

        if (path) {
            const fs = await import('fs');
            const content = fs.readFileSync(path, 'utf-8');
            const lines = content.split('\n');
            const headers = lines[0];

            // Check for expected headers
            expect(headers).toContain('User');
            expect(headers).toContain('Date');
            expect(headers).toContain('Regular');
            expect(headers).toContain('Overtime');
        }
    });
});
