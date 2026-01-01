import { createLogger } from '../logging/axiom';

const logger = createLogger({ service: 'quota-manager' });

// ShipHero API quota constants
const MAX_CREDITS = 4004;
const REPLENISH_RATE = 60; // credits per second
const MIN_CREDITS_BUFFER = 100; // Keep a buffer to avoid hitting limits

/**
 * Quota manager for ShipHero API
 * Tracks credit usage and provides throttling logic
 */
export class QuotaManager {
  private remainingCredits: number = MAX_CREDITS;
  private lastUpdateTime: number = Date.now();
  private totalCreditsUsed: number = 0;

  constructor() {
    logger.info('batch_started', 'Quota manager initialized', {
      maxCredits: MAX_CREDITS,
      replenishRate: REPLENISH_RATE,
      minBuffer: MIN_CREDITS_BUFFER,
    });
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
  canProceed(estimatedCost: number): { ok: boolean; waitMs?: number } {
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
  } {
    // Replenish based on time passed
    const now = Date.now();
    const timeSinceLastUpdate = (now - this.lastUpdateTime) / 1000;
    const replenished = Math.floor(timeSinceLastUpdate * REPLENISH_RATE);
    const remaining = Math.min(MAX_CREDITS, this.remainingCredits + replenished);

    return {
      remaining,
      totalUsed: this.totalCreditsUsed,
      replenishRate: REPLENISH_RATE,
      maxCredits: MAX_CREDITS,
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

    logger.info('batch_started', 'Quota manager reset', {
      maxCredits: MAX_CREDITS,
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
