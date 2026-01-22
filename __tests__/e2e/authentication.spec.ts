import { test, expect } from '@playwright/test';
import { createMockToken, setupApiMocks, navigateWithToken } from './helpers/mock-api';

test.describe('Authentication Flow', () => {
    test('shows error when no auth token is provided', async ({ page }) => {
        // Navigate without token
        await page.goto('/');

        // Should show error message
        const emptyState = page.locator('#emptyState');
        await expect(emptyState).toBeVisible();
        await expect(emptyState).toContainText('No authentication token provided');
    });

    test('shows error when auth token is invalid', async ({ page }) => {
        // Navigate with invalid token
        await page.goto('/?auth_token=invalid-token');

        // Should show error message
        const emptyState = page.locator('#emptyState');
        await expect(emptyState).toBeVisible();
        await expect(emptyState).toContainText('Invalid authentication token');
    });

    test('loads successfully with valid auth token', async ({ page }) => {
        await setupApiMocks(page);
        await navigateWithToken(page);

        // Should show the app title
        await expect(page.locator('.compact-title')).toContainText('OTPLUS');

        // Should show the generate button
        await expect(page.locator('#generateBtn')).toBeVisible();

        // Should show date inputs
        await expect(page.locator('#startDate')).toBeVisible();
        await expect(page.locator('#endDate')).toBeVisible();
    });

    test('applies dark theme from token claims', async ({ page }) => {
        await setupApiMocks(page);
        const darkToken = createMockToken({ theme: 'DARK' });
        await navigateWithToken(page, darkToken);

        // Body should have dark theme class
        await expect(page.locator('body')).toHaveClass(/cl-theme-dark/);
    });

    test('does not apply dark theme for light theme token', async ({ page }) => {
        await setupApiMocks(page);
        const lightToken = createMockToken({ theme: 'LIGHT' });
        await navigateWithToken(page, lightToken);

        // Body should not have dark theme class
        await expect(page.locator('body')).not.toHaveClass(/cl-theme-dark/);
    });
});
