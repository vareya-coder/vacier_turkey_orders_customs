/**
 * ShipHero GraphQL API Types
 */

// Pagination
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface Edge<T> {
  cursor: string;
  node: T;
}

export interface Connection<T> {
  pageInfo: PageInfo;
  edges: Edge<T>[];
}

// Address
export interface Address {
  first_name?: string;
  last_name?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  state_code?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  phone?: string;
  email?: string;
}

// Line Item
export interface LineItem {
  id: string;
  sku: string;
  partner_line_item_id?: string;
  quantity: number;
  quantity_allocated?: number;
  quantity_pending_fulfillment?: number;
  price?: string;
  product_name?: string;
  fulfillment_status?: string;
  customs_value?: string | null;
  barcode?: string;
  warehouse?: string;
}

export interface LineItemEdge extends Edge<LineItem> {}

export interface LineItemConnection extends Connection<LineItem> {}

// Order
export interface Order {
  id: string;
  legacy_id?: number;
  order_number: string;
  shop_name?: string;
  fulfillment_status?: string;
  order_date?: string;
  total_tax?: string;
  subtotal?: string;
  total_discounts?: string;
  total_price?: string;
  custom_invoice_url?: string;
  account_id?: string;
  email?: string;
  profile?: string;
  shipping_address?: Address;
  tags?: string[];
  line_items: LineItemConnection;
}

export interface OrderEdge extends Edge<Order> {}

export interface OrderConnection extends Connection<Order> {}

// Query Response
export interface OrdersQueryResponse {
  orders: {
    request_id: string;
    complexity: number;
    data: OrderConnection;
  };
}

// Mutation Responses
export interface UpdateLineItemsResponse {
  order_update_line_items: {
    request_id: string;
    complexity: number;
    order?: Order;
  };
  errors?: Array<{
    message: string;
    path?: string[];
  }>;
}

export interface AddTagsResponse {
  order_add_tags: {
    request_id: string;
    complexity: number;
    order?: Order;
    errors?: Array<{
      message: string;
    }>;
  };
}

// Filter types for querying orders
export interface OrderFilters {
  customerAccountId: string;
  fulfillmentStatus: string;
  orderDateFrom: string;
  cursor?: string;
  first?: number;
}

// Line item update input
export interface LineItemUpdate {
  id: string;
  customs_value?: string;
  quantity?: number;
  price?: string;
}
