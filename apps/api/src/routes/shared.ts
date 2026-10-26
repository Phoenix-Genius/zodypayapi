import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { paymentEvents, payments, swaps, webhookDeliveries, type Mode, type PaymentStatus } from '../db/schema.js';
import { likePattern, notFound } from '../lib/errors.js';
import { publicPayment, publicSwap } from '../services/payments.js';

export const PAYMENT_STATUSES = ['pending', 'processing', 'paid', 'underpaid', 'expired', 'failed', 'refunded', 'canceled'] as const;

export async function listPayments(
  ctx: Ctx,
  f: { appIds?: string[]; mode?: Mode; status?: string; q?: string; before?: string; limit: number },
) {
  const where: (SQL | undefined)[] = [];
  if (f.appIds) where.push(inArray(payments.appId, f.appIds.length ? f.appIds : ['-']));
  if (f.mode) where.push(eq(payments.mode, f.mode));
  if (f.status) where.push(eq(payments.status, f.status.toUpperCase() as PaymentStatus));
  if (f.q) where.push(or(eq(payments.id, f.q), sql`${payments.orderId} LIKE ${likePattern(f.q)} ESCAPE '\\'`));
  if (f.before) where.push(lt(payments.createdAt, new Date(f.before)));
  const rows = await ctx.db
    .select()
    .from(payments)
    .where(and(...where))
    .orderBy(desc(payments.createdAt))
    .limit(f.limit + 1);
  const page = rows.slice(0, f.limit);
  return {
    data: page.map((p) => publicPayment(ctx, p)),
    has_more: rows.length > f.limit,
    next_before: rows.length > f.limit ? page[page.length - 1]!.createdAt.toISOString() : null,
  };
}

/** Full payment record for dashboards: swaps, event log and webhook deliveries. */
export async function paymentDetail(ctx: Ctx, paymentId: string, appIds?: string[]) {
  const [p] = await ctx.db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p || (appIds && !appIds.includes(p.appId))) throw notFound('Payment');
  const [swapRows, events] = await Promise.all([
    ctx.db.select().from(swaps).where(eq(swaps.paymentId, p.id)).orderBy(desc(swaps.createdAt)),
    ctx.db.select().from(paymentEvents).where(eq(paymentEvents.paymentId, p.id)).orderBy(asc(paymentEvents.createdAt)),
  ]);
  const deliveries = events.length
    ? await ctx.db
        .select()
        .from(webhookDeliveries)
        .where(inArray(webhookDeliveries.eventId, events.map((e) => e.id)))
        .orderBy(asc(webhookDeliveries.createdAt))
    : [];
  return {
    payment: { ...publicPayment(ctx, p, swapRows[0] ?? null), app_id: p.appId },
    swaps: swapRows.map((s) => ({ ...publicSwap(ctx, s), provider_order_id: s.providerOrderId, provider_status: s.providerStatus })),
    events: events.map((e) => ({ id: e.id, type: e.type, created_at: e.createdAt.toISOString() })),
    deliveries: deliveries.map(publicDelivery),
  };
}

export function publicDelivery(d: typeof webhookDeliveries.$inferSelect) {
  return {
    id: d.id,
    event_id: d.eventId,
    url: d.url,
    status: d.status.toLowerCase(),
    attempts: d.attempts,
    last_status_code: d.lastStatusCode,
    last_error: d.lastError,
    next_attempt_at: d.status === 'PENDING' ? d.nextAttemptAt.toISOString() : null,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}
