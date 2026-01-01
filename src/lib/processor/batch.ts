import { fetchAllOrders } from '../shiphero/orders';
import { processOrder, type ProcessingContext, type ProcessingResult } from './order';
import { getQuotaManager } from '../shiphero/quota';
import { config, getFulfillmentStatuses } from '../config';
import { createLogger } from '../logging/axiom';
import { db } from '../db/client';
import { batchRuns } from '../db/schema';
import { getNow } from '../utils/timezone';
import { eq } from 'drizzle-orm';

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

  logger.info('batch_started', 'Starting batch processing', {
    batchId,
    startedAt: startedAt.toISOString(),
    dryRun: config.features.dryRun,
    fulfillmentStatuses: getFulfillmentStatuses(),
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
      });

      // Fetch orders with pagination
      const orderGenerator = fetchAllOrders({
        customerAccountId: config.shiphero.customerId,
        fulfillmentStatus: status,
        orderDateFrom: config.business.startDate,
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

    logger.info('batch_completed', 'Batch processing completed', {
      // batchId,
      ...result,
      duration: result.completedAt
        ? result.completedAt.getTime() - result.startedAt.getTime()
        : 0,
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
