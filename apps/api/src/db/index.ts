import { createClient } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export { schema };

export type DB = LibSQLDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens the SQLite database (e.g. `file:./data/zodypay.db`). WAL mode plus a busy timeout let
 * the API and the worker process share one file; write transactions use BEGIN IMMEDIATE.
 */
export async function createDb(url: string) {
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  const client = createClient({ url, timeout: 5000 });
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}

export async function runMigrations(db: DB) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
