import { describe, it, expect, vi, beforeAll } from 'vitest';
import { distributeCustomsValues, validateDistribution, type LineItemInput } from './distributor';

// Mock the logger to avoid environment variable requirements
vi.mock('../logging/axiom', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Customs Value Distributor', () => {
  describe('Single Item Orders', () => {
    it('should handle single billable item correctly', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'PRODUCT-A', price: '89.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(1);
      expect(result[0].lineItemId).toBe('1');
      expect(result[0].isComplimentary).toBe(false);

      const value = parseFloat(result[0].newCustomsValue);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(8.0); // MAX_ITEM_VALUE
      expect(value).toBeLessThanOrEqual(25.0);
    });

    it('should handle single complimentary item', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'FREE-SAMPLE', price: '0.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(1);
      expect(result[0].lineItemId).toBe('1');
      expect(result[0].newCustomsValue).toBe('0.00');
      expect(result[0].isComplimentary).toBe(true);
    });
  });

  describe('Multiple Billable Items', () => {
    it('should distribute values across multiple items', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'PRODUCT-A', price: '50.00', quantity: 1 },
        { id: '2', sku: 'PRODUCT-B', price: '30.00', quantity: 1 },
        { id: '3', sku: 'PRODUCT-C', price: '20.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(3);

      const total = result.reduce((sum, item) => sum + parseFloat(item.newCustomsValue), 0);
      expect(total).toBeLessThanOrEqual(25.01); // Allow small rounding
      expect(total).toBeGreaterThan(0);

      // All should be marked as non-complimentary
      result.forEach((item) => {
        expect(item.isComplimentary).toBe(false);
        const value = parseFloat(item.newCustomsValue);
        expect(value).toBeGreaterThanOrEqual(0.5); // MIN_ITEM_VALUE
        expect(value).toBeLessThanOrEqual(8.0); // MAX_ITEM_VALUE
      });
    });

    it('should handle 10 items without exceeding limit', () => {
      const lineItems: LineItemInput[] = Array.from({ length: 10 }, (_, i) => ({
        id: `${i + 1}`,
        sku: `PRODUCT-${i + 1}`,
        price: '25.00',
        quantity: 1,
      }));

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(10);

      const total = result.reduce((sum, item) => sum + parseFloat(item.newCustomsValue), 0);
      expect(total).toBeLessThanOrEqual(25.01);

      result.forEach((item) => {
        const value = parseFloat(item.newCustomsValue);
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThanOrEqual(8.0);
      });
    });
  });

  describe('Mixed Billable and Complimentary Items', () => {
    it('should give zero to complimentary items only', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'PRODUCT-A', price: '50.00', quantity: 1 },
        { id: '2', sku: 'FREE-GIFT', price: '0.00', quantity: 1 },
        { id: '3', sku: 'PRODUCT-B', price: '30.00', quantity: 1 },
        { id: '4', sku: 'SAMPLE', price: '0.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(4);

      const complimentaryItems = result.filter((item) => item.isComplimentary);
      const billableItems = result.filter((item) => !item.isComplimentary);

      expect(complimentaryItems).toHaveLength(2);
      expect(billableItems).toHaveLength(2);

      complimentaryItems.forEach((item) => {
        expect(item.newCustomsValue).toBe('0.00');
        expect(['2', '4']).toContain(item.lineItemId);
      });

      const billableTotal = billableItems.reduce(
        (sum, item) => sum + parseFloat(item.newCustomsValue),
        0
      );
      expect(billableTotal).toBeLessThanOrEqual(25.01);
      expect(billableTotal).toBeGreaterThan(0);
    });
  });

  describe('All Complimentary Items', () => {
    it('should return all zeros for all complimentary items', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'FREE-A', price: '0.00', quantity: 1 },
        { id: '2', sku: 'FREE-B', price: '0.00', quantity: 1 },
        { id: '3', sku: 'FREE-C', price: '0.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(3);

      result.forEach((item) => {
        expect(item.newCustomsValue).toBe('0.00');
        expect(item.isComplimentary).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty array', () => {
      const result = distributeCustomsValues([], 25.0);
      expect(result).toHaveLength(0);
    });

    it('should handle very small maxTotal', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'PRODUCT-A', price: '50.00', quantity: 1 },
        { id: '2', sku: 'PRODUCT-B', price: '30.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 2.0);

      const total = result.reduce((sum, item) => sum + parseFloat(item.newCustomsValue), 0);
      expect(total).toBeLessThanOrEqual(2.01);

      // Should still respect minimum per item
      result.forEach((item) => {
        const value = parseFloat(item.newCustomsValue);
        expect(value).toBeGreaterThanOrEqual(0.5);
      });
    });

    it('should handle large maxTotal', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'PRODUCT-A', price: '100.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 100.0);

      // Should be capped at MAX_ITEM_VALUE (8.0)
      const value = parseFloat(result[0].newCustomsValue);
      expect(value).toBeLessThanOrEqual(8.0);
    });

    it('should handle many items (stress test)', () => {
      const lineItems: LineItemInput[] = Array.from({ length: 50 }, (_, i) => ({
        id: `${i + 1}`,
        sku: `PRODUCT-${i + 1}`,
        price: '10.00',
        quantity: 1,
      }));

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(50);

      const total = result.reduce((sum, item) => sum + parseFloat(item.newCustomsValue), 0);
      expect(total).toBeLessThanOrEqual(25.01);

      result.forEach((item) => {
        const value = parseFloat(item.newCustomsValue);
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThanOrEqual(8.0);
      });
    });
  });

  describe('Distribution Validation', () => {
    it('should validate correct distribution', () => {
      const distribution = [
        { lineItemId: '1', newCustomsValue: '7.50', isComplimentary: false },
        { lineItemId: '2', newCustomsValue: '8.00', isComplimentary: false },
        { lineItemId: '3', newCustomsValue: '5.00', isComplimentary: false },
        { lineItemId: '4', newCustomsValue: '0.00', isComplimentary: true },
      ];

      const validation = validateDistribution(distribution, 25.0);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect total exceeding maximum', () => {
      const distribution = [
        { lineItemId: '1', newCustomsValue: '15.00', isComplimentary: false },
        { lineItemId: '2', newCustomsValue: '15.00', isComplimentary: false },
      ];

      const validation = validateDistribution(distribution, 25.0);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('exceeds maximum'))).toBe(true);
    });

    it('should detect complimentary items with non-zero value', () => {
      const distribution = [
        { lineItemId: '1', newCustomsValue: '10.00', isComplimentary: false },
        { lineItemId: '2', newCustomsValue: '5.00', isComplimentary: true }, // Wrong!
      ];

      const validation = validateDistribution(distribution, 25.0);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Complimentary'))).toBe(true);
    });

    it('should detect values below minimum', () => {
      const distribution = [
        { lineItemId: '1', newCustomsValue: '0.25', isComplimentary: false }, // Too low
        { lineItemId: '2', newCustomsValue: '10.00', isComplimentary: false },
      ];

      const validation = validateDistribution(distribution, 25.0);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('below minimum'))).toBe(true);
    });

    it('should detect values above maximum', () => {
      const distribution = [
        { lineItemId: '1', newCustomsValue: '10.00', isComplimentary: false },
        { lineItemId: '2', newCustomsValue: '9.00', isComplimentary: false }, // Too high
      ];

      const validation = validateDistribution(distribution, 25.0);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('exceeds maximum'))).toBe(true);
    });
  });

  describe('Randomness and Natural Distribution', () => {
    it('should produce different distributions on multiple runs', () => {
      const lineItems: LineItemInput[] = [
        { id: '1', sku: 'PRODUCT-A', price: '50.00', quantity: 1 },
        { id: '2', sku: 'PRODUCT-B', price: '30.00', quantity: 1 },
        { id: '3', sku: 'PRODUCT-C', price: '20.00', quantity: 1 },
      ];

      const results = Array.from({ length: 10 }, () => distributeCustomsValues(lineItems, 25.0));

      // Check that we get some variation
      const firstItemValues = results.map((r) => parseFloat(r[0].newCustomsValue));
      const uniqueValues = new Set(firstItemValues);

      // Should have some variation (not all identical)
      expect(uniqueValues.size).toBeGreaterThan(1);
    });

    it('should not produce uniform distributions', () => {
      const lineItems: LineItemInput[] = Array.from({ length: 5 }, (_, i) => ({
        id: `${i + 1}`,
        sku: `PRODUCT-${i + 1}`,
        price: '25.00',
        quantity: 1,
      }));

      const result = distributeCustomsValues(lineItems, 25.0);

      const values = result.map((item) => parseFloat(item.newCustomsValue));

      // Check that values are not all the same (within tolerance)
      const allSame = values.every((v) => Math.abs(v - values[0]) < 0.1);
      expect(allSame).toBe(false);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle typical 3-item order', () => {
      const lineItems: LineItemInput[] = [
        { id: 'li_1', sku: 'SHIRT-001', price: '45.00', quantity: 1 },
        { id: 'li_2', sku: 'PANTS-002', price: '65.00', quantity: 1 },
        { id: 'li_3', sku: 'SOCKS-003', price: '12.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(3);

      const total = result.reduce((sum, item) => sum + parseFloat(item.newCustomsValue), 0);
      expect(total).toBeLessThanOrEqual(25.01);
      expect(total).toBeGreaterThan(20); // Should use most of the allowance

      const validation = validateDistribution(result, 25.0);
      expect(validation.valid).toBe(true);
    });

    it('should handle order with free gift', () => {
      const lineItems: LineItemInput[] = [
        { id: 'li_1', sku: 'PRODUCT-A', price: '89.00', quantity: 1 },
        { id: 'li_2', sku: 'FREE-GIFT', price: '0.00', quantity: 1 },
      ];

      const result = distributeCustomsValues(lineItems, 25.0);

      expect(result).toHaveLength(2);

      const freeGift = result.find((item) => item.lineItemId === 'li_2');
      expect(freeGift?.newCustomsValue).toBe('0.00');
      expect(freeGift?.isComplimentary).toBe(true);

      const paidItem = result.find((item) => item.lineItemId === 'li_1');
      const value = parseFloat(paidItem?.newCustomsValue || '0');
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(8.0);
    });
  });
});
