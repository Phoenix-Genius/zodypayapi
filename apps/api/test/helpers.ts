import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Ctx } from '../src/context.js';
import { createDb, runMigrations } from '../src/db/index.js';
import { createEncryptor } from '../src/lib/crypto.js';
import { createMemoryKv } from '../src/lib/kv.js';
import { createProviderRegistry } from '../src/providers/registry.js';

export interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** In-process API on a throwaway SQLite file with a stubbed outbound fetch. */
export async function createTestEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'zodypay-test-'));
  const { db, close: closeDb } = await createDb(`file:${join(dir, 'test.db')}`);
  await runMigrations(db);

  const webhooks: Captured[] = [];
  let webhookStatus = 200;
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    webhooks.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body ?? '') });
    return new Response('ok', { status: webhookStatus });
  }) as typeof fetch;

  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ENCRYPTION_KEY: '0'.repeat(64),
    ALLOW_PRIVATE_WEBHOOKS: 'true',
    MOCK_STAGE_SECONDS: '0',
    WEB_URL: 'http://pay.test',
  });
  const ctx: Ctx = {
    config,
    db,
    kv: createMemoryKv(),
    providers: createProviderRegistry(config),
    encryptor: createEncryptor(config.APP_ENCRYPTION_KEY),
    fetch: fakeFetch,
    log: pino({ level: 'silent' }),
  };
  const app = await buildApp(ctx);
  return {
    app,
    ctx,
    webhooks,
    setWebhookStatus: (s: number) => {
      webhookStatus = s;
    },
    close: async () => {
      await app.close();
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw);
  return String(first).split(';')[0]!;
}
