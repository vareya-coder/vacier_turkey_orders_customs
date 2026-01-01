import { env } from './env';

/**
 * Centralized application configuration
 * All configuration values are loaded from environment variables via Zod validation
 */
export const config = {
  /**
   * ShipHero API configuration
   */
  shiphero: {
    apiUrl: env.SHIPHERO_API_URL,
    authUrl: env.SHIPHERO_AUTH_URL,
    customerId: env.VACIER_CUSTOMER_ACCOUNT_ID,
  },

  /**
   * Business logic configuration
   */
  business: {
    targetCountry: env.TARGET_COUNTRY,
    maxCustomsValue: parseFloat(env.MAX_TOTAL_CUSTOMS_VALUE),
    processedTag: env.PROCESSED_TAG,
    startDate: env.PROCESSING_START_DATE,
  },

  /**
   * Feature flags
   * Control which features are enabled/disabled
   */
  features: {
    /**
     * Enable customs value updates
     * If false, the cron will run but not update customs values
     */
    enableCustomsUpdate: env.FEATURE_CUSTOMS_UPDATE,

    /**
     * Enable order tagging
     * If false, orders will be processed but not tagged (not idempotent!)
     */
    enableTagging: env.FEATURE_ORDER_TAGGING,

    /**
     * Enable processing of orders with "Vacier" fulfillment status
     */
    enableVacierStatus: env.FEATURE_VACIER_STATUS,

    /**
     * Enable processing of orders with "Unfulfilled" fulfillment status
     */
    enableUnfulfilledStatus: env.FEATURE_UNFULFILLED_STATUS,

    /**
     * Enable error email notifications
     */
    enableErrorNotifications: env.FEATURE_ERROR_NOTIFICATIONS,

    /**
     * Enable success summary email notifications
     */
    enableSuccessNotifications: env.FEATURE_SUCCESS_NOTIFICATIONS,

    /**
     * Dry-run mode
     * If true, all actions are logged but no mutations are made
     */
    dryRun: env.FEATURE_DRY_RUN,
  },

  /**
   * Notification configuration
   */
  notifications: {
    email: env.NOTIFICATION_EMAIL,
    enableErrors: env.FEATURE_ERROR_NOTIFICATIONS,
    enableSuccess: env.FEATURE_SUCCESS_NOTIFICATIONS,
  },

  /**
   * Database configuration
   */
  database: {
    url: env.POSTGRES_URL,
  },

  /**
   * Logging configuration
   */
  logging: {
    axiomToken: env.AXIOM_TOKEN,
    axiomDataset: env.AXIOM_DATASET,
  },

  /**
   * Cron configuration
   */
  cron: {
    secret: env.CRON_SECRET,
  },

  /**
   * Runtime environment
   */
  env: {
    nodeEnv: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  },
} as const;

/**
 * Get the fulfillment statuses to query based on feature flags
 */
export function getFulfillmentStatuses(): string[] {
  const statuses: string[] = [];

  if (config.features.enableVacierStatus) {
    statuses.push('Vacier');
  }

  if (config.features.enableUnfulfilledStatus) {
    statuses.push('Unfulfilled');
  }

  if (statuses.length === 0) {
    throw new Error('At least one fulfillment status feature flag must be enabled');
  }

  return statuses;
}

/**
 * Validate that critical features are properly configured
 */
export function validateConfiguration(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if at least one fulfillment status is enabled
  if (!config.features.enableVacierStatus && !config.features.enableUnfulfilledStatus) {
    errors.push('At least one fulfillment status (Vacier or Unfulfilled) must be enabled');
  }

  // Warn if tagging is disabled (breaks idempotency)
  if (!config.features.enableTagging && !config.features.dryRun) {
    errors.push('WARNING: Order tagging is disabled. Orders will be processed multiple times!');
  }

  // Warn if in dry-run mode
  if (config.features.dryRun) {
    console.warn('DRY-RUN MODE ENABLED: No mutations will be made');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
