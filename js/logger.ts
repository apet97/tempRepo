/**
 * @fileoverview Structured Logging Module
 * Provides configurable logging with log levels and production safety.
 * In production mode, DEBUG and INFO logs are suppressed.
 */

import { STORAGE_KEYS } from './constants.js';

/**
 * Log levels in order of severity
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4,
}

/**
 * Log level names for display
 */
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.NONE]: 'NONE',
};

/**
 * Logger configuration
 */
interface LoggerConfig {
    /** Minimum log level to output */
    minLevel: LogLevel;
    /** Whether to include timestamps in output */
    timestamps: boolean;
    /** Whether to include the module name in output */
    showModule: boolean;
}

/**
 * Default configuration based on environment
 */
const getDefaultConfig = (): LoggerConfig => {
    const isDebug =
        typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.DEBUG) === 'true';

    const isProduction =
        typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

    return {
        minLevel: isDebug ? LogLevel.DEBUG : isProduction ? LogLevel.WARN : LogLevel.INFO,
        timestamps: true,
        showModule: true,
    };
};

/**
 * Global logger configuration
 */
let config: LoggerConfig = getDefaultConfig();

/**
 * Configure the logger
 */
export function configureLogger(newConfig: Partial<LoggerConfig>): void {
    config = { ...config, ...newConfig };
}

/**
 * Set the minimum log level
 */
export function setLogLevel(level: LogLevel): void {
    config.minLevel = level;
}

/**
 * Enable debug mode
 */
export function enableDebugMode(): void {
    config.minLevel = LogLevel.DEBUG;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.DEBUG, 'true');
    }
}

/**
 * Disable debug mode
 */
export function disableDebugMode(): void {
    config.minLevel = LogLevel.INFO;
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEYS.DEBUG);
    }
}

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
    return config.minLevel <= LogLevel.DEBUG;
}

/**
 * Format a log message with metadata
 */
function formatMessage(level: LogLevel, module: string | undefined, message: string): string {
    const parts: string[] = [];

    if (config.timestamps) {
        parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(`[${LOG_LEVEL_NAMES[level]}]`);

    if (config.showModule && module) {
        parts.push(`[${module}]`);
    }

    parts.push(message);

    return parts.join(' ');
}

/**
 * Sanitize data to remove sensitive information before logging
 * Removes tokens, emails, and other PII
 */
function sanitize(data: unknown): unknown {
    if (data === null || data === undefined) {
        return data;
    }

    if (typeof data === 'string') {
        // Mask potential tokens (long alphanumeric strings)
        return data.replace(/[a-zA-Z0-9]{32,}/g, '[REDACTED]');
    }

    if (Array.isArray(data)) {
        return data.map(sanitize);
    }

    if (typeof data === 'object') {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            const lowerKey = key.toLowerCase();
            // Redact sensitive fields
            if (
                lowerKey.includes('token') ||
                lowerKey.includes('password') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('email') ||
                lowerKey.includes('key') ||
                lowerKey === 'authorization'
            ) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = sanitize(value);
            }
        }
        return sanitized;
    }

    return data;
}

/**
 * Core log function
 */
function log(level: LogLevel, module: string | undefined, message: string, ...data: unknown[]): void {
    if (level < config.minLevel) {
        return;
    }

    const formattedMessage = formatMessage(level, module, message);
    const sanitizedData = data.map(sanitize);

    switch (level) {
        case LogLevel.DEBUG:
        case LogLevel.INFO:
            // In production, these should be suppressed by minLevel check above
            // eslint-disable-next-line no-console
            console.log(formattedMessage, ...sanitizedData);
            break;
        case LogLevel.WARN:
            console.warn(formattedMessage, ...sanitizedData);
            break;
        case LogLevel.ERROR:
            console.error(formattedMessage, ...sanitizedData);
            break;
    }
}

/**
 * Create a scoped logger for a specific module
 */
export function createLogger(module: string) {
    return {
        debug: (message: string, ...data: unknown[]) => log(LogLevel.DEBUG, module, message, ...data),
        info: (message: string, ...data: unknown[]) => log(LogLevel.INFO, module, message, ...data),
        warn: (message: string, ...data: unknown[]) => log(LogLevel.WARN, module, message, ...data),
        error: (message: string, ...data: unknown[]) => log(LogLevel.ERROR, module, message, ...data),
        /**
         * Log with explicit level
         */
        log: (level: LogLevel, message: string, ...data: unknown[]) => log(level, module, message, ...data),
        /**
         * Log performance timing
         */
        time: (label: string) => {
            if (config.minLevel <= LogLevel.DEBUG) {
                // eslint-disable-next-line no-console
                console.time(`[${module}] ${label}`);
            }
        },
        timeEnd: (label: string) => {
            if (config.minLevel <= LogLevel.DEBUG) {
                // eslint-disable-next-line no-console
                console.timeEnd(`[${module}] ${label}`);
            }
        },
    };
}

/**
 * Default logger instance (for general use without module scope)
 */
export const logger = {
    debug: (message: string, ...data: unknown[]) => log(LogLevel.DEBUG, undefined, message, ...data),
    info: (message: string, ...data: unknown[]) => log(LogLevel.INFO, undefined, message, ...data),
    warn: (message: string, ...data: unknown[]) => log(LogLevel.WARN, undefined, message, ...data),
    error: (message: string, ...data: unknown[]) => log(LogLevel.ERROR, undefined, message, ...data),
    log: (level: LogLevel, message: string, ...data: unknown[]) => log(level, undefined, message, ...data),
};

// Export LogLevel for consumers
export { LogLevel as Level };
