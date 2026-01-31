import type { Order } from '../shiphero/types';
import { hasBillableItems, hasTag, getBillableLineItems } from '../shiphero/orders';
import { updateLineItemsCustomsValue, addOrderTag } from '../shiphero/mutations';
import { distributeCustomsValues } from '../customs/distributor';
import { config } from '../config';
import { createLogger } from '../logging/axiom';

const logger = createLogger({ service: 'order-processor' });

export interface ProcessingContext {
  batchId: string;
  dryRun?: boolean;
}

export interface ProcessingResult {
  orderId: string;
  orderNumber: string;
  status: 'processed' | 'skipped' | 'error';
  reason?: string;
  creditsUsed: number;
  error?: Error;
}

export type SkipReason =
  | 'not_turkey'
  | 'already_tagged'
  | 'no_billable_items'
  | 'missing_address'
  | 'zero_or_negative_total';

/**
 * Calculate effective maximum customs value based on order total
 * Handles discounted orders and zero/negative totals
 */
function calculateEffectiveMaxTotal(
  order: Order,
  defaultMaxTotal: number
): number | null {
  const orderTotal = parseFloat(order.total_price || '0');

  // Case 1: Zero or negative order total → Skip customs entirely
  if (orderTotal <= 0) {
    return null; // Signal to skip customs
  }

  // Case 2: Order total below default max → Use order total as cap
  if (orderTotal < defaultMaxTotal) {
    return orderTotal;
  }

  // Case 3: Order total >= default max → Use default max (25 EUR)
  return defaultMaxTotal;
}

/**
 * Process a single order for customs value update
 */
