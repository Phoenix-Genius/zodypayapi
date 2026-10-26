import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { createDb, runMigrations } from './db/index.js';
import { createEncryptor } from './lib/crypto.js';
import { createMemoryKv, createRedisKv } from './lib/kv.js';
import { createProviderRegistry } from './providers/registry.js';

/** Production wiring shared by the API server and the worker. */
export async function createContext(name: string) {
  const config = loadConfig();
  const log = pino({
    name,
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  });
  const { db, close: closeDb } = await createDb(config.DATABASE_URL);
  await runMigrations(db);
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: null }) : null;
  const ctx: Ctx = {
    config,
    db,
    kv: redis ? createRedisKv(redis) : createMemoryKv(),
    providers: createProviderRegistry(config),
    encryptor: createEncryptor(config.APP_ENCRYPTION_KEY),
    fetch,
    log,
  };
  const live = ctx.providers.forMode('LIVE').map((p) => p.id);
  log.info({ liveProviders: live }, live.length ? 'live providers configured' : 'no live provider credentials; live mode has no routes');
  return {
    ctx,
    redis,
    close: async () => {
      await redis?.quit();
      closeDb();
    },
  };
}
