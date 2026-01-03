import { NextResponse } from 'next/server';
import { processBatch } from '@/lib/processor/batch';
import { config, validateConfiguration } from '@/lib/config';
import { createLogger } from '@/lib/logging/axiom';

const logger = createLogger({ service: 'cron-handler' });

// Vercel serverless function configuration
// Set to 5 minutes for Pro plan (max 300s)
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Cron handler for customs value updates
 * Called by Vercel Cron every 10 minutes
 *
 * GET /api/cron/customs-update
 */
export async function GET(request: Request) {
  const startTime = Date.now();

  logger.info('batch_started', 'Cron handler invoked', {
    timestamp: new Date().toISOString(),
    url: request.url,
  });

  try {
    // Verify cron secret (Vercel automatically includes this header)
    const authHeader = request.headers.get('authorization');

    if (config.cron.secret) {
      const expectedAuth = `Bearer ${config.cron.secret}`;

      if (authHeader !== expectedAuth) {
        logger.error('batch_error', 'Unauthorized cron request', {
          hasAuth: !!authHeader,
        });

        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    // Validate configuration
    const configValidation = validateConfiguration();
    if (!configValidation.valid) {
      logger.error('batch_error', 'Invalid configuration', {
        errors: configValidation.errors,
      });

      return NextResponse.json(
        {
          error: 'Configuration validation failed',
          details: configValidation.errors,
        },
        { status: 500 }
      );
    }

    // Check if customs update feature is enabled
    if (!config.features.enableCustomsUpdate && !config.features.dryRun) {
      logger.warn('batch_completed', 'Customs update feature is disabled', {
        enableCustomsUpdate: config.features.enableCustomsUpdate,
        dryRun: config.features.dryRun,
      });

      return NextResponse.json({
        message: 'Customs update feature is disabled',
        dryRun: config.features.dryRun,
      });
    }

    // Process the batch
    logger.info('batch_started', 'Starting batch processing', {
      dryRun: config.features.dryRun,
      enableCustomsUpdate: config.features.enableCustomsUpdate,
      enableTagging: config.features.enableTagging,
    });

    const result = await processBatch();

    const duration = Date.now() - startTime;

    logger.info('batch_completed', 'Cron handler completed', {
      // batchId: result.batchId,
      duration,
      ...result,
    });

    // Send notifications
    if (result.status === 'completed') {
      // Import notification functions
      const { sendBatchSummary } = await import('@/lib/notifications/resend');

      await sendBatchSummary({
        batchId: result.batchId,
        processed: result.ordersProcessed,
        skipped: result.ordersSkipped,
        errors: result.errorsCount,
        creditsUsed: result.creditsUsed,
        startedAt: result.startedAt,
        completedAt: result.completedAt || new Date(),
        dryRun: config.features.dryRun,
      });
    }

    // Return success response
    return NextResponse.json({
      success: true,
      batchId: result.batchId,
      status: result.status,
      ordersQueried: result.ordersQueried,
      ordersProcessed: result.ordersProcessed,
      ordersSkipped: result.ordersSkipped,
      errorsCount: result.errorsCount,
      creditsUsed: result.creditsUsed,
      durationMs: duration,
      dryRun: config.features.dryRun,
      errorDetails: result.errorsCount > 0 ? result.errorDetails : undefined,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('batch_error', 'Cron handler failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: duration,
      },
      { status: 500 }
    );
  }
}
