import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** SQLite file, relative to the API's working directory. */
  DATABASE_URL: z.string().default('file:./data/zodypay.db'),
  /** Optional. Without it, background jobs run inside the API process and the cache is in-memory. */
  REDIS_URL: z.string().optional(),
  /** Public URL of the web app; used to build checkout links. */
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** 32-byte key (hex or base64) used to encrypt webhook secrets at rest. */
  APP_ENCRYPTION_KEY: z.string().min(32),
  TRUST_PROXY: bool.default(false),
  COOKIE_SECURE: bool.default(false),
  ALLOW_REGISTRATION: bool.default(true),
  /** Allow webhooks to private/loopback addresses (development only). */
  ALLOW_PRIVATE_WEBHOOKS: bool.default(false),
  PAYMENT_TTL_MINUTES: z.coerce.number().int().min(15).max(1440).default(60),

  SIDESHIFT_SECRET: z.string().optional(),
  SIDESHIFT_AFFILIATE_ID: z.string().optional(),
  CHANGENOW_API_KEY: z.string().optional(),
  FIXEDFLOAT_API_KEY: z.string().optional(),
  FIXEDFLOAT_API_SECRET: z.string().optional(),
  FIXEDFLOAT_REFCODE: z.string().optional(),
  FIXEDFLOAT_AFFTAX: z.coerce.number().optional(),
  COINGECKO_API_KEY: z.string().optional(),

  /** Seconds a mock swap waits in each stage (test mode). */
  MOCK_STAGE_SECONDS: z.coerce.number().default(15),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
