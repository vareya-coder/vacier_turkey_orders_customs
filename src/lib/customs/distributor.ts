import { createLogger } from '../logging/axiom';

const logger = createLogger({ service: 'customs-distributor' });

export interface LineItemInput {
  id: string;
  sku: string;
  price: string; // "89.00"
  quantity: number;
}

export interface CustomsDistribution {
  lineItemId: string;
  newCustomsValue: string; // "7.50"
  isComplimentary: boolean;
}

// Constants for distribution algorithm
const MIN_ITEM_VALUE = 0.5; // Minimum customs value per billable item (EUR)
const MAX_ITEM_VALUE = 8.0; // Maximum customs value per item (EUR)
const DEFAULT_MAX_TOTAL = 25.0; // Maximum total customs value (EUR)

/**
 * Distribute customs values across line items
 *
 * Algorithm:
 * 1. Filter out zero-price items (complimentary)
 * 2. Calculate initial random distribution
 * 3. Scale values to fit within maxTotal
 * 4. Ensure min/max constraints per item
 * 5. Return formatted values
 */
export function distributeCustomsValues(
  lineItems: LineItemInput[],
  maxTotal: number = DEFAULT_MAX_TOTAL
): CustomsDistribution[] {
  if (lineItems.length === 0) {
    logger.warn('customs_calculated', 'No line items to distribute', {});
    return [];
  }

  // Separate billable and complimentary items
  const billableItems = lineItems.filter((item) => {
    const price = parseFloat(item.price || '0');
    return price > 0;
  });

  const complimentaryItems = lineItems.filter((item) => {
    const price = parseFloat(item.price || '0');
    return price <= 0;
  });

  logger.debug('customs_calculated', 'Distributing customs values', {
    totalItems: lineItems.length,
    billableItems: billableItems.length,
    complimentaryItems: complimentaryItems.length,
    maxTotal,
  });

  // If no billable items, all items are complimentary
  if (billableItems.length === 0) {
    logger.info('customs_calculated', 'All items are complimentary', {
      itemCount: lineItems.length,
    });

    return lineItems.map((item) => ({
      lineItemId: item.id,
      newCustomsValue: '0.00',
      isComplimentary: true,
    }));
  }

  // Generate distribution for billable items
  const billableDistribution = distributeBillableItems(billableItems, maxTotal);

  // Combine with complimentary items
  const complimentaryDistribution: CustomsDistribution[] = complimentaryItems.map((item) => ({
    lineItemId: item.id,
    newCustomsValue: '0.00',
    isComplimentary: true,
  }));

  const allDistribution = [...billableDistribution, ...complimentaryDistribution];

  // Calculate total for verification
  const total = billableDistribution.reduce(
    (sum, item) => sum + parseFloat(item.newCustomsValue),
    0
  );

  logger.info('customs_calculated', 'Customs values distributed', {
    totalItems: allDistribution.length,
    billableItems: billableDistribution.length,
    complimentaryItems: complimentaryDistribution.length,
    totalCustomsValue: total.toFixed(2),
    maxTotal,
    withinLimit: total <= maxTotal,
  });

  if (total > maxTotal) {
    logger.error('batch_error', 'Total customs value exceeds maximum!', {
      total: total.toFixed(2),
      maxTotal,
      difference: (total - maxTotal).toFixed(2),
    });
  }

  return allDistribution;
}

/**
 * Distribute customs values for billable items only
 */
