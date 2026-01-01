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
  | 'missing_address';

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

    // Get billable line items
    const billableItems = getBillableLineItems(order);

    logger.info('customs_calculated', `Calculating customs for ${billableItems.length} items`, {
      batchId,
      orderId: order.id,
      orderNumber: order.order_number,
      itemCount: billableItems.length,
    });

    // Calculate customs distribution
    const distribution = distributeCustomsValues(
      billableItems.map((item) => ({
        id: item.id,
        sku: item.sku,
        price: item.price || '0',
        quantity: item.quantity,
      })),
      config.business.maxCustomsValue
    );

    const total = distribution
      .filter((d) => !d.isComplimentary)
      .reduce((sum, d) => sum + parseFloat(d.newCustomsValue), 0);

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
