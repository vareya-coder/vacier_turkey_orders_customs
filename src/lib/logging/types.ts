export type LogEvent =
  | 'batch_started'
  | 'orders_queried'
  | 'order_processing'
  | 'order_skipped'
  | 'customs_calculated'
  | 'line_items_updated'
  | 'order_tagged'
  | 'order_completed'
  | 'quota_warning'
  | 'batch_completed'
  | 'batch_error';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  batchId?: string;
  orderId?: string;
  orderNumber?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  event: LogEvent;
  message: string;
  context?: LogContext;
  timestamp?: string;
}
