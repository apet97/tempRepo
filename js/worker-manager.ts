/**
 * @fileoverview Worker Manager
 * Manages the lifecycle of the calculation Web Worker.
 * Provides an async wrapper for running calculations in a separate thread.
 */

import { calculateAnalysis } from './calc.js';
import type { TimeEntry, DateRange, UserAnalysis, DayData } from './types.js';
import type { Store } from './state.js';

/**
 * Serialized user analysis from worker
 */
interface SerializedUserAnalysis {
    userId: string;
    userName: string;
    days: [string, DayData][];
    totals: UserAnalysis['totals'];
}

/**
 * Worker response structure
 */
interface WorkerResponse {
    type: 'ready' | 'result' | 'error';
    payload?: SerializedUserAnalysis[];
    error?: string;
}

/**
 * Worker manager class
 */
class WorkerManager {
    private worker: Worker | null = null;
    private isReady = false;
    private pendingResolve: ((results: UserAnalysis[]) => void) | null = null;
    private pendingReject: ((error: Error) => void) | null = null;

    /**
     * Initialize the Web Worker
     */
    async init(): Promise<void> {
        if (this.worker) return;

        // Check if Web Workers are supported
        if (typeof Worker === 'undefined') {
            console.warn('Web Workers not supported, calculations will run on main thread');
            return;
        }

        try {
            // Create worker - in production this would be the bundled worker file
            this.worker = new Worker(new URL('./calc.worker.js', import.meta.url), {
                type: 'module',
            });

            // Set up message handler
            this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                this.handleMessage(event.data);
            };

            // Set up error handler
            this.worker.onerror = (error) => {
                console.error('Worker error:', error);
                if (this.pendingReject) {
                    this.pendingReject(new Error('Worker error'));
                    this.pendingResolve = null;
                    this.pendingReject = null;
                }
            };

            // Wait for worker to be ready
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Worker initialization timeout'));
                }, 5000);

                const originalHandler = this.worker!.onmessage;
                this.worker!.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    if (event.data.type === 'ready') {
                        clearTimeout(timeout);
                        this.isReady = true;
                        this.worker!.onmessage = originalHandler;
                        resolve();
                    }
                };
            });
        } catch (error) {
            console.warn('Failed to initialize Web Worker, falling back to main thread:', error);
            this.worker = null;
        }
    }

    /**
     * Handle messages from the worker
     */
    private handleMessage(data: WorkerResponse): void {
        if (data.type === 'result' && this.pendingResolve && data.payload) {
            // Reconstruct Maps from serialized data
            const results: UserAnalysis[] = data.payload.map((user) => ({
                ...user,
                days: new Map(user.days),
            }));
            this.pendingResolve(results);
            this.pendingResolve = null;
            this.pendingReject = null;
        } else if (data.type === 'error' && this.pendingReject) {
            this.pendingReject(new Error(data.error || 'Unknown worker error'));
            this.pendingResolve = null;
            this.pendingReject = null;
        }
    }

    /**
     * Run calculation asynchronously using the Web Worker
     * Falls back to synchronous calculation if worker is unavailable
     */
    async calculateAsync(
        entries: TimeEntry[] | null,
        store: Store,
        dateRange: DateRange | null
    ): Promise<UserAnalysis[]> {
        // Fallback to synchronous calculation if worker not available
        if (!this.worker || !this.isReady || !entries || !dateRange) {
            return calculateAnalysis(entries, store, dateRange);
        }

        return new Promise((resolve, reject) => {
            this.pendingResolve = resolve;
            this.pendingReject = reject;

            // Serialize store data for transfer to worker
            const serializedStore = {
                users: store.users,
                profiles: Array.from(store.profiles.entries()),
                holidays: Array.from(store.holidays.entries()).map(([userId, hMap]) => [
                    userId,
                    Array.from(hMap.entries()),
                ] as [string, [string, unknown][]]),
                timeOff: Array.from(store.timeOff.entries()).map(([userId, tMap]) => [
                    userId,
                    Array.from(tMap.entries()),
                ] as [string, [string, unknown][]]),
                overrides: store.overrides,
                config: store.config,
                calcParams: store.calcParams,
            };

            this.worker!.postMessage({
                type: 'calculate',
                payload: {
                    entries,
                    dateRange,
                    store: serializedStore,
                },
            });
        });
    }

    /**
     * Terminate the worker
     */
    terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isReady = false;
        }
    }
}

// Export singleton instance
export const workerManager = new WorkerManager();

// Export function for async calculation
export async function calculateAsync(
    entries: TimeEntry[] | null,
    store: Store,
    dateRange: DateRange | null
): Promise<UserAnalysis[]> {
    return workerManager.calculateAsync(entries, store, dateRange);
}
