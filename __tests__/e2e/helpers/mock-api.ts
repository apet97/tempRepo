import { Page, Route } from '@playwright/test';

/**
 * Mock API helpers for E2E tests
 */

/**
 * Mock JWT token for testing
 */
export function createMockToken(claims: Record<string, unknown> = {}): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
        workspaceId: 'ws-test-123',
        backendUrl: 'https://api.clockify.me',
        reportsUrl: 'https://reports.api.clockify.me',
        theme: 'LIGHT',
        ...claims,
    }));
    const signature = btoa('mock-signature');
    return `${header}.${payload}.${signature}`;
}

/**
 * Mock users data
 */
export const mockUsers = [
    { id: 'user-1', name: 'Alice Johnson', email: 'alice@example.com', status: 'ACTIVE' },
    { id: 'user-2', name: 'Bob Smith', email: 'bob@example.com', status: 'ACTIVE' },
    { id: 'user-3', name: 'Carol Davis', email: 'carol@example.com', status: 'ACTIVE' },
];

/**
 * Mock time entries data
 */
export function createMockTimeEntries(options: {
    userId?: string;
    userName?: string;
    count?: number;
    startDate?: string;
} = {}) {
    const {
        userId = 'user-1',
        userName = 'Alice Johnson',
        count = 5,
        // Use a fixed date for deterministic tests
        startDate = '2025-01-15',
    } = options;

    const baseDate = new Date(`${startDate}T00:00:00Z`);
    const entries = [];
    for (let i = 0; i < count; i++) {
        const date = new Date(baseDate);
        date.setUTCDate(date.getUTCDate() + Math.floor(i / 2));
        const dateStr = date.toISOString().split('T')[0];

        entries.push({
            _id: `entry-${userId}-${i}`,
            id: `entry-${userId}-${i}`,
            userId,
            userName,
            description: `Task ${i + 1}`,
            billable: i % 2 === 0,
            type: 'REGULAR',
            projectId: 'proj-1',
            projectName: 'Main Project',
            clientId: 'client-1',
            clientName: 'Test Client',
            taskId: 'task-1',
            taskName: 'Development',
            timeInterval: {
                start: `${dateStr}T09:00:00Z`,
                end: `${dateStr}T${12 + (i % 4)}:00:00Z`,
                duration: (3 + (i % 4)) * 3600,
            },
            hourlyRate: { amount: 5000, currency: 'USD' },
            earnedRate: 5000,
            costRate: 3000,
            amounts: [
                { type: 'EARNED', value: (3 + (i % 4)) * 50 },
                { type: 'COST', value: (3 + (i % 4)) * 30 },
            ],
            tags: [],
        });
    }
    return entries;
}

/**
 * Mock detailed report response
 */
export function createMockDetailedReportResponse(options: {
    entriesPerUser?: number;
    startDate?: string;
} = {}) {
    const { entriesPerUser = 5, startDate = '2025-01-15' } = options;

    const allEntries = mockUsers.flatMap(user =>
        createMockTimeEntries({
            userId: user.id,
            userName: user.name,
            count: entriesPerUser,
            startDate,
        })
    );

    return {
        timeentries: allEntries,
    };
}

/**
 * Mock user profile data
 */
export function createMockProfile(userId: string) {
    return {
        workCapacity: 'PT8H',
        workingDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    };
}

/**
 * Mock holidays data
 */
export function createMockHolidays(year = 2025) {
    return [
        {
            name: 'New Year',
            datePeriod: {
                startDate: `${year}-01-01`,
                endDate: `${year}-01-01`,
            },
        },
    ];
}

/**
 * Mock time off data
 */
export function createMockTimeOffResponse() {
    return {
        requests: [],
    };
}

/**
 * Setup API mocking for a test page
 */
export async function setupApiMocks(page: Page, options: {
    users?: typeof mockUsers;
    entriesPerUser?: number;
    startDate?: string;
    shouldFailUsers?: boolean;
    shouldFailReport?: boolean;
} = {}) {
    const {
        users = mockUsers,
        entriesPerUser = 5,
        startDate = '2025-01-15',
        shouldFailUsers = false,
        shouldFailReport = false,
    } = options;

    // Mock users endpoint
    await page.route('**/v1/workspaces/*/users', async (route: Route) => {
        if (shouldFailUsers) {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
        } else {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(users),
            });
        }
    });

    // Mock detailed report endpoint
    await page.route('**/v1/workspaces/*/reports/detailed', async (route: Route) => {
        if (shouldFailReport) {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
        } else {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(createMockDetailedReportResponse({ entriesPerUser, startDate })),
            });
        }
    });

    // Mock profiles endpoint
    await page.route('**/v1/workspaces/*/member-profile/*', async (route: Route) => {
        const url = route.request().url();
        const userId = url.split('/').pop() || 'user-1';
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockProfile(userId)),
        });
    });

    // Mock holidays endpoint
    await page.route('**/v1/workspaces/*/holidays/**', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockHolidays()),
        });
    });

    // Mock time-off endpoint
    await page.route('**/v1/workspaces/*/time-off/requests', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createMockTimeOffResponse()),
        });
    });
}

/**
 * Navigate to app with mock token
 */
export async function navigateWithToken(page: Page, token?: string) {
    const mockToken = token || createMockToken();
    await page.goto(`/?auth_token=${encodeURIComponent(mockToken)}`);
}
