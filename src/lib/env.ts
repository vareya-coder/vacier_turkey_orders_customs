import { z } from 'zod';

const envSchema = z.object({
  // ShipHero API
  SHIPHERO_API_URL: z.string().url().default('https://public-api.shiphero.com/graphql'),
  SHIPHERO_AUTH_URL: z.string().url().default('https://public-api.shiphero.com/auth/refresh'),
  SHIPHERO_ACCESS_TOKEN: z.string().min(1, 'ShipHero access token is required'),
  SHIPHERO_REFRESH_TOKEN: z.string().min(1, 'ShipHero refresh token is required'),

  // Upstash Redis (optional - for token persistence across cron runs)
  // Auto-added by Vercel when connecting Upstash Redis native integration via marketplace
  // Required for production to avoid token refresh on every cron run
  // Note: UPSTASH_REDIS_REST_READ_ONLY_TOKEN is also added by Vercel but not needed
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Business Configuration
  VACIER_CUSTOMER_ACCOUNT_ID: z.string().min(1, 'Vacier customer account ID is required'),
  TARGET_COUNTRY: z.string().length(2).default('TR'),
  MAX_TOTAL_CUSTOMS_VALUE: z.string().default('25.00'),
  PROCESSED_TAG: z.string().default('TR_CUSTOMS_SET'),
  PROCESSING_START_DATE: z.string().datetime({ message: 'Must be a valid ISO datetime' }),

  // Database (Vercel Postgres)
  POSTGRES_URL: z.string().min(1, 'Postgres URL is required'),
  POSTGRES_PRISMA_URL: z.string().optional(),
  POSTGRES_URL_NON_POOLING: z.string().optional(),

  // Axiom Logging
  AXIOM_TOKEN: z.string().min(1, 'Axiom token is required'),
  AXIOM_DATASET: z.string().min(1, 'Axiom dataset is required'),

  // Resend Notifications
  RESEND_API_KEY: z.string().min(1, 'Resend API key is required'),
  NOTIFICATION_EMAIL: z.string().email().default('ae@vareya.nl'),

  // Feature Flags
  FEATURE_CUSTOMS_UPDATE: z.string().transform((val) => val === 'true').default(true),
  FEATURE_ORDER_TAGGING: z.string().transform((val) => val === 'true').default(true),
  FEATURE_VACIER_STATUS: z.string().transform((val) => val === 'true').default(true),
  FEATURE_UNFULFILLED_STATUS: z.string().transform((val) => val === 'true').default(false),
  FEATURE_ERROR_NOTIFICATIONS: z.string().transform((val) => val === 'true').default(true),
  FEATURE_SUCCESS_NOTIFICATIONS: z.string().transform((val) => val === 'true').default(false),
  FEATURE_DRY_RUN: z.string().transform((val) => val === 'true').default(false),

  // Manual backfill mode for processing missed orders
  FEATURE_MANUAL_BACKFILL: z.string().default('false').transform((val) => val === 'true'),
  BACKFILL_START_DATE: z.string().optional(),
  BACKFILL_END_DATE: z.string().optional(),

  // Vercel
  CRON_SECRET: z.string().optional(),
  TZ: z.string().default('Europe/Amsterdam'),

  // Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.issues.map((err) => `  - ${err.path.join('.')}: ${err.message}`).join('\n');
      throw new Error(
        `Environment validation failed:\n${missingVars}\n\nPlease check your .env.local file.`
      );
    }
    throw error;
  }
}

// Singleton instance - validate once on module load
export const env = validateEnv();
