import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { apps, paymentEvents, webhookDeliveries, type App, type PaymentEvent } from '../db/schema.js';
import { signWebhook } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { assertPublicHost } from '../lib/ssrf.js';

/** Delay before attempt n+1, in seconds. 10 attempts spread over ~2 days. */
const BACKOFF = [30, 120, 600, 1800, 3600, 7200, 14400, 28800, 43200, 86400];
export const MAX_ATTEMPTS = BACKOFF.length;

export function eventBody(evt: Pick<PaymentEvent, 'id' | 'type' | 'data' | 'createdAt'>): string {
  return JSON.stringify({
    id: evt.id,
    type: evt.type,
    created_at: evt.createdAt.toISOString(),
    data: { object: evt.data },
  });
}

export interface SendResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

export async function sendWebhook(ctx: Ctx, url: string, secret: string, body: string): Promise<SendResult> {
  try {
    if (!ctx.config.ALLOW_PRIVATE_WEBHOOKS) await assertPublicHost(url);
    const res = await ctx.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'ZodyPay-Webhooks/1.0',
        'zodypay-signature': signWebhook(secret, body),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    // Drain the body so the connection can be reused; we don't need its contents.
    await res.arrayBuffer().catch(() => undefined);
    return { ok: res.status >= 200 && res.status < 300, statusCode: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, statusCode: null, error: (err as Error).message.slice(0, 500) };
  }
}

/** Claims due deliveries with a 5-minute lease (atomic single UPDATE, safe across workers). */
async function claimDue(ctx: Ctx, limit: number): Promise<string[]> {
  const now = new Date();
  const due = ctx.db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, 'PENDING'), lte(webhookDeliveries.nextAttemptAt, now)))
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(limit);
  const rows = await ctx.db
    .update(webhookDeliveries)
    .set({ nextAttemptAt: new Date(now.getTime() + 300_000) })
    .where(inArray(webhookDeliveries.id, due))
    .returning({ id: webhookDeliveries.id });
  return rows.map((r) => r.id);
}

export async function attemptDelivery(ctx: Ctx, deliveryId: string): Promise<SendResult | null> {
  const [row] = await ctx.db
    .select({ d: webhookDeliveries, e: paymentEvents, secret: apps.webhookSecretEnc })
    .from(webhookDeliveries)
    .innerJoin(paymentEvents, eq(paymentEvents.id, webhookDeliveries.eventId))
    .innerJoin(apps, eq(apps.id, webhookDeliveries.appId))
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!row) return null;
  const result = await sendWebhook(ctx, row.d.url, ctx.encryptor.decrypt(row.secret), eventBody(row.e));
  const attempts = row.d.attempts + 1;
  const failedForGood = !result.ok && attempts >= MAX_ATTEMPTS;
  await ctx.db
    .update(webhookDeliveries)
    .set({
      attempts,
      status: result.ok ? 'SUCCEEDED' : failedForGood ? 'FAILED' : 'PENDING',
      lastStatusCode: result.statusCode,
      lastError: result.error,
      nextAttemptAt: new Date(Date.now() + (BACKOFF[attempts - 1] ?? 86400) * 1000),
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId));
  return result;
}

export async function deliverDueWebhooks(ctx: Ctx, limit = 50): Promise<number> {
  const ids = await claimDue(ctx, limit);
  // Sequential per batch keeps outbound concurrency bounded; batches run every few seconds.
  for (const id of ids) await attemptDelivery(ctx, id);
  return ids.length;
}

/** Manual resend from the dashboard: creates a fresh delivery for the same event. */
export async function resendDelivery(ctx: Ctx, appId: string, deliveryId: string) {
  const [d] = await ctx.db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.appId, appId)));
  if (!d) throw notFound('Delivery');
  const [app] = await ctx.db.select().from(apps).where(eq(apps.id, appId));
  const id = newId('whd', 20);
  await ctx.db.insert(webhookDeliveries).values({ id, appId, eventId: d.eventId, url: app?.webhookUrl ?? d.url });
  return attemptDelivery(ctx, id);
}

/** Sends a signed "ping" event so merchants can verify their endpoint and signature check. */
export async function sendTestWebhook(ctx: Ctx, app: App) {
  if (!app.webhookUrl) return { ok: false, statusCode: null, error: 'No webhook URL configured' };
  const body = JSON.stringify({
    id: newId('evt', 24),
    type: 'ping',
    created_at: new Date().toISOString(),
    data: { object: { app_id: app.id, message: 'Webhook test from ZodyPay' } },
  });
  return sendWebhook(ctx, app.webhookUrl, ctx.encryptor.decrypt(app.webhookSecretEnc), body);
}

export async function deliveriesForEvents(ctx: Ctx, eventIds: string[]) {
  if (!eventIds.length) return [];
  return ctx.db.select().from(webhookDeliveries).where(inArray(webhookDeliveries.eventId, eventIds));
}
