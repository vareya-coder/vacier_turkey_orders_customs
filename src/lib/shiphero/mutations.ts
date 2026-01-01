import { getShipHeroClient } from './client';
import type { UpdateLineItemsResponse, AddTagsResponse, LineItemUpdate } from './types';
import { createLogger } from '../logging/axiom';
import { ShipHeroError } from './errors';

const logger = createLogger({ service: 'shiphero-mutations' });

/**
 * GraphQL mutation to update line items
 */
const UPDATE_LINE_ITEMS_MUTATION = `
  mutation UpdateLineItems($orderId: String!, $lineItems: [LineItemUpdateInput!]!) {
    order_update_line_items(
      data: {
        order_id: $orderId
        line_items: $lineItems
      }
    ) {
      request_id
      complexity
      order {
        id
        order_number
        line_items(first: 50) {
          edges {
            node {
              id
              sku
              customs_value
            }
          }
        }
      }
      user_errors {
        message
        path
      }
    }
  }
`;

/**
 * GraphQL mutation to add tags to an order
 */
const ADD_TAGS_MUTATION = `
  mutation AddTags($orderId: String!, $tags: [String!]!) {
    order_add_tags(
      data: {
        order_id: $orderId
        tags: $tags
      }
    ) {
      request_id
      complexity
      order {
        id
        order_number
        tags
      }
      user_errors {
        message
        path
      }
    }
  }
`;

/**
 * Update customs values for line items in an order
 */
export async function updateLineItemsCustomsValue(
  orderId: string,
  lineItems: Array<{ id: string; customs_value: string }>,
  context?: { batchId?: string; orderNumber?: string }
): Promise<{ success: boolean; complexity: number }> {
  const client = getShipHeroClient();

  logger.info('line_items_updated', `Updating ${lineItems.length} line items`, {
    orderId,
    orderNumber: context?.orderNumber,
    batchId: context?.batchId,
    lineItemCount: lineItems.length,
  });

  try {
    // Transform to ShipHero's expected format
    const lineItemUpdates: LineItemUpdate[] = lineItems.map((item) => ({
      line_item_id: item.id,
      customs_value: item.customs_value,
    }));

    const response = await client.request<UpdateLineItemsResponse>(
      UPDATE_LINE_ITEMS_MUTATION,
      {
        orderId,
        lineItems: lineItemUpdates,
      }
    );

    // Check for user errors
    if (response.data?.order_update_line_items?.user_errors?.length) {
      const errors = response.data.order_update_line_items.user_errors;
      const errorMessages = errors.map((e) => e.message).join(', ');

      logger.error('batch_error', 'Line items update failed with user errors', {
        orderId,
        orderNumber: context?.orderNumber,
        batchId: context?.batchId,
        errors: errorMessages,
      });

      throw new ShipHeroError(
        `Failed to update line items: ${errorMessages}`,
        'USER_ERROR',
        undefined,
        errors
      );
    }

    const complexity = response.data?.order_update_line_items?.complexity || 0;

    logger.info('line_items_updated', 'Line items updated successfully', {
      orderId,
      orderNumber: context?.orderNumber,
      batchId: context?.batchId,
      complexity,
      lineItemCount: lineItems.length,
    });

    return {
      success: true,
      complexity,
    };
  } catch (error) {
    logger.error('batch_error', 'Failed to update line items', {
      orderId,
      orderNumber: context?.orderNumber,
      batchId: context?.batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Add a tag to an order
 */
export async function addOrderTag(
  orderId: string,
  tag: string,
  context?: { batchId?: string; orderNumber?: string }
): Promise<{ success: boolean; complexity: number }> {
  const client = getShipHeroClient();

  logger.info('order_tagged', `Adding tag "${tag}" to order`, {
    orderId,
    orderNumber: context?.orderNumber,
    batchId: context?.batchId,
    tag,
  });

  try {
    const response = await client.request<AddTagsResponse>(
      ADD_TAGS_MUTATION,
      {
        orderId,
        tags: [tag],
      }
    );

    // Check for user errors
    if (response.data?.order_add_tags?.user_errors?.length) {
      const errors = response.data.order_add_tags.user_errors;
      const errorMessages = errors.map((e) => e.message).join(', ');

      logger.error('batch_error', 'Add tag failed with user errors', {
        orderId,
        orderNumber: context?.orderNumber,
        batchId: context?.batchId,
        tag,
        errors: errorMessages,
      });

      throw new ShipHeroError(
        `Failed to add tag: ${errorMessages}`,
        'USER_ERROR',
        undefined,
        errors
      );
    }

    const complexity = response.data?.order_add_tags?.complexity || 0;

    logger.info('order_tagged', 'Tag added successfully', {
      orderId,
      orderNumber: context?.orderNumber,
      batchId: context?.batchId,
      tag,
      complexity,
    });

    return {
      success: true,
      complexity,
    };
  } catch (error) {
    logger.error('batch_error', 'Failed to add tag', {
      orderId,
      orderNumber: context?.orderNumber,
      batchId: context?.batchId,
      tag,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Add multiple tags to an order (batch operation)
 */
export async function addOrderTags(
  orderId: string,
  tags: string[],
  context?: { batchId?: string; orderNumber?: string }
): Promise<{ success: boolean; complexity: number }> {
  const client = getShipHeroClient();

  logger.info('order_tagged', `Adding ${tags.length} tags to order`, {
    orderId,
    orderNumber: context?.orderNumber,
    batchId: context?.batchId,
    tags,
  });

  try {
    const response = await client.request<AddTagsResponse>(
      ADD_TAGS_MUTATION,
      {
        orderId,
        tags,
      }
    );

    // Check for user errors
    if (response.data?.order_add_tags?.user_errors?.length) {
      const errors = response.data.order_add_tags.user_errors;
      const errorMessages = errors.map((e) => e.message).join(', ');

      logger.error('batch_error', 'Add tags failed with user errors', {
        orderId,
        orderNumber: context?.orderNumber,
        batchId: context?.batchId,
        tags,
        errors: errorMessages,
      });

      throw new ShipHeroError(
        `Failed to add tags: ${errorMessages}`,
        'USER_ERROR',
        undefined,
        errors
      );
    }

    const complexity = response.data?.order_add_tags?.complexity || 0;

    logger.info('order_tagged', 'Tags added successfully', {
      orderId,
      orderNumber: context?.orderNumber,
      batchId: context?.batchId,
      tags,
      complexity,
    });

    return {
      success: true,
      complexity,
    };
  } catch (error) {
    logger.error('batch_error', 'Failed to add tags', {
      orderId,
      orderNumber: context?.orderNumber,
      batchId: context?.batchId,
      tags,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
