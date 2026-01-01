import { getShipHeroClient } from './client';
import { GET_VACIER_ORDERS } from './queries';
import type { Order, OrdersQueryResponse, OrderFilters } from './types';
import { createLogger } from '../logging/axiom';

const logger = createLogger({ service: 'shiphero-orders' });

/**
 * Fetch orders with pagination
 * Returns an async generator that yields batches of orders
 */
export async function* fetchAllOrders(
  filters: OrderFilters
): AsyncGenerator<Order[], void, undefined> {
  const client = getShipHeroClient();
  let cursor: string | undefined = filters.cursor;
  let pageCount = 0;
  let totalOrders = 0;
  const pageSize = filters.first || 25;

  logger.info('orders_queried', 'Starting order query', {
    filters: {
      customerAccountId: filters.customerAccountId,
      fulfillmentStatus: filters.fulfillmentStatus,
      orderDateFrom: filters.orderDateFrom,
      pageSize,
    },
  });

  while (true) {
    pageCount++;

    try {
      // Execute GraphQL query
      const response = await client.request<OrdersQueryResponse>(
        GET_VACIER_ORDERS,
        {
          cursor,
          status: filters.fulfillmentStatus,
          startDate: filters.orderDateFrom,
          customerId: filters.customerAccountId,
          first: pageSize,
        }
      );

      if (!response.data?.orders?.data) {
        logger.warn('orders_queried', 'No data in response', { pageCount, cursor });
        break;
      }

      const ordersData = response.data.orders.data;
      const orders = ordersData.edges.map((edge) => edge.node);

      if (orders.length === 0) {
        logger.info('orders_queried', 'No more orders found', { pageCount, totalOrders });
        break;
      }

      totalOrders += orders.length;

      logger.debug('orders_queried', `Fetched page ${pageCount}`, {
        pageCount,
        ordersInPage: orders.length,
        totalOrders,
        hasNextPage: ordersData.pageInfo.hasNextPage,
        complexity: response.data.orders.complexity,
      });

      // Yield this batch of orders
      yield orders;

      // Check if there are more pages
      if (!ordersData.pageInfo.hasNextPage) {
        logger.info('orders_queried', 'All orders fetched', {
          totalPages: pageCount,
          totalOrders,
        });
        break;
      }

      // Update cursor for next page
      cursor = ordersData.pageInfo.endCursor || undefined;

    } catch (error) {
      logger.error('batch_error', 'Error fetching orders', {
        error: error instanceof Error ? error.message : String(error),
        pageCount,
        totalOrders,
        cursor,
      });
      throw error;
    }
  }
}

/**
 * Fetch all orders as a flat array (use with caution for large datasets)
 */
export async function fetchAllOrdersArray(filters: OrderFilters): Promise<Order[]> {
  const allOrders: Order[] = [];

  for await (const orderBatch of fetchAllOrders(filters)) {
    allOrders.push(...orderBatch);
  }

  return allOrders;
}

/**
 * Count orders matching filters (without fetching all data)
 */
export async function countOrders(filters: OrderFilters): Promise<number> {
  let count = 0;

  for await (const orderBatch of fetchAllOrders(filters)) {
    count += orderBatch.length;
  }

  return count;
}

/**
 * Check if an order has line items with billable (non-zero price) items
 */
export function hasBillableItems(order: Order): boolean {
  return order.line_items.edges.some((edge) => {
    const price = parseFloat(edge.node.price || '0');
    return price > 0;
  });
}

/**
 * Check if an order is tagged with a specific tag
 */
export function hasTag(order: Order, tag: string): boolean {
  return order.tags?.includes(tag) ?? false;
}

/**
 * Get billable line items from an order
 */
export function getBillableLineItems(order: Order) {
  return order.line_items.edges
    .map((edge) => edge.node)
    .filter((item) => {
      const price = parseFloat(item.price || '0');
      return price > 0;
    });
}
