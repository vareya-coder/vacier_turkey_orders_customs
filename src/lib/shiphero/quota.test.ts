import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuotaManager, getQuotaManager, resetQuotaManager } from './quota';

// Mock logger
vi.mock('../logging/axiom', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('QuotaManager', () => {
  let quotaManager: QuotaManager;

  beforeEach(() => {
    quotaManager = new QuotaManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Credit-based Throttling', () => {
    it('should initialize with max credits', () => {
      const status = quotaManager.getStatus();
      expect(status.remaining).toBe(4004);
      expect(status.maxCredits).toBe(4004);
    });

    it('should allow requests when credits are available', () => {
      const result = quotaManager.canProceed(100);
      expect(result.ok).toBe(true);
    });

    it('should block requests when credits are insufficient', () => {
      quotaManager.updateFromResponse(4000); // Use almost all credits
      const result = quotaManager.canProceed(100);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('insufficient_credits');
    });

    it('should replenish credits over time', () => {
      quotaManager.updateFromResponse(1000);

      // Mock time passing (2 seconds = 120 credits)
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      const status = quotaManager.getStatus();
      expect(status.remaining).toBeGreaterThan(3000);
    });

    it('should not exceed max credits when replenishing', () => {
      quotaManager.updateFromResponse(100);

      // Mock time passing (100 seconds = 6000 credits, but capped at 4004)
      vi.useFakeTimers();
      vi.advanceTimersByTime(100000);

      const status = quotaManager.getStatus();
      expect(status.remaining).toBe(4004);
    });

    it('should use server-provided remaining credits when available', () => {
      quotaManager.updateFromResponse(100, 3500);

      const status = quotaManager.getStatus();
      expect(status.remaining).toBe(3500);
    });
  });

  describe('Request Count Tracking', () => {
    it('should track individual requests', () => {
      quotaManager.trackRequest();
      quotaManager.trackRequest();
      quotaManager.trackRequest();

      const status = quotaManager.getStatus();
      expect(status.requestsInWindow).toBe(3);
    });

    it('should allow requests under the limit', () => {
      for (let i = 0; i < 100; i++) {
        quotaManager.trackRequest();
      }

      const result = quotaManager.canMakeRequest();
      expect(result.ok).toBe(true);
    });

    it('should block requests at the limit', () => {
      // Track 6900 requests (at buffer limit)
      for (let i = 0; i < 6900; i++) {
        quotaManager.trackRequest();
      }

      const result = quotaManager.canMakeRequest();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('request_limit');
    });

    it('should remove old requests from tracking window', () => {
      vi.useFakeTimers();

      // Track 100 requests
      for (let i = 0; i < 100; i++) {
        quotaManager.trackRequest();
      }

      expect(quotaManager.getStatus().requestsInWindow).toBe(100);

      // Advance time by 6 minutes (past the 5-minute window)
      vi.advanceTimersByTime(6 * 60 * 1000);

      const status = quotaManager.getStatus();
      expect(status.requestsInWindow).toBe(0);
    });

    it('should calculate correct wait time when limit reached', () => {
      vi.useFakeTimers();

      // Track 6900 requests at the start
      for (let i = 0; i < 6900; i++) {
        quotaManager.trackRequest();
      }

      const result = quotaManager.canMakeRequest();
      expect(result.ok).toBe(false);
      expect(result.waitMs).toBeGreaterThan(0);

      // Wait time should be approximately 5 minutes (time until oldest expires)
      expect(result.waitMs).toBeLessThanOrEqual(5 * 60 * 1000);
    });

    it('should properly clean up expired requests', () => {
      vi.useFakeTimers();
      const now = Date.now();

      // Add 50 requests at t=0
      for (let i = 0; i < 50; i++) {
        quotaManager.trackRequest();
      }

      // Advance 3 minutes
      vi.advanceTimersByTime(3 * 60 * 1000);

      // Add 50 more requests at t=3min
      for (let i = 0; i < 50; i++) {
        quotaManager.trackRequest();
      }

      expect(quotaManager.getStatus().requestsInWindow).toBe(100);

      // Advance 2.5 more minutes (total 5.5 minutes)
      vi.advanceTimersByTime(2.5 * 60 * 1000);

      // First 50 should be expired, second 50 should remain
      const status = quotaManager.getStatus();
      expect(status.requestsInWindow).toBe(50);
    });
  });

  describe('Combined Limits', () => {
    it('should check request limit before credit limit', () => {
      // Exhaust request limit
      for (let i = 0; i < 6900; i++) {
        quotaManager.trackRequest();
      }

      // Even with credits available, should fail on request limit
      const result = quotaManager.canProceed(100);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('request_limit');
    });

    it('should check credit limit when request limit is ok', () => {
      quotaManager.updateFromResponse(4000); // Exhaust credits

      const result = quotaManager.canProceed(100);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('insufficient_credits');
    });

    it('should pass both checks when both limits are ok', () => {
      quotaManager.trackRequest();
      quotaManager.trackRequest();

      const result = quotaManager.canProceed(100);
      expect(result.ok).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('Status Reporting', () => {
    it('should report comprehensive quota status', () => {
      quotaManager.trackRequest();
      quotaManager.trackRequest();
      quotaManager.updateFromResponse(500);

      const status = quotaManager.getStatus();

      expect(status).toHaveProperty('remaining');
      expect(status).toHaveProperty('totalUsed');
      expect(status).toHaveProperty('replenishRate');
      expect(status).toHaveProperty('maxCredits');
      expect(status).toHaveProperty('requestsInWindow');
      expect(status).toHaveProperty('maxRequestsPerWindow');
      expect(status).toHaveProperty('requestLimitRemaining');

      expect(status.requestsInWindow).toBe(2);
      expect(status.totalUsed).toBe(500);
      expect(status.maxRequestsPerWindow).toBe(7000);
      expect(status.requestLimitRemaining).toBe(6998);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all quota tracking', () => {
      quotaManager.trackRequest();
      quotaManager.trackRequest();
      quotaManager.updateFromResponse(1000);

      quotaManager.reset();

      const status = quotaManager.getStatus();
      expect(status.requestsInWindow).toBe(0);
      expect(status.remaining).toBe(4004);
      expect(status.totalUsed).toBe(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance1 = getQuotaManager();
      const instance2 = getQuotaManager();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton quota when requested', () => {
      const manager = getQuotaManager();
      manager.trackRequest();
      manager.updateFromResponse(100);

      resetQuotaManager();

      const status = manager.getStatus();
      expect(status.requestsInWindow).toBe(0);
      expect(status.remaining).toBe(4004);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid consecutive requests', () => {
      for (let i = 0; i < 1000; i++) {
        quotaManager.trackRequest();
      }

      const status = quotaManager.getStatus();
      expect(status.requestsInWindow).toBe(1000);
    });

    it('should handle zero credit updates', () => {
      quotaManager.updateFromResponse(0);

      const status = quotaManager.getStatus();
      expect(status.totalUsed).toBe(0);
      expect(status.remaining).toBe(4004);
    });

    it('should handle maximum credit usage', () => {
      quotaManager.updateFromResponse(4004);

      const status = quotaManager.getStatus();
      expect(status.remaining).toBe(0);
      expect(status.totalUsed).toBe(4004);
    });
  });

  describe('Wait Time Calculations', () => {
    it('should calculate correct wait time for credit replenishment', () => {
      quotaManager.updateFromResponse(3900); // Leave 104 credits

      // Request 200 credits (need 200 + 100 buffer = 300)
      // Need 196 more credits = ~3.27 seconds at 60/sec = Math.ceil(3.27) = 4 sec
      const result = quotaManager.canProceed(200);

      expect(result.ok).toBe(false);
      expect(result.waitMs).toBeGreaterThan(3000);
      expect(result.waitMs).toBeLessThanOrEqual(4000);
    });

    it('should provide wait time for request limit', () => {
      vi.useFakeTimers();

      // Fill up to limit
      for (let i = 0; i < 6900; i++) {
        quotaManager.trackRequest();
      }

      const result = quotaManager.canMakeRequest();

      expect(result.ok).toBe(false);
      expect(result.waitMs).toBeDefined();
      expect(result.waitMs).toBeGreaterThan(0);
    });
  });
});
