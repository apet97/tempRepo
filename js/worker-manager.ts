/**
 * @fileoverview Worker Manager Module
 * Manages the lifecycle of the calculation Web Worker for offloading heavy
 * overtime calculations to a separate thread, keeping the main thread responsive.
 *
 * ## Worker Lifecycle
 *
 * ```
 * ┌─────────────────┐
 * │   init()        │──► Creates Worker from calc.worker.js
 * └────────┬────────┘    Waits for 'ready' message (5s timeout)
 *          │
 *          ▼
 * ┌─────────────────┐
 * │   isReady=true  │──► Worker ready to accept calculations
 * └────────┬────────┘
 *          │
 *          ▼
 * ┌─────────────────┐    Serializes store data (Maps → Arrays)
 * │ calculateAsync()│──► Posts message to worker
 * └────────┬────────┘    Returns Promise awaiting result
 *          │
 *          ▼
 * ┌─────────────────┐
 * │ handleMessage() │──► Reconstructs Maps from serialized data
 * └────────┬────────┘    Resolves pending Promise
 *          │
 *          ▼
 * ┌─────────────────┐
 * │  terminate()    │──► Cleans up worker on page unload
 * └─────────────────┘
 * ```
 *
 * ## Fallback Behavior
 * If Web Workers are unavailable or initialization fails, calculations
 * run synchronously on the main thread using calculateAnalysis() directly.
 *
 * ## Data Serialization
 * Store contains Map objects which cannot be transferred to workers directly.
 * The manager serializes Maps to arrays before posting and reconstructs
 * them from the response.
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
 * Manages Web Worker lifecycle for calculation offloading.
 *
 * Responsibilities:
 * - Creates and initializes the calculation worker
 * - Handles worker ready state and error conditions
 * - Serializes/deserializes data for worker communication
 * - Provides fallback to main-thread calculation if worker unavailable
 * - Manages pending calculation promises
 *
 * Usage:
 * ```typescript
 * await workerManager.init();
 * const results = await workerManager.calculateAsync(entries, store, dateRange);
 * ```
 */
class WorkerManager {
    private worker: Worker | null = null;
    private isReady = false;
    private pendingResolve: ((results: UserAnalysis[]) => void) | null = null;
    private pendingReject: ((error: Error) => void) | null = null;

    /**
     * Initialize the Web Worker.
     * Creates worker from calc.worker.js and waits for ready confirmation.
     * Fails gracefully if Workers are unsupported or initialization times out.
     *
     * @throws Never - errors are caught and logged, falling back to main thread.
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
                const worker = this.worker;
                if (!worker) {
                    reject(new Error('Worker not available'));
                    return;
                }

                const timeout = setTimeout(() => {
                    reject(new Error('Worker initialization timeout'));
                }, 5000);

                const originalHandler = worker.onmessage;
                worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    if (event.data.type === 'ready') {
                        clearTimeout(timeout);
                        this.isReady = true;
                        worker.onmessage = originalHandler;
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
     * Handle messages from the worker.
     * Processes 'result' messages by reconstructing Maps and resolving promises.
     * Processes 'error' messages by rejecting pending promises.
     *
     * @param data - Response from worker containing type and payload.
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
     * Run calculation asynchronously using the Web Worker.
     * Falls back to synchronous calculation on main thread if:
     * - Worker not initialized or not ready
     * - Entries or date range are null
     * - Worker initialization previously failed
     *
     * @param entries - Time entries to analyze (null triggers fallback).
     * @param store - Application store with config, profiles, holidays, etc.
     * @param dateRange - Date range for analysis (null triggers fallback).
     * @returns Promise resolving to array of UserAnalysis results.
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

        const worker = this.worker;
        if (!worker) {
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

            worker.postMessage({
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
     * Terminate the worker and clean up resources.
     * Should be called on page unload or when worker is no longer needed.
     * After termination, init() must be called again to use the worker.
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
