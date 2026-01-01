import { drizzle } from 'drizzle-orm/vercel-postgres';
import { sql as vercelsql } from '@vercel/postgres';
import * as schema from './schema';

// Create Drizzle client with Vercel Postgres
export const db = drizzle(vercelsql, { schema });

// Helper type for transactions
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