export async function processOrder(
  order: Order,
  context: ProcessingContext
): Promise<ProcessingResult> {
  const { batchId, dryRun = config.features.dryRun } = context;

  logger.info('order_processing', `Processing order ${order.order_number}`, {
    batchId,
    orderId: order.id,
    orderNumber: order.order_number,
    dryRun,
  });

  // Log order number for backfill tracking
  if (config.features.enableManualBackfill) {
    logger.warn('batch_started', '🔄 BACKFILL: Processing order', {
      orderNumber: order.order_number,
      orderDate: order.order_date,
      mode: 'BACKFILL',
      orderId: order.id,
    });
  }

  let creditsUsed = 0;

  try {
    // Validate: Check if order has shipping address
    if (!order.shipping_address) {
      logger.warn('order_skipped', 'Order missing shipping address', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
      });

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'skipped',
        reason: 'missing_address',
        creditsUsed: 0,
      };
    }

    // Validate: Check if order is shipping to Turkey
    const country = order.shipping_address.country_code || order.shipping_address.country;
    if (country !== config.business.targetCountry) {
      logger.debug('order_skipped', `Order shipping to ${country}, not ${config.business.targetCountry}`, {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
        country,
      });

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'skipped',
        reason: 'not_turkey',
        creditsUsed: 0,
      };
    }

    // Validate: Check if order is already processed (has tag)
    if (hasTag(order, config.business.processedTag)) {
      logger.debug('order_skipped', 'Order already tagged as processed', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
        tag: config.business.processedTag,
      });

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'skipped',
        reason: 'already_tagged',
        creditsUsed: 0,
      };
    }

    // Validate: Check if order has billable items
    if (!hasBillableItems(order)) {
      logger.info('order_skipped', 'Order has no billable items', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
      });

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'skipped',
        reason: 'no_billable_items',
        creditsUsed: 0,
      };
    }

    // Calculate effective max customs value based on order total
    const effectiveMaxTotal = calculateEffectiveMaxTotal(
      order,
      config.business.maxCustomsValue
    );

    // Handle zero/negative order total → Skip customs distribution
    if (effectiveMaxTotal === null) {
      logger.info('order_skipped', 'Order total is zero or negative, skipping customs', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
        orderTotal: order.total_price,
        subtotal: order.subtotal,
        totalDiscounts: order.total_discounts,
      });

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'skipped',
        reason: 'zero_or_negative_total',
        creditsUsed: 0,
      };
    }

    // Log discount/adjustment information if applicable
    const orderTotal = parseFloat(order.total_price || '0');
    if (effectiveMaxTotal < config.business.maxCustomsValue) {
      logger.info('customs_adjusted', 'Order total below standard max, using discounted cap', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
        orderTotal: orderTotal.toFixed(2),
        subtotal: order.subtotal,
        totalDiscounts: order.total_discounts,
        standardMax: config.business.maxCustomsValue,
        effectiveMax: effectiveMaxTotal.toFixed(2),
      });
    }

    // Get billable line items
    const billableItems = getBillableLineItems(order);

    logger.info('customs_calculated', `Calculating customs for ${billableItems.length} items`, {
      batchId,
      orderId: order.id,
      orderNumber: order.order_number,
      itemCount: billableItems.length,
      orderTotal: orderTotal.toFixed(2),
      effectiveMaxTotal: effectiveMaxTotal.toFixed(2),
    });

    // Calculate customs distribution
    const distribution = distributeCustomsValues(
      billableItems.map((item) => ({
        id: item.id,
        sku: item.sku,
        price: item.price || '0',
        quantity: item.quantity,
      })),
      effectiveMaxTotal
    );

    const total = distribution
      .filter((d) => !d.isComplimentary)
      .reduce((sum, d) => sum + parseFloat(d.newCustomsValue), 0);

    // Validate that distributed customs doesn't exceed order total
    if (total > orderTotal + 0.01) {
      logger.error('batch_error', 'Distributed customs exceeds order total!', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
        orderTotal: orderTotal.toFixed(2),
        distributedTotal: total.toFixed(2),
        difference: (total - orderTotal).toFixed(2),
      });

      throw new Error(
        `Customs distribution (${total.toFixed(2)}) exceeds order total (${orderTotal.toFixed(2)})`
      );
    }

    logger.info('customs_calculated', `Customs values calculated (total: €${total.toFixed(2)})`, {
      batchId,
      orderId: order.id,
      orderNumber: order.order_number,
      totalCustomsValue: total.toFixed(2),
      maxAllowed: config.business.maxCustomsValue,
      distribution: distribution.length,
    });

    // Update line items (if not dry-run and feature enabled)
    if (!dryRun && config.features.enableCustomsUpdate) {
      const lineItemUpdates = distribution.map((d) => ({
        id: d.lineItemId,
        customs_value: d.newCustomsValue,
      }));

      const result = await updateLineItemsCustomsValue(order.id, lineItemUpdates, {
        batchId,
        orderNumber: order.order_number,
      });

      creditsUsed += result.complexity;
    } else {
      logger.info('line_items_updated', 'DRY-RUN: Would update line items', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
        updates: distribution.length,
      });
    }

    // Add tag (if not dry-run and feature enabled)
    if (!dryRun && config.features.enableTagging) {
      const result = await addOrderTag(order.id, config.business.processedTag, {
        batchId,
        orderNumber: order.order_number,
      });

      creditsUsed += result.complexity;
    } else {
      logger.info('order_tagged', 'DRY-RUN: Would add tag', {
        batchId,
        orderId: order.id,
        orderNumber: order.order_number,
        tag: config.business.processedTag,
      });
    }

    logger.info('order_completed', 'Order processed successfully', {
      batchId,
      orderId: order.id,
      orderNumber: order.order_number,
      creditsUsed,
      dryRun,
    });

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      status: 'processed',
      creditsUsed,
    };
  } catch (error) {
    logger.error('batch_error', 'Error processing order', {
      batchId,
      orderId: order.id,
      orderNumber: order.order_number,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      status: 'error',
      reason: error instanceof Error ? error.message : 'Unknown error',
      creditsUsed,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
