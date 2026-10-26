import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const ROLES = ['MERCHANT', 'ADMIN'] as const;
export const MODES = ['LIVE', 'TEST'] as const;
export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'UNDERPAID', 'EXPIRED', 'FAILED', 'REFUNDED', 'CANCELED'] as const;
export const SWAP_STATUSES = [
  'AWAITING_DEPOSIT',
  'CONFIRMING',
  'EXCHANGING',
  'ON_HOLD',
  'SETTLED',
  'REFUNDING',
  'REFUNDED',
  'EXPIRED',
  'FAILED',
] as const;
export const DELIVERY_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;

// Money is stored as canonical decimal strings and only ever handled with decimal.js;
// SQLite has no exact decimal type, so we never do arithmetic on it in SQL.
const money = (name: string) => text(name);
const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () => ts('created_at').notNull().$defaultFn(() => new Date());

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ROLES }).notNull().default('MERCHANT'),
  disabledAt: ts('disabled_at'),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the cookie token
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const apps = sqliteTable(
  'apps',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    webhookUrl: text('webhook_url'),
    webhookSecretEnc: text('webhook_secret_enc').notNull(),
    settleCoin: text('settle_coin').notNull(),
    settleNetwork: text('settle_network').notNull(),
    settleAddress: text('settle_address').notNull(),
    settleMemo: text('settle_memo'),
    underpayTolBps: integer('underpay_tol_bps').notNull().default(50),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('apps_owner_idx').on(t.ownerId)],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: MODES }).notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('api_keys_app_idx').on(t.appId)],
);

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(), // pay_..., also the public checkout id
    appId: text('app_id')
      .notNull()
      .references(() => apps.id),
    mode: text('mode', { enum: MODES }).notNull(),
    orderId: text('order_id').notNull(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    description: text('description'),
    // Settlement is snapshotted so later app edits never redirect in-flight payments.
    settleCoin: text('settle_coin').notNull(),
    settleNetwork: text('settle_network').notNull(),
    settleAddress: text('settle_address').notNull(),
    settleMemo: text('settle_memo'),
    settleExpected: money('settle_expected').notNull(),
    settleReceived: money('settle_received'),
    underpayTolBps: integer('underpay_tol_bps').notNull(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('PENDING'),
    successUrl: text('success_url'),
    cancelUrl: text('cancel_url'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, string>>(),
    expiresAt: ts('expires_at').notNull(),
    paidAt: ts('paid_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index('payments_app_created_idx').on(t.appId, t.createdAt),
    index('payments_app_order_idx').on(t.appId, t.orderId),
    index('payments_status_expires_idx').on(t.status, t.expiresAt),
  ],
);

export const swaps = sqliteTable(
  'swaps',
  {
    id: text('id').primaryKey(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    provider: text('provider').notNull(),
    providerOrderId: text('provider_order_id').notNull(),
    providerToken: text('provider_token'), // some providers need an order token to query status
    depositCoin: text('deposit_coin').notNull(),
    depositNetwork: text('deposit_network').notNull(),
    depositAddress: text('deposit_address').notNull(),
    depositMemo: text('deposit_memo'),
    depositAmount: money('deposit_amount').notNull(),
    settleAmount: money('settle_amount').notNull(),
    settledAmount: money('settled_amount'),
    rate: money('rate').notNull(),
    refundAddress: text('refund_address'),
    quoteExpiresAt: ts('quote_expires_at').notNull(),
    status: text('status', { enum: SWAP_STATUSES }).notNull().default('AWAITING_DEPOSIT'),
    providerStatus: text('provider_status').notNull(),
    depositTxHash: text('deposit_tx_hash'),
    settleTxHash: text('settle_tx_hash'),
    raw: text('raw', { mode: 'json' }),
    nextPollAt: ts('next_poll_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('swaps_provider_order_uq').on(t.provider, t.providerOrderId),
    index('swaps_payment_idx').on(t.paymentId),
    index('swaps_poll_idx').on(t.nextPollAt),
  ],
);

export const paymentEvents = sqliteTable(
  'payment_events',
  {
    id: text('id').primaryKey(), // evt_...
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    type: text('type').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('payment_events_payment_idx').on(t.paymentId)],
);

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => paymentEvents.id),
    url: text('url').notNull(),
    status: text('status', { enum: DELIVERY_STATUSES }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().$defaultFn(() => new Date()),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_app_idx').on(t.appId, t.createdAt),
  ],
);

export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseCode: integer('response_code').notNull(),
    responseBody: text('response_body', { mode: 'json' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.key] })],
);

export const providerConfigs = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  disabledUntil: ts('disabled_until'),
  lastError: text('last_error'),
  lastErrorAt: ts('last_error_at'),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type App = typeof apps.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Swap = typeof swaps.$inferSelect;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type Mode = (typeof MODES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type SwapStatus = (typeof SWAP_STATUSES)[number];
