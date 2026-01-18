
import { jest } from '@jest/globals';

export const Api = {
    fetchUsers: jest.fn(),
    fetchEntries: jest.fn(),
    fetchAllProfiles: jest.fn(),
    fetchAllHolidays: jest.fn(),
    fetchAllTimeOff: jest.fn(),
    fetchUserProfile: jest.fn(),
    fetchHolidays: jest.fn(),
    fetchTimeOffRequests: jest.fn()
};
