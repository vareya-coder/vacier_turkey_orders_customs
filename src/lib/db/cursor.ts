import { db } from './client';
import { processingCursor } from './schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { createLogger } from '../logging/axiom';

const logger = createLogger({ service: 'cursor-manager' });

const DEFAULT_CURSOR_NAME = 'main';

/**
 * Get the current processing cursor date
 * Returns PROCESSING_START_DATE from env if cursor doesn't exist (first run)
 */
export async function getProcessingCursor(
  cursorName: string = DEFAULT_CURSOR_NAME
): Promise<Date> {
  try {
    const [cursor] = await db
      .select()
      .from(processingCursor)
      .where(eq(processingCursor.cursorName, cursorName))
      .limit(1);

    if (cursor) {
      logger.info('cursor_loaded', 'Loaded processing cursor from database', {
        cursorName,
        lastProcessedDate: cursor.lastProcessedDate.toISOString(),
        updatedAt: cursor.updatedAt.toISOString(),
        updatedByBatchId: cursor.updatedByBatchId,
      });
      return cursor.lastProcessedDate;
    }

    // First run - initialize with env PROCESSING_START_DATE
    const startDate = new Date(config.business.startDate);
        
    await db.insert(processingCursor).values({
      cursorName,
      lastProcessedDate: startDate,
      updatedAt: new Date(),
      updatedByBatchId: null,
    });

    logger.info('cursor_initialized', 'Initialized processing cursor from env', {
      cursorName,
      startDate: startDate.toISOString(),
      source: 'PROCESSING_START_DATE env var',
    });

    return startDate;
  } catch (error) {
    logger.error('cursor_error', 'Failed to get processing cursor', {
      cursorName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Update the processing cursor to new date
 * Only call this after successful batch completion
 */
export async function updateProcessingCursor(
  newDate: Date,
  batchId: string,
  cursorName: string = DEFAULT_CURSOR_NAME
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const result = await tx
        .update(processingCursor)
        .set({
          lastProcessedDate: newDate,
          updatedAt: new Date(),
          updatedByBatchId: batchId,
        })
        .where(eq(processingCursor.cursorName, cursorName))
        .returning();

      if (result.length === 0) {
        // Cursor doesn't exist, insert it
        await tx.insert(processingCursor).values({
          cursorName,
          lastProcessedDate: newDate,
          updatedAt: new Date(),
          updatedByBatchId: batchId,
        });
      }
    });

    logger.info('cursor_updated', 'Updated processing cursor', {
      cursorName,
      newDate: newDate.toISOString(),
      batchId,
    });
  } catch (error) {
    logger.error('cursor_error', 'Failed to update processing cursor', {
      cursorName,
      newDate: newDate.toISOString(),
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get the latest order date from the current batch
 * Used to determine what cursor value to set after successful batch
 */
export function getLatestOrderDate(orders: Array<{ order_date: string }>): Date {
  if (orders.length === 0) {
    return new Date(); // No orders processed, use current time
  }

  const dates = orders.map((o) => new Date(o.order_date));
  const latest = new Date(Math.max(...dates.map((d) => d.getTime())));

  // Safety check: Don't move cursor more than 1 day into future
  const now = new Date();
  const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (latest > oneDayFromNow) {
    logger.warn('cursor_warning', 'Latest order date is in future, capping to now', {
      latestOrderDate: latest.toISOString(),
      cappedTo: now.toISOString(),
    });
    return now;
  }

  return latest;
}
