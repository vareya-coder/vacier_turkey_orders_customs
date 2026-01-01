import { Axiom } from '@axiomhq/js';
import { env } from '../env';
import type { LogEvent, LogLevel, LogContext, LogEntry } from './types';

// Initialize Axiom client (singleton)
let axiomClient: Axiom | null = null;

function getAxiomClient(): Axiom {
  if (!axiomClient) {
    axiomClient = new Axiom({
      token: env.AXIOM_TOKEN,
      orgId: env.AXIOM_DATASET,
    });
  }
  return axiomClient;
}

/**
 * Logger class with context injection and structured logging
 */
export class Logger {
  private baseContext: LogContext;

  constructor(baseContext: LogContext = {}) {
    this.baseContext = baseContext;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.baseContext, ...additionalContext });
  }

  /**
   * Log a message with specified level and event type
   */
  private log(level: LogLevel, event: LogEvent, message: string, context: LogContext = {}): void {
    const logEntry: LogEntry = {
      level,
      event,
      message,
      context: { ...this.baseContext, ...context },
      timestamp: new Date().toISOString(),
    };

    // Log to console for development
    if (env.NODE_ENV === 'development') {
      const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      consoleMethod(`[${level.toUpperCase()}] ${event}: ${message}`, logEntry.context);
    }

    // Send to Axiom (async, non-blocking)
    try {
      const client = getAxiomClient();
      client.ingest(env.AXIOM_DATASET, [
        {
          _time: logEntry.timestamp,
          level: logEntry.level,
          event: logEntry.event,
          message: logEntry.message,
          ...logEntry.context,
        },
      ]);
    } catch (error) {
      // Don't let logging errors crash the application
      console.error('Failed to send log to Axiom:', error);
    }
  }

  debug(event: LogEvent, message: string, context?: LogContext): void {
    this.log('debug', event, message, context);
  }

  info(event: LogEvent, message: string, context?: LogContext): void {
    this.log('info', event, message, context);
  }

  warn(event: LogEvent, message: string, context?: LogContext): void {
    this.log('warn', event, message, context);
  }

  error(event: LogEvent, message: string, context?: LogContext): void {
    this.log('error', event, message, context);
  }

  /**
   * Flush pending logs (call before process exit)
   */
  async flush(): Promise<void> {
    if (axiomClient) {
      try {
        await axiomClient.flush();
      } catch (error) {
        console.error('Failed to flush Axiom logs:', error);
      }
    }
  }
}

/**
 * Create a logger instance with optional context
 */
export function createLogger(context: LogContext = {}): Logger {
  return new Logger(context);
}

/**
 * Default logger instance (no context)
 */
export const logger = createLogger();
