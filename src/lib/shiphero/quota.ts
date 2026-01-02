import { createLogger } from '../logging/axiom';

const logger = createLogger({ service: 'quota-manager' });

// ShipHero API quota constants
const MAX_CREDITS = 4004;
const REPLENISH_RATE = 60; // credits per second
const MIN_CREDITS_BUFFER = 100; // Keep a buffer to avoid hitting limits

// Request count limit constants (ShipHero hard limit)
const MAX_REQUESTS_PER_WINDOW = 7000; // Max requests per 5-minute window
const REQUEST_WINDOW_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const MIN_REQUESTS_BUFFER = 100; // Safety buffer for request limit

/**
 * Quota manager for ShipHero API
 * Tracks credit usage and provides throttling logic
 */
export class QuotaManager {
  private remainingCredits: number = MAX_CREDITS;
  private lastUpdateTime: number = Date.now();
  private totalCreditsUsed: number = 0;
  private requestTimestamps: number[] = []; // Track request times in rolling window

  constructor() {
    logger.info('batch_started', 'Quota manager initialized', {
      maxCredits: MAX_CREDITS,
      replenishRate: REPLENISH_RATE,
      minBuffer: MIN_CREDITS_BUFFER,
    });
  }

  /**
   * Track a new request and clean up old timestamps
   * Called before making any API request
   */
  trackRequest(): void {
    const now = Date.now();

    // Remove timestamps older than 5 minutes
    const windowStart = now - REQUEST_WINDOW_MS;
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => timestamp > windowStart
    );

    // Add current request
    this.requestTimestamps.push(now);

