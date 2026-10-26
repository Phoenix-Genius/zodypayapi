import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { DB } from './db/index.js';
import type { Encryptor } from './lib/crypto.js';
import type { Kv } from './lib/kv.js';
import type { FetchFn } from './providers/http.js';
import type { ProviderRegistry } from './providers/registry.js';

/** Everything services need; built once per process (server, worker, tests). */
export interface Ctx {
  config: Config;
  db: DB;
  kv: Kv;
  providers: ProviderRegistry;
  encryptor: Encryptor;
  /** Outbound HTTP for webhooks and price feeds (injectable for tests). */
  fetch: FetchFn;
  log: Logger;
}
