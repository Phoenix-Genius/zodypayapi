import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { swaps, payments, webhookDeliveries } from '../src/db/schema.js';
import { hmacSha256Hex } from '../src/lib/crypto.js';
import { MOCK_UNDERPAY_REFUND_ADDRESS } from '../src/providers/mock.js';
import { expirePayments, pollDueSwaps } from '../src/services/payments.js';
import { deliverDueWebhooks } from '../src/services/webhooks.js';
import { cookieFrom, createTestEnv } from './helpers.js';

type Env = Awaited<ReturnType<typeof createTestEnv>>;

describe('payment flow (test mode, mock providers)', () => {
  let env: Env;
  let cookie: string;
  let appId: string;
  let apiKey: string;
  let webhookSecret: string;

  const dash = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    env.app.inject({ method, url, payload: payload as object, headers: { cookie, 'x-zp-csrf': '1' } });
  const api = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    env.app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${apiKey}`, ...headers } });

  async function payToCompletion(paymentId: string, coin: string, network: string, refund?: string) {
    const quotes = await env.app.inject({ method: 'POST', url: `/checkout/${paymentId}/quotes`, payload: { coin, network } });
    assert.equal(quotes.statusCode, 200, quotes.body);
    const ref = quotes.json().quotes[0].ref;
    const swap = await env.app.inject({
      method: 'POST',
      url: `/checkout/${paymentId}/swaps`,
      payload: { quote_ref: ref, ...(refund ? { refund_address: refund } : {}) },
    });
    assert.equal(swap.statusCode, 201, swap.body);
    await env.ctx.db.update(swaps).set({ nextPollAt: new Date(Date.now() - 1000) }).where(eq(swaps.paymentId, paymentId));
    await pollDueSwaps(env.ctx);
    return { quotes: quotes.json(), swap: swap.json() };
  }

  before(async () => {
    env = await createTestEnv();
    const reg = await env.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'Owner@Example.com', password: 'correct horse battery' },
    });
    assert.equal(reg.statusCode, 201, reg.body);
    assert.equal(reg.json().user.role, 'admin', 'first user becomes admin');
    cookie = cookieFrom(reg);

    const created = await dash('POST', '/dashboard/apps', {
      name: 'Shop',
      webhook_url: 'http://merchant.test/hook',
      settle_coin: 'usdc',
      settle_network: 'base',
      settle_address: '0x1111111111111111111111111111111111111111',
    });
    assert.equal(created.statusCode, 201, created.body);
    appId = created.json().id;

    const key = await dash('POST', `/dashboard/apps/${appId}/keys`, { mode: 'test' });
    assert.equal(key.statusCode, 201, key.body);
    apiKey = key.json().key;
    webhookSecret = (await dash('GET', `/dashboard/apps/${appId}/webhook-secret`)).json().secret;
  });

  after(async () => env.close());

  it('rejects dashboard mutations without the CSRF header', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/dashboard/apps', headers: { cookie }, payload: {} });
    assert.equal(res.statusCode, 403);
  });

  it('rejects API calls without a valid key', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/v1/payments' });
    assert.equal(res.statusCode, 401);
  });

  it('validates amounts as decimal strings', async () => {
    const res = await api('POST', '/v1/payments', { amount: '1e5', currency: 'USD', order_id: 'x' });
    assert.equal(res.statusCode, 400);
  });

  it('creates a payment idempotently, routes to the cheapest provider and settles', async () => {
    const body = { amount: '25.00', currency: 'USD', order_id: 'order-1', metadata: { cart: '42' } };
    const first = await api('POST', '/v1/payments', body, { 'idempotency-key': 'k1' });
    assert.equal(first.statusCode, 201, first.body);
    const payment = first.json();
    assert.equal(payment.status, 'pending');
    assert.equal(payment.settlement.expected_amount, '25', 'USD → USDC is 1:1');
    assert.equal(payment.checkout_url, `http://pay.test/p/${payment.id}`);

    const replay = await api('POST', '/v1/payments', body, { 'idempotency-key': 'k1' });
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().id, payment.id);
    assert.equal(replay.headers['idempotent-replayed'], 'true');

    const reused = await api('POST', '/v1/payments', { ...body, amount: '26' }, { 'idempotency-key': 'k1' });
    assert.equal(reused.statusCode, 409);

    const view = await env.app.inject({ method: 'GET', url: `/checkout/${payment.id}` });
    assert.equal(view.json().merchant_name, 'Shop');
    assert.equal(view.json().settlement.address, undefined, 'checkout does not expose the payout address');

    const options = (await env.app.inject({ method: 'GET', url: `/checkout/${payment.id}/options` })).json().options;
    assert.ok(options.some((o: { coin: string }) => o.coin === 'BTC'));
    assert.ok(!options.some((o: { coin: string; network: string }) => o.coin === 'USDC' && o.network === 'base'));

    const { quotes, swap } = await payToCompletion(payment.id, 'BTC', 'bitcoin');
    assert.equal(quotes.quotes.length, 2, 'both mock providers quoted');
    assert.equal(quotes.quotes[0].provider, 'mock-dex', 'cheapest route first');
    assert.ok(Number(quotes.quotes[0].deposit_amount) < Number(quotes.quotes[1].deposit_amount));
    assert.equal(swap.status, 'awaiting_deposit');
    assert.ok(swap.deposit_address);

    const reuse = await env.app.inject({
      method: 'POST',
      url: `/checkout/${payment.id}/swaps`,
      payload: { quote_ref: quotes.quotes[0].ref },
    });
    assert.notEqual(reuse.statusCode, 201, 'quotes are single-use');

    const fetched = (await api('GET', `/v1/payments/${payment.id}`)).json();
    assert.equal(fetched.status, 'paid');
    assert.equal(fetched.settlement.received_amount, '25');
    assert.equal(fetched.swap.status, 'settled');
    assert.ok(fetched.paid_at);

    await deliverDueWebhooks(env.ctx);
    const hook = env.webhooks.find((w) => w.url === 'http://merchant.test/hook' && w.body.includes('payment.paid'));
    assert.ok(hook, 'payment.paid webhook delivered');
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(hook.headers['zodypay-signature']!)!;
    assert.equal(v1, hmacSha256Hex(webhookSecret, `${t}.${hook.body}`), 'signature verifies');
    const event = JSON.parse(hook.body);
    assert.equal(event.type, 'payment.paid');
    assert.equal(event.data.object.id, payment.id);
    assert.equal(event.data.object.metadata.cart, '42');
  });

  it('creates exactly one payment for concurrent requests with the same idempotency key', async () => {
    const body = { amount: '3.00', currency: 'USD', order_id: 'race-1' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api('POST', '/v1/payments', body, { 'idempotency-key': 'race-key' })),
    );
    assert.deepEqual(results.map((r) => r.statusCode), [201, 201, 201, 201, 201]);
    assert.equal(new Set(results.map((r) => r.json().id)).size, 1);
    const rows = await env.ctx.db.select().from(payments).where(eq(payments.orderId, 'race-1'));
    assert.equal(rows.length, 1);
  });

  it('flags underpayments', async () => {
    const p = (await api('POST', '/v1/payments', { amount: '10', currency: 'USD', order_id: 'order-2' })).json();
    await payToCompletion(p.id, 'ETH', 'ethereum', MOCK_UNDERPAY_REFUND_ADDRESS);
    const after = (await api('GET', `/v1/payments/${p.id}`)).json();
    assert.equal(after.status, 'underpaid');
    assert.equal(after.settlement.received_amount, '9');
  });

  it('expires unpaid payments and emits an event', async () => {
    const p = (await api('POST', '/v1/payments', { amount: '5', currency: 'USD', order_id: 'order-3' })).json();
    await env.ctx.db.update(payments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(payments.id, p.id));
    assert.ok((await expirePayments(env.ctx)) >= 1);
    assert.equal((await api('GET', `/v1/payments/${p.id}`)).json().status, 'expired');
    const quote = await env.app.inject({ method: 'POST', url: `/checkout/${p.id}/quotes`, payload: { coin: 'BTC', network: 'bitcoin' } });
    assert.equal(quote.statusCode, 409);
  });

  it('cancels pending payments', async () => {
    const p = (await api('POST', '/v1/payments', { amount: '5', currency: 'EUR', order_id: 'order-4' })).json();
    assert.equal(p.settlement.expected_amount, '5.4', 'EUR priced via test FX rate');
    const res = await api('POST', `/v1/payments/${p.id}/cancel`);
    assert.equal(res.json().status, 'canceled');
    assert.equal((await api('POST', `/v1/payments/${p.id}/cancel`)).statusCode, 409);
  });

  it('retries failed webhook deliveries with backoff', async () => {
    env.setWebhookStatus(500);
    const p = (await api('POST', '/v1/payments', { amount: '7', currency: 'USD', order_id: 'order-5' })).json();
    await payToCompletion(p.id, 'SOL', 'solana');
    await deliverDueWebhooks(env.ctx);
    const rows = await env.ctx.db.select().from(webhookDeliveries).where(sql`${webhookDeliveries.lastStatusCode} = 500`);
    assert.ok(rows.length >= 1);
    assert.equal(rows[0]!.status, 'PENDING');
    assert.equal(rows[0]!.attempts, 1);
    assert.ok(rows[0]!.nextAttemptAt.getTime() > Date.now());
    env.setWebhookStatus(200);
  });

  it('scopes payments to the key’s app and mode', async () => {
    const other = await dash('POST', '/dashboard/apps', {
      name: 'Other',
      settle_coin: 'USDT',
      settle_network: 'tron',
      settle_address: 'TXYZabcdefghijklmnopqrstuvwxyz1234',
    });
    const otherKey = (await dash('POST', `/dashboard/apps/${other.json().id}/keys`, { mode: 'test' })).json().key;
    const mine = (await api('GET', '/v1/payments?limit=1')).json().data[0];
    const res = await env.app.inject({
      method: 'GET',
      url: `/v1/payments/${mine.id}`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    assert.equal(res.statusCode, 404);
  });

  it('serves dashboard stats, payment detail and admin overview', async () => {
    const stats = (await dash('GET', `/dashboard/apps/${appId}/stats?mode=test`)).json();
    assert.ok(stats.paid >= 2);
    assert.ok(stats.volume.some((v: { currency: string }) => v.currency === 'USD'));

    const list = (await dash('GET', `/dashboard/apps/${appId}/payments?mode=test&status=paid`)).json();
    const detail = (await dash('GET', `/dashboard/apps/${appId}/payments/${list.data[0].id}`)).json();
    assert.ok(detail.events.some((e: { type: string }) => e.type === 'payment.paid'));
    assert.ok(detail.deliveries.length >= 1);

    const admin = await dash('GET', '/admin/overview');
    assert.equal(admin.statusCode, 200, admin.body);
    assert.ok(admin.json().providers.some((p: { id: string }) => p.id === 'mock-dex'));
  });

  it('keeps non-admins out of admin routes', async () => {
    const reg = await env.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'merchant@example.com', password: 'another long password' },
    });
    assert.equal(reg.json().user.role, 'merchant');
    const res = await env.app.inject({ method: 'GET', url: '/admin/overview', headers: { cookie: cookieFrom(reg) } });
    assert.equal(res.statusCode, 403);
  });

  it('publishes an OpenAPI document for the merchant API', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/docs/json' });
    assert.equal(res.statusCode, 200);
    const doc = res.json();
    assert.ok(doc.paths['/v1/payments']);
    assert.ok(!doc.paths['/dashboard/apps'], 'internal routes are hidden');
  });
});
