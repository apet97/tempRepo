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

        // Set up download listener
        const downloadPromise = page.waitForEvent('download');

        // Click export
        await page.click('#exportBtn');

        // Wait for download
        const download = await downloadPromise;

        // Verify download filename
        const filename = download.suggestedFilename();
        expect(filename).toMatch(/overtime.*\.csv$/i);
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

        // Set up download listener
        const downloadPromise = page.waitForEvent('download');

        // Click export
        await page.click('#exportBtn');

        // Wait for download and read content
        const download = await downloadPromise;
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
