import { formatHumanReadable } from '../utils/timezone';

export interface ErrorNotificationData {
  orderId?: string;
  orderNumber?: string;
  error: Error;
  batchId: string;
}

export interface SuccessSummaryData {
  batchId: string;
  processed: number;
  skipped: number;
  errors: number;
  creditsUsed: number;
  startedAt: Date;
  completedAt: Date;
  dryRun: boolean;
}

/**
 * Generate HTML email for error notification
 */
export function generateErrorEmail(data: ErrorNotificationData): string {
  const { orderId, orderNumber, error, batchId } = data;

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #dc2626; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; }
    .footer { background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 5px 5px; }
    .error-box { background-color: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 15px 0; }
    .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .info-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
    .info-table td:first-child { font-weight: bold; width: 150px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🚨 Customs Update Error</h2>
    </div>
    <div class="content">
      <p>An error occurred while processing a Turkey-bound order for customs value updates.</p>

      <table class="info-table">
        <tr>
          <td>Batch ID:</td>
          <td><code>${batchId}</code></td>
        </tr>
        ${orderNumber ? `
        <tr>
          <td>Order Number:</td>
          <td><strong>${orderNumber}</strong></td>
        </tr>
        ` : ''}
        ${orderId ? `
        <tr>
          <td>Order ID:</td>
          <td><code>${orderId}</code></td>
        </tr>
        ` : ''}
        <tr>
          <td>Timestamp:</td>
          <td>${formatHumanReadable(new Date())}</td>
        </tr>
      </table>

      <div class="error-box">
        <strong>Error Message:</strong><br>
        ${error.message}
      </div>

      <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
        Please check the Axiom logs for more details and investigate the issue.
      </p>
    </div>
    <div class="footer">
      Sent by Vacier Turkey Orders Customs Updater<br>
      Automated notification - do not reply
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate HTML email for success summary
 */
export function generateSuccessEmail(data: SuccessSummaryData): string {
  const { batchId, processed, skipped, errors, creditsUsed, startedAt, completedAt, dryRun } = data;

  const duration = completedAt.getTime() - startedAt.getTime();
  const durationMinutes = Math.floor(duration / 60000);
  const durationSeconds = Math.floor((duration % 60000) / 1000);

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #059669; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; }
    .footer { background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 5px 5px; }
    .stats { display: flex; justify-content: space-around; margin: 20px 0; }
    .stat { text-align: center; }
    .stat-value { font-size: 32px; font-weight: bold; color: #059669; }
    .stat-label { font-size: 14px; color: #6b7280; margin-top: 5px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .info-table td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
    .info-table td:first-child { font-weight: bold; width: 180px; color: #6b7280; }
    .warning { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px; margin: 15px 0; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">✅ Customs Update ${dryRun ? 'Dry-Run' : 'Batch'} Complete</h2>
    </div>
    <div class="content">
      ${dryRun ? `
      <div class="warning">
        <strong>⚠️ DRY-RUN MODE:</strong> No actual changes were made. This was a simulation.
      </div>
      ` : ''}

      <p>The customs value update batch has completed successfully.</p>

      <div class="stats">
        <div class="stat">
          <div class="stat-value">${processed}</div>
          <div class="stat-label">Processed</div>
        </div>
        <div class="stat">
          <div class="stat-value">${skipped}</div>
          <div class="stat-label">Skipped</div>
        </div>
        ${errors > 0 ? `
        <div class="stat">
          <div class="stat-value" style="color: #dc2626;">${errors}</div>
          <div class="stat-label">Errors</div>
        </div>
        ` : ''}
      </div>

      <table class="info-table">
        <tr>
          <td>Batch ID:</td>
          <td><code>${batchId}</code></td>
        </tr>
        <tr>
          <td>Started:</td>
          <td>${formatHumanReadable(startedAt)}</td>
        </tr>
        <tr>
          <td>Completed:</td>
          <td>${formatHumanReadable(completedAt)}</td>
        </tr>
        <tr>
          <td>Duration:</td>
          <td>${durationMinutes}m ${durationSeconds}s</td>
        </tr>
        <tr>
          <td>API Credits Used:</td>
          <td>${creditsUsed}</td>
        </tr>
        <tr>
          <td>Total Orders:</td>
          <td>${processed + skipped + errors}</td>
        </tr>
      </table>

      ${errors > 0 ? `
      <div class="warning">
        <strong>Note:</strong> ${errors} order(s) encountered errors. Check Axiom logs for details.
      </div>
      ` : ''}

      <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">
        View detailed logs in Axiom dashboard for complete batch analysis.
      </p>
    </div>
    <div class="footer">
      Sent by Vacier Turkey Orders Customs Updater<br>
      Automated notification - do not reply
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text version of error email (for fallback)
 */
export function generateErrorEmailText(data: ErrorNotificationData): string {
  const { orderId, orderNumber, error, batchId } = data;

  return `
CUSTOMS UPDATE ERROR

An error occurred while processing a Turkey-bound order.

Batch ID: ${batchId}
${orderNumber ? `Order Number: ${orderNumber}` : ''}
${orderId ? `Order ID: ${orderId}` : ''}
Timestamp: ${formatHumanReadable(new Date())}

Error Message:
${error.message}

Please check the Axiom logs for more details.

---
Sent by Vacier Turkey Orders Customs Updater
  `.trim();
}

/**
 * Generate plain text version of success email (for fallback)
 */
export function generateSuccessEmailText(data: SuccessSummaryData): string {
  const { batchId, processed, skipped, errors, creditsUsed, startedAt, completedAt, dryRun } = data;

  const duration = completedAt.getTime() - startedAt.getTime();
  const durationMinutes = Math.floor(duration / 60000);
  const durationSeconds = Math.floor((duration % 60000) / 1000);

  return `
CUSTOMS UPDATE ${dryRun ? 'DRY-RUN' : 'BATCH'} COMPLETE

${dryRun ? 'DRY-RUN MODE: No actual changes were made.\n' : ''}
Batch ID: ${batchId}

SUMMARY:
- Processed: ${processed}
- Skipped: ${skipped}
- Errors: ${errors}
- API Credits Used: ${creditsUsed}
- Total Orders: ${processed + skipped + errors}

TIMING:
- Started: ${formatHumanReadable(startedAt)}
- Completed: ${formatHumanReadable(completedAt)}
- Duration: ${durationMinutes}m ${durationSeconds}s

${errors > 0 ? `\nNote: ${errors} order(s) encountered errors. Check Axiom logs for details.\n` : ''}
View detailed logs in Axiom dashboard.

---
Sent by Vacier Turkey Orders Customs Updater
  `.trim();
}