function distributeBillableItems(
  billableItems: LineItemInput[],
  maxTotal: number
): CustomsDistribution[] {
  const itemCount = billableItems.length;

  // Edge case: single item
  if (itemCount === 1) {
    const value = Math.min(maxTotal, MAX_ITEM_VALUE);
    return [
      {
        lineItemId: billableItems[0].id,
        newCustomsValue: value.toFixed(2),
        isComplimentary: false,
      },
    ];
  }

  // Generate random weights for natural distribution
  const weights = billableItems.map(() => generateRandomWeight());
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Calculate initial distribution based on weights
  let distributions = weights.map((weight, index) => {
    const proportion = weight / totalWeight;
    let value = proportion * maxTotal;

    // Enforce min/max constraints
    value = Math.max(MIN_ITEM_VALUE, Math.min(MAX_ITEM_VALUE, value));

    return {
      lineItemId: billableItems[index].id,
      value,
    };
  });

  // Calculate current total
  let currentTotal = distributions.reduce((sum, d) => sum + d.value, 0);

  // If total exceeds maxTotal, scale down proportionally
  if (currentTotal > maxTotal) {
    const scaleFactor = maxTotal / currentTotal;
    distributions = distributions.map((d) => ({
      ...d,
      value: Math.max(MIN_ITEM_VALUE, d.value * scaleFactor),
    }));

    // Recalculate total after scaling
    currentTotal = distributions.reduce((sum, d) => sum + d.value, 0);
  }

  // Recalculate currentTotal after potential scaling
  currentTotal = distributions.reduce((sum, d) => sum + d.value, 0);

  // If we still have room and some items are not at maximum, distribute remaining
  if (currentTotal < maxTotal - 0.01) {
    // Small threshold for rounding
    const remaining = maxTotal - currentTotal;
    const itemsNotAtMax = distributions.filter((d) => d.value < MAX_ITEM_VALUE - 0.01);

    if (itemsNotAtMax.length > 0) {
      const extraPerItem = remaining / itemsNotAtMax.length;

      distributions = distributions.map((d) => {
        if (d.value < MAX_ITEM_VALUE - 0.01) {
          const newValue = Math.min(MAX_ITEM_VALUE, d.value + extraPerItem);
          return { ...d, value: newValue };
        }
        return d;
      });
    }
  }

  // Final adjustment to ensure we don't exceed maxTotal
  currentTotal = distributions.reduce((sum, d) => sum + d.value, 0);
  if (currentTotal > maxTotal) {
    const excess = currentTotal - maxTotal;

    // Try to remove excess from the largest items first
    const sortedByValue = [...distributions].sort((a, b) => b.value - a.value);

    let remainingExcess = excess;
    for (const item of sortedByValue) {
      if (remainingExcess <= 0) break;

      const canReduce = item.value - MIN_ITEM_VALUE;
      const reduction = Math.min(remainingExcess, canReduce);

      item.value = Math.max(MIN_ITEM_VALUE, item.value - reduction);
      remainingExcess -= reduction;
    }
  }

  // Format as CustomsDistribution
  return distributions.map((d) => ({
    lineItemId: d.lineItemId,
    newCustomsValue: d.value.toFixed(2),
    isComplimentary: false,
  }));
}

/**
 * Generate a random weight for natural distribution
 * Uses a skewed distribution to create variety
 */
function generateRandomWeight(): number {
  // Generate random number between 0.5 and 1.5 with slight skew
  const base = Math.random();
  const skew = Math.random() * 0.5 + 0.75; // 0.75 to 1.25
  return base * skew;
}

/**
 * Validate that a distribution meets all constraints
 */
export function validateDistribution(
  distribution: CustomsDistribution[],
  maxTotal: number = DEFAULT_MAX_TOTAL
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check total doesn't exceed max
  const total = distribution
    .filter((d) => !d.isComplimentary)
    .reduce((sum, d) => sum + parseFloat(d.newCustomsValue), 0);

  if (total > maxTotal + 0.01) {
    // Allow 1 cent rounding error
    errors.push(`Total customs value ${total.toFixed(2)} exceeds maximum ${maxTotal.toFixed(2)}`);
  }

  // Check individual items
  distribution.forEach((d) => {
    const value = parseFloat(d.newCustomsValue);

    if (d.isComplimentary && value !== 0) {
      errors.push(`Complimentary item ${d.lineItemId} has non-zero value ${value}`);
    }

    if (!d.isComplimentary) {
      if (value < MIN_ITEM_VALUE - 0.01) {
        errors.push(`Item ${d.lineItemId} value ${value} below minimum ${MIN_ITEM_VALUE}`);
      }

      if (value > MAX_ITEM_VALUE + 0.01) {
        errors.push(`Item ${d.lineItemId} value ${value} exceeds maximum ${MAX_ITEM_VALUE}`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