    logger.debug('quota_warning', 'Request tracked', {
      requestsInWindow: this.requestTimestamps.length,
      windowStart: new Date(windowStart).toISOString(),
      remaining: MAX_REQUESTS_PER_WINDOW - this.requestTimestamps.length,
    });
  }

  /**
   * Get number of requests in the current 5-minute window
   */
  private getRequestsInWindow(): number {
    const now = Date.now();
    const windowStart = now - REQUEST_WINDOW_MS;

    // Filter to only include requests within window
    return this.requestTimestamps.filter(
      (timestamp) => timestamp > windowStart
    ).length;
  }

  /**
   * Check if we can make another request without hitting request limit
   * Returns { ok: true } if we can proceed
   * Returns { ok: false, waitMs: number } if we need to wait
   */
  canMakeRequest(): { ok: boolean; waitMs?: number; reason?: string } {
    const requestsInWindow = this.getRequestsInWindow();
    const availableRequests = MAX_REQUESTS_PER_WINDOW - requestsInWindow;

    // Check if we have buffer space
    if (availableRequests > MIN_REQUESTS_BUFFER) {
      return { ok: true };
    }

    // If at or over limit, calculate when oldest request expires
    if (this.requestTimestamps.length > 0) {
      const oldestRequest = this.requestTimestamps[0];
      const waitMs = Math.max(0, (oldestRequest + REQUEST_WINDOW_MS) - Date.now());

      logger.warn('quota_warning', 'Request limit reached, need to wait', {
        requestsInWindow,
        maxRequests: MAX_REQUESTS_PER_WINDOW,
        waitMs,
        oldestRequestAge: Date.now() - oldestRequest,
      });

      return {
        ok: false,
        waitMs,
        reason: 'request_limit',
      };
    }

    return { ok: true };
  }

  /**
   * Update credits from API response
   */
  updateFromResponse(complexity: number, remaining?: number): void {
    const now = Date.now();
    const timeSinceLastUpdate = (now - this.lastUpdateTime) / 1000; // seconds

    // If we have actual remaining credits from API, use it
    if (remaining !== undefined) {
      this.remainingCredits = remaining;
      logger.debug('quota_warning', 'Credits updated from API response', {
        complexity,
        remaining,
        totalUsed: this.totalCreditsUsed,
      });
    } else {
      // Otherwise estimate based on complexity and replenishment
      const replenished = Math.floor(timeSinceLastUpdate * REPLENISH_RATE);
      this.remainingCredits = Math.min(
        MAX_CREDITS,
        this.remainingCredits - complexity + replenished
      );

      logger.debug('quota_warning', 'Credits updated (estimated)', {
        complexity,
        replenished,
        remaining: this.remainingCredits,
        totalUsed: this.totalCreditsUsed,
      });
    }

    this.totalCreditsUsed += complexity;
    this.lastUpdateTime = now;

    // Warn if credits are getting low
    if (this.remainingCredits < MIN_CREDITS_BUFFER * 2) {
      logger.warn('quota_warning', 'Credits running low', {
        remaining: this.remainingCredits,
        threshold: MIN_CREDITS_BUFFER * 2,
        totalUsed: this.totalCreditsUsed,
      });
    }
  }

  /**
   * Check if we have enough credits to proceed
   * Returns { ok: true } if we can proceed
   * Returns { ok: false, waitMs: number } if we need to wait
   */
  canProceed(estimatedCost: number): { ok: boolean; waitMs?: number; reason?: string } {
    // 1. Check request count limit first (fast check)
    const requestCheck = this.canMakeRequest();
    if (!requestCheck.ok) {
      return requestCheck;
    }

    // 2. Check credit limit (existing logic)
    // Replenish credits based on time passed
    const now = Date.now();
    const timeSinceLastUpdate = (now - this.lastUpdateTime) / 1000;
    const replenished = Math.floor(timeSinceLastUpdate * REPLENISH_RATE);
    const currentCredits = Math.min(
      MAX_CREDITS,
      this.remainingCredits + replenished
    );

    // Check if we have enough credits (with buffer)
    const requiredCredits = estimatedCost + MIN_CREDITS_BUFFER;

    if (currentCredits >= requiredCredits) {
      return { ok: true };
    }

    // Calculate wait time needed
    const creditsNeeded = requiredCredits - currentCredits;
    const waitSeconds = Math.ceil(creditsNeeded / REPLENISH_RATE);
    const waitMs = waitSeconds * 1000;

    logger.warn('quota_warning', 'Insufficient credits, need to wait', {
      currentCredits,
      requiredCredits,
      creditsNeeded,
      waitSeconds,
      estimatedCost,
    });

    return {
      ok: false,
      waitMs,
      reason: 'insufficient_credits',
    };
  }

  /**
   * Wait until we have enough credits
   */
  async waitForCredits(estimatedCost: number, maxWaitMs: number = 60000): Promise<boolean> {
    const check = this.canProceed(estimatedCost);

    if (check.ok) {
      return true;
    }

    if (!check.waitMs || check.waitMs > maxWaitMs) {
      logger.warn('quota_warning', 'Required wait time exceeds maximum', {
        requiredWaitMs: check.waitMs,
        maxWaitMs,
      });
      return false;
    }

    logger.info('quota_warning', `Waiting ${check.waitMs}ms for credits to replenish`, {
      waitMs: check.waitMs,
      estimatedCost,
    });

    await this._sleep(check.waitMs);

    // Update our estimate after waiting
    this.updateFromResponse(0); // Update with zero cost to refresh estimate

    return true;
  }

  /**
   * Get current quota status
   */
  getStatus(): {
    remaining: number;
    totalUsed: number;
    replenishRate: number;
    maxCredits: number;
    requestsInWindow: number;
    maxRequestsPerWindow: number;
    requestLimitRemaining: number;
  } {
    // Replenish based on time passed
    const now = Date.now();
    const timeSinceLastUpdate = (now - this.lastUpdateTime) / 1000;
    const replenished = Math.floor(timeSinceLastUpdate * REPLENISH_RATE);
    const remaining = Math.min(MAX_CREDITS, this.remainingCredits + replenished);

    const requestsInWindow = this.getRequestsInWindow();

    return {
      remaining,
      totalUsed: this.totalCreditsUsed,
      replenishRate: REPLENISH_RATE,
      maxCredits: MAX_CREDITS,
      requestsInWindow,
      maxRequestsPerWindow: MAX_REQUESTS_PER_WINDOW,
      requestLimitRemaining: MAX_REQUESTS_PER_WINDOW - requestsInWindow,
    };
  }

  /**
   * Get total credits used in this session
   */
  getTotalCreditsUsed(): number {
    return this.totalCreditsUsed;
  }

  /**
   * Reset quota tracking (useful for testing or new batch runs)
   */
  reset(): void {
    this.remainingCredits = MAX_CREDITS;
    this.lastUpdateTime = Date.now();
    this.totalCreditsUsed = 0;
    this.requestTimestamps = [];

    logger.info('batch_started', 'Quota manager reset', {
      maxCredits: MAX_CREDITS,
      maxRequestsPerWindow: MAX_REQUESTS_PER_WINDOW,
    });
  }

  /**
   * Sleep helper
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let quotaManagerInstance: QuotaManager | null = null;

/**
 * Get the singleton quota manager instance
 */
export function getQuotaManager(): QuotaManager {
  if (!quotaManagerInstance) {
    quotaManagerInstance = new QuotaManager();
  }
  return quotaManagerInstance;
}

/**
 * Reset the quota manager (useful for new batch runs)
 */
export function resetQuotaManager(): void {
  if (quotaManagerInstance) {
    quotaManagerInstance.reset();
  }
}
