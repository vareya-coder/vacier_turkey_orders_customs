/**
 * ShipHero GraphQL Queries
 */

/**
 * Query to fetch Vacier orders with specific filters
 * Returns orders with line items, shipping address, and tags
 */
export const GET_VACIER_ORDERS = `
  query GetVacierOrders(
    $cursor: String
    $status: String!
    $startDate: ISODateTime!
    $endDate: ISODateTime
    $customerId: String!
    $first: Int
  ) {
    orders(
      customer_account_id: $customerId
      fulfillment_status: $status
      order_date_from: $startDate
      order_date_to: $endDate
    ) {
      request_id
      complexity
      data(after: $cursor, first: $first) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        edges {
          cursor
          node {
            id
            legacy_id
            order_number
            fulfillment_status
            order_date
            total_price
            subtotal
            total_discounts
            email
            tags
            shipping_address {
              first_name
              last_name
              company
              address1
              address2
              city
              state
              state_code
              zip
              country
              country_code
              phone
              email
            }
            line_items(first: 50) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  sku
                  product_name
                  quantity
                  price
                  customs_value
                  fulfillment_status
                  barcode
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Query to fetch a single order by ID
 */
export const GET_ORDER_BY_ID = `
  query GetOrderById($orderId: String!) {
    order(id: $orderId) {
      request_id
      complexity
      data {
        id
        order_number
        fulfillment_status
        order_date
        tags
        shipping_address {
          country
          country_code
        }
        line_items(first: 50) {
          edges {
            node {
              id
              sku
              product_name
              quantity
              price
              customs_value
            }
          }
        }
      }
    }
  }
`;
