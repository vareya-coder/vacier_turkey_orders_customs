import { fetchAllOrders } from '../shiphero/orders';
import { processOrder, type ProcessingContext, type ProcessingResult } from './order';
import { getQuotaManager } from '../shiphero/quota';
import { config, getFulfillmentStatuses } from '../config';
import { createLogger } from '../logging/axiom';
import { db } from '../db/client';
import { batchRuns } from '../db/schema';
import { getNow } from '../utils/timezone';
import { eq } from 'drizzle-orm';
import { getProcessingCursor, updateProcessingCursor, getLatestOrderDate } from '../db/cursor';

const logger = createLogger({ service: 'batch-processor' });

export interface BatchResult {
  batchId: string;
  startedAt: Date;
  completedAt?: Date;
  ordersQueried: number;
  ordersProcessed: number;
  ordersSkipped: number;
  errorsCount: number;
  errorDetails: Array<{ orderId: string; orderNumber: string; error: string }>;
  creditsUsed: number;
  status: 'running' | 'completed' | 'failed';
}

/**
 * Generate a unique batch ID
 */
function generateBatchId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 7);
  return `batch_${timestamp}_${random}`;
}

/**
 * Process a batch of orders for customs value updates
 */
export async function processBatch(): Promise<BatchResult> {
  const batchId = generateBatchId();
  const startedAt = getNow();
  const quotaManager = getQuotaManager();

  // Reset quota manager for this batch
  quotaManager.reset();

  // Get processing cursor (last processed date)
  let processingStartDate: Date;
  try {
    processingStartDate = await getProcessingCursor();
  } catch (error) {
    logger.error('batch_error', 'Failed to get processing cursor, using env fallback', {
      batchId,
      error: error instanceof Error ? error.message : String(error),
      fallback: config.business.startDate,
    });
    // Fallback to env if cursor fails
    processingStartDate = new Date(config.business.startDate);
  }

  // Track all orders processed in this batch for cursor update
  const processedOrders: Array<{ order_date: string }> = [];

  // Log initial quota status with request limits
  const quotaStatus = quotaManager.getStatus();
  logger.info('batch_started', 'Starting batch processing', {
    batchId,
    startedAt: startedAt.toISOString(),
    dryRun: config.features.dryRun,
    fulfillmentStatuses: getFulfillmentStatuses(),
    quotaLimits: {
      credits: {
        max: quotaStatus.maxCredits,
        replenishRate: quotaStatus.replenishRate,
      },
      requests: {
        max: quotaStatus.maxRequestsPerWindow,
        windowMinutes: 5,
      },
    },
  });

  const result: BatchResult = {
    batchId,
    startedAt,
    ordersQueried: 0,
    ordersProcessed: 0,
    ordersSkipped: 0,
    errorsCount: 0,
    errorDetails: [],
    creditsUsed: 0,
    status: 'running',
  };

  try {
    // Create batch run record in database
    await db.insert(batchRuns).values({
      batchId,
      startedAt,
      ordersQueried: 0,
      ordersProcessed: 0,
      ordersSkipped: 0,
      errorsCount: 0,
      creditsUsed: 0,
      status: 'running',
    });

    const processingContext: ProcessingContext = {
      batchId,
      dryRun: config.features.dryRun,
    };

    // Get fulfillment statuses to query
    const statuses = getFulfillmentStatuses();

    // Process each fulfillment status
    for (const status of statuses) {
      logger.info('batch_started', `Processing orders with status: ${status}`, {
        batchId,
        fulfillmentStatus: status,
        startDate: processingStartDate.toISOString(),
      });

      // Fetch orders with pagination, starting from cursor date
      const orderGenerator = fetchAllOrders({
        customerAccountId: config.shiphero.customerId,
        fulfillmentStatus: status,
        orderDateFrom: processingStartDate.toISOString(),
        first: 25,
      });

      // Process each batch of orders
      for await (const orderBatch of orderGenerator) {
        result.ordersQueried += orderBatch.length;

        logger.info('orders_queried', `Processing ${orderBatch.length} orders`, {
          batchId,
          totalQueried: result.ordersQueried,
          fulfillmentStatus: status,
        });

        // Process each order in the batch
        for (const order of orderBatch) {
          // Check quota before processing
          const quotaCheck = quotaManager.canProceed(50); // Estimate 50 credits per order

          if (!quotaCheck.ok) {
            if (quotaCheck.waitMs) {
              logger.warn('quota_warning', `Waiting ${quotaCheck.waitMs}ms for quota to replenish`, {
                batchId,
                waitMs: quotaCheck.waitMs,
              });

              // Wait for quota to replenish (max 2 minutes)
              const canProceed = await quotaManager.waitForCredits(50, 120000);

              if (!canProceed) {
                logger.warn('quota_warning', 'Quota exhausted, stopping batch early', {
                  batchId,
                  ordersQueried: result.ordersQueried,
                  ordersProcessed: result.ordersProcessed,
                });
                break;
              }
            } else {
              // Quota exhausted, stop processing
              logger.warn('quota_warning', 'Quota exhausted, stopping batch', {
                batchId,
                ordersQueried: result.ordersQueried,
                ordersProcessed: result.ordersProcessed,
              });
              break;
            }
          }

          // Process the order
          const orderResult: ProcessingResult = await processOrder(order, processingContext);

          // Update quota
          quotaManager.updateFromResponse(orderResult.creditsUsed);

          // Track order for cursor update (only if processed successfully and has order_date)
          if (orderResult.status === 'processed' && order.order_date) {
            processedOrders.push({ order_date: order.order_date });
          }

          // Update result counters
          if (orderResult.status === 'processed') {
            result.ordersProcessed++;
          } else if (orderResult.status === 'skipped') {
            result.ordersSkipped++;
          } else if (orderResult.status === 'error') {
            result.errorsCount++;
            result.errorDetails.push({
              orderId: orderResult.orderId,
              orderNumber: orderResult.orderNumber,
              error: orderResult.error?.message || 'Unknown error',
            });
          }

          result.creditsUsed += orderResult.creditsUsed;
        }
      }
    }

    // Batch completed successfully
    result.status = 'completed';
    result.completedAt = getNow();

    // Update processing cursor with latest order date
    if (processedOrders.length > 0) {
      try {
        const latestOrderDate = getLatestOrderDate(processedOrders);
        await updateProcessingCursor(latestOrderDate, batchId);

        logger.info('cursor_updated', 'Processing cursor advanced', {
          batchId,
          ordersProcessed: processedOrders.length,
          newCursorDate: latestOrderDate.toISOString(),
        });
      } catch (error) {
        logger.error('cursor_error', 'Failed to update cursor after batch', {
          batchId,
          error: error instanceof Error ? error.message : String(error),
          note: 'Next batch will reprocess from old cursor',
        });
        // Don't fail the batch if cursor update fails
        // Next run will reprocess from old cursor (safe)
      }
    } else {
      logger.info('cursor_unchanged', 'No orders processed, cursor not updated', {
        batchId,
      });
    }

    // Get final quota status
    const finalQuotaStatus = quotaManager.getStatus();

    logger.info('batch_completed', 'Batch processing completed', {
      // batchId,
      ...result,
      duration: result.completedAt
        ? result.completedAt.getTime() - result.startedAt.getTime()
        : 0,
      quotaUsage: {
        creditsUsed: finalQuotaStatus.totalUsed,
        creditsRemaining: finalQuotaStatus.remaining,
        requestsMade: finalQuotaStatus.requestsInWindow,
        requestsRemaining: finalQuotaStatus.requestLimitRemaining,
      },
    });
  } catch (error) {
    result.status = 'failed';
    result.completedAt = getNow();

    logger.error('batch_error', 'Batch processing failed', {
      // batchId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...result,
    });
  } finally {
    // Update batch run record in database
    try {
      await db
        .update(batchRuns)
        .set({
          completedAt: result.completedAt,
          ordersQueried: result.ordersQueried,
          ordersProcessed: result.ordersProcessed,
          ordersSkipped: result.ordersSkipped,
          errorsCount: result.errorsCount,
          errorDetails: result.errorDetails.length > 0 ? result.errorDetails : null,
          creditsUsed: result.creditsUsed,
          status: result.status,
        })
        .where(eq(batchRuns.batchId, batchId));

      logger.info('batch_completed', 'Batch run saved to database', {
        batchId,
      });
    } catch (dbError) {
      logger.error('batch_error', 'Failed to update batch run in database', {
        batchId,
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }

    // Flush Axiom logs
    try {
      await logger.flush();
    } catch (flushError) {
      console.error('Failed to flush logs:', flushError);
    }
  }

  return result;
}

/**
 * Get batch run by ID from database
 */
export async function getBatchRun(batchId: string) {
  const [batchRun] = await db
    .select()
    .from(batchRuns)
    .where(eq(batchRuns.batchId, batchId))
    .limit(1);

  return batchRun;
}

/**
 * Get recent batch runs from database
 */
export async function getRecentBatchRuns(limit: number = 10) {
  return await db.select().from(batchRuns).orderBy(batchRuns.startedAt).limit(limit);
}
