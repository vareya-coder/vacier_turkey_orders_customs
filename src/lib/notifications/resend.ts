import { Resend } from 'resend';
import { env } from '../env';
import { config } from '../config';
import { createLogger } from '../logging/axiom';
import {
  generateErrorEmail,
  generateErrorEmailText,
  generateSuccessEmail,
  generateSuccessEmailText,
  type ErrorNotificationData,
  type SuccessSummaryData,
} from './templates';

const logger = createLogger({ service: 'notifications' });

// Initialize Resend client
const resend = new Resend(env.RESEND_API_KEY);

/**
 * Send error notification email
 */
export async function sendErrorNotification(data: ErrorNotificationData): Promise<void> {
  if (!config.notifications.enableErrors) {
    logger.debug('batch_error', 'Error notifications disabled, skipping', {
      batchId: data.batchId,
    });
    return;
  }

  try {
    const html = generateErrorEmail(data);
    const text = generateErrorEmailText(data);

    const result = await resend.emails.send({
      from: 'Vacier Customs Updater <noreply@vareya.nl>',
      to: config.notifications.email,
      subject: `🚨 Customs Update Error - Order ${data.orderNumber || data.orderId || 'Unknown'}`,
      html,
      text,
    });

    logger.info('batch_completed', 'Error notification sent', {
      batchId: data.batchId,
      emailId: result.data?.id,
      recipient: config.notifications.email,
    });
  } catch (error) {
    logger.error('batch_error', 'Failed to send error notification', {
      batchId: data.batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - we don't want email failures to crash the batch
  }
}

/**
 * Send success summary email
 */
export async function sendSuccessSummary(data: SuccessSummaryData): Promise<void> {
  if (!config.notifications.enableSuccess) {
    logger.debug('batch_completed', 'Success notifications disabled, skipping', {
      batchId: data.batchId,
    });
    return;
  }

  try {
    const html = generateSuccessEmail(data);
    const text = generateSuccessEmailText(data);

    const subject = data.dryRun
      ? `✅ Customs Update Dry-Run Complete - ${data.processed} orders simulated`
      : `✅ Customs Update Complete - ${data.processed} orders processed`;

    const result = await resend.emails.send({
      from: 'Vacier Customs Updater <noreply@vareya.nl>',
      to: config.notifications.email,
      subject,
      html,
      text,
    });

    logger.info('batch_completed', 'Success notification sent', {
      batchId: data.batchId,
      emailId: result.data?.id,
      recipient: config.notifications.email,
    });
  } catch (error) {
    logger.error('batch_error', 'Failed to send success notification', {
      batchId: data.batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - we don't want email failures to crash the batch
  }
}

/**
 * Send batch summary (success or with errors)
 */
export async function sendBatchSummary(data: SuccessSummaryData): Promise<void> {
  // If there are errors, send error notification for each (optional, or just summary)
  // For now, just send the summary which includes error count

  await sendSuccessSummary(data);
}
