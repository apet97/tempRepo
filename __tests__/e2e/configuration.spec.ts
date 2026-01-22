import { test, expect } from '@playwright/test';
import { setupApiMocks, navigateWithToken } from './helpers/mock-api';

test.describe('Configuration Panel', () => {
    test.beforeEach(async ({ page }) => {
        await setupApiMocks(page);
        await navigateWithToken(page);
    });

    test('toggles are checked by default', async ({ page }) => {
        // Profile Capacity should be checked
        await expect(page.locator('#useProfileCapacity')).toBeChecked();

        // Working Days should be checked
        await expect(page.locator('#useProfileWorkingDays')).toBeChecked();

        // Apply Holidays should be checked
        await expect(page.locator('#applyHolidays')).toBeChecked();

        // Apply Time Off should be checked
        await expect(page.locator('#applyTimeOff')).toBeChecked();

        // Billable Breakdown should be checked
        await expect(page.locator('#showBillableBreakdown')).toBeChecked();
    });

    test('toggles can be unchecked', async ({ page }) => {
        // Uncheck Profile Capacity
        await page.uncheck('#useProfileCapacity');
        await expect(page.locator('#useProfileCapacity')).not.toBeChecked();

        // Uncheck Working Days
        await page.uncheck('#useProfileWorkingDays');
        await expect(page.locator('#useProfileWorkingDays')).not.toBeChecked();
    });

    test('daily threshold input works', async ({ page }) => {
        const profileCapacityToggle = page.locator('#useProfileCapacity');
        const dailyInput = page.locator('#configDaily');

        // Profile capacity is checked by default, which disables daily threshold
        // Uncheck it first to enable the input
        await profileCapacityToggle.uncheck();
        await expect(dailyInput).toBeEnabled();

        // Should have default value of 8
        await expect(dailyInput).toHaveValue('8');

        // Change value
        await dailyInput.fill('10');
        await expect(dailyInput).toHaveValue('10');
    });

    test('multiplier input works', async ({ page }) => {
        const multiplierInput = page.locator('#configMultiplier');

        // Should have default value of 1.5
        await expect(multiplierInput).toHaveValue('1.5');

        // Change value
        await multiplierInput.fill('2.0');
        await expect(multiplierInput).toHaveValue('2.0');
    });

    test('tier 2 threshold input works', async ({ page }) => {
        const tier2ThresholdInput = page.locator('#configTier2Threshold');

        // Should have default value of 0
        await expect(tier2ThresholdInput).toHaveValue('0');

        // Change value
        await tier2ThresholdInput.fill('4');
        await expect(tier2ThresholdInput).toHaveValue('4');
    });

    test('amount display selector works', async ({ page }) => {
        const amountDisplay = page.locator('#amountDisplay');

        // Should default to 'earned'
        await expect(amountDisplay).toHaveValue('earned');

        // Change to cost
        await amountDisplay.selectOption('cost');
        await expect(amountDisplay).toHaveValue('cost');

        // Change to profit
        await amountDisplay.selectOption('profit');
        await expect(amountDisplay).toHaveValue('profit');
    });

    test('decimal time toggle works', async ({ page }) => {
        const decimalToggle = page.locator('#showDecimalTime');

        // Should be unchecked by default
        await expect(decimalToggle).not.toBeChecked();

        // Check it
        await decimalToggle.check();
        await expect(decimalToggle).toBeChecked();
    });

    test('configuration panel can be collapsed', async ({ page }) => {
        const configToggle = page.locator('#configToggle');
        const configContent = page.locator('#configContent');

        // Should be visible by default
        await expect(configContent).toBeVisible();

        // Click to collapse
        await configToggle.click();
        await expect(configContent).toBeHidden();

        // Click to expand
        await configToggle.click();
        await expect(configContent).toBeVisible();
    });

    test('daily threshold is disabled when profile capacity is enabled', async ({ page }) => {
        const profileCapacityToggle = page.locator('#useProfileCapacity');
        const dailyInput = page.locator('#configDaily');

        // With profile capacity enabled, daily should be disabled
        await expect(profileCapacityToggle).toBeChecked();
        await expect(dailyInput).toBeDisabled();

        // Disable profile capacity
        await profileCapacityToggle.uncheck();

        // Daily input should now be enabled
        await expect(dailyInput).toBeEnabled();
    });
});

test.describe('User Overrides', () => {
    test.beforeEach(async ({ page }) => {
        await setupApiMocks(page);
        await navigateWithToken(page);
    });

    test('user overrides table is visible', async ({ page }) => {
        // Wait for users to load
        await page.waitForSelector('#userOverridesBody tr', { timeout: 5000 });

        // Should have rows for each user
        const rows = page.locator('#userOverridesBody tr');
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);
    });

    test('user override inputs accept values', async ({ page }) => {
        // Wait for users to load
        await page.waitForSelector('#userOverridesBody tr', { timeout: 5000 });

        // Find first row's capacity input
        const firstCapacityInput = page.locator('#userOverridesBody tr:first-child input[data-field="capacity"]');

        if (await firstCapacityInput.isVisible()) {
            // Clear and enter new value
            await firstCapacityInput.fill('6');
            await expect(firstCapacityInput).toHaveValue('6');
        }
    });

    test('mode selector changes override mode', async ({ page }) => {
        // Wait for users to load
        await page.waitForSelector('#userOverridesBody tr', { timeout: 5000 });

        // Find first row's mode selector
        const modeSelector = page.locator('#userOverridesBody tr:first-child select').first();

        if (await modeSelector.isVisible()) {
            // Change to weekly mode
            await modeSelector.selectOption('weekly');
            await expect(modeSelector).toHaveValue('weekly');
        }
    });
});
