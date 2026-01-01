import { pgTable, serial, varchar, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

export const batchRuns = pgTable('batch_runs', {
  id: serial('id').primaryKey(),
  batchId: varchar('batch_id', { length: 50 }).notNull().unique(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  ordersQueried: integer('orders_queried').default(0),
  ordersProcessed: integer('orders_processed').default(0),
  ordersSkipped: integer('orders_skipped').default(0),
  errorsCount: integer('errors_count').default(0),
  errorDetails: jsonb('error_details'),
  creditsUsed: integer('credits_used').default(0),
  status: varchar('status', { length: 20 }).notNull(), // 'running' | 'completed' | 'failed'
});

export type BatchRun = typeof batchRuns.$inferSelect;
export type NewBatchRun = typeof batchRuns.$inferInsert;
