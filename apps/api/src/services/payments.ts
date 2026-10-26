import { and, asc, desc, eq, gt, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import type { DB, Tx } from '../db/index.js';
import {
  apps,
  paymentEvents,
  payments,
  swaps,
  webhookDeliveries,
  type App,
  type Mode,
  type Payment,
  type PaymentStatus,
  type Swap,
  type SwapStatus,
} from '../db/schema.js';
import { newId } from '../lib/ids.js';
import { Decimal, fmt, minAcceptable } from '../lib/money.js';
import { explorerTxUrl } from '../providers/networks.js';
import type { SwapState } from '../providers/types.js';
import { computeSettleAmount } from './pricing.js';

export const TERMINAL_SWAP: SwapStatus[] = ['SETTLED', 'REFUNDED', 'EXPIRED', 'FAILED'];

export interface CreatePaymentInput {
  amount: string;
  currency: string;
  orderId: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  expiresInMinutes?: number;
}

export async function createPayment(
  ctx: Ctx,
  app: App,
  mode: Mode,
  input: CreatePaymentInput,
  db: DB | Tx = ctx.db,
): Promise<Payment> {
  const settleExpected = await computeSettleAmount(ctx, {
    amount: input.amount,
    currency: input.currency,
    settleCoin: app.settleCoin,
    mode,
  });
  const ttl = input.expiresInMinutes ?? ctx.config.PAYMENT_TTL_MINUTES;
  const [row] = await db
    .insert(payments)
    .values({
      id: newId('pay', 24),
      appId: app.id,
      mode,
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      description: input.description ?? null,
      settleCoin: app.settleCoin,
      settleNetwork: app.settleNetwork,
      settleAddress: app.settleAddress,
      settleMemo: app.settleMemo,
      settleExpected,
      underpayTolBps: app.underpayTolBps,
      successUrl: input.successUrl ?? null,
      cancelUrl: input.cancelUrl ?? null,
      metadata: input.metadata ?? null,
      expiresAt: new Date(Date.now() + ttl * 60_000),
    })
    .returning();
  return row!;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const num = (v: string | null) => (v == null ? null : fmt(v));

export function publicSwap(ctx: Ctx, s: Swap) {
  const provider = ctx.providers.get(s.provider);
  return {
    id: s.id,
    provider: s.provider,
    provider_name: provider?.name ?? s.provider,
    status: s.status.toLowerCase(),
    deposit_coin: s.depositCoin,
    deposit_network: s.depositNetwork,
    deposit_address: s.depositAddress,
    deposit_memo: s.depositMemo,
    deposit_amount: fmt(s.depositAmount),
    settle_amount: fmt(s.settleAmount),
    settled_amount: num(s.settledAmount),
    rate: fmt(s.rate),
    quote_expires_at: s.quoteExpiresAt.toISOString(),
    deposit_tx_hash: s.depositTxHash,
    deposit_tx_url: explorerTxUrl(s.depositNetwork, s.depositTxHash),
    settle_tx_hash: s.settleTxHash,
    tracking_url: provider?.trackingUrl(s.providerOrderId) ?? null,
    created_at: s.createdAt.toISOString(),
  };
}

export function publicPayment(ctx: Ctx, p: Payment, latestSwap?: Swap | null) {
  return {
    id: p.id,
    object: 'payment' as const,
    livemode: p.mode === 'LIVE',
    status: p.status.toLowerCase() as Lowercase<PaymentStatus>,
    order_id: p.orderId,
    amount: fmt(p.amount),
    currency: p.currency,
    description: p.description,
    settlement: {
      coin: p.settleCoin,
      network: p.settleNetwork,
      address: p.settleAddress,
      memo: p.settleMemo,
      expected_amount: fmt(p.settleExpected),
      received_amount: num(p.settleReceived),
      tx_hash: latestSwap?.settleTxHash ?? null,
      tx_url: explorerTxUrl(p.settleNetwork, latestSwap?.settleTxHash ?? null),
    },
    swap: latestSwap ? publicSwap(ctx, latestSwap) : null,
    checkout_url: `${ctx.config.WEB_URL.replace(/\/$/, '')}/p/${p.id}`,
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    metadata: p.metadata ?? {},
    expires_at: p.expiresAt.toISOString(),
    paid_at: iso(p.paidAt),
    created_at: p.createdAt.toISOString(),
  };
}

export type PublicPayment = ReturnType<typeof publicPayment>;

export async function latestSwapFor(db: DB | Tx, paymentId: string): Promise<Swap | null> {
  const [s] = await db.select().from(swaps).where(eq(swaps.paymentId, paymentId)).orderBy(desc(swaps.createdAt)).limit(1);
  return s ?? null;
}

/**
 * Records an event and, if the app has a webhook URL, queues a delivery in the same
 * transaction (transactional outbox): a committed status change always has its webhook.
 */
export async function emitEvent(ctx: Ctx, tx: Tx, payment: Payment, type: string, swap?: Swap | null) {
  const eventId = newId('evt', 24);
  const data = publicPayment(ctx, payment, swap ?? (await latestSwapFor(tx, payment.id)));
  await tx.insert(paymentEvents).values({ id: eventId, paymentId: payment.id, type, data });
  const [app] = await tx.select({ webhookUrl: apps.webhookUrl }).from(apps).where(eq(apps.id, payment.appId));
  if (app?.webhookUrl) {
    await tx.insert(webhookDeliveries).values({
      id: newId('whd', 20),
      appId: payment.appId,
      eventId,
      url: app.webhookUrl,
    });
  }
}

/** Moves a payment to `to` only if it is currently in one of `from`; returns the updated row or null. */
async function transition(
  tx: Tx,
  paymentId: string,
  from: PaymentStatus[],
  to: PaymentStatus,
  extra: Partial<Payment> = {},
): Promise<Payment | null> {
  const [row] = await tx
    .update(payments)
    .set({ ...extra, status: to, updatedAt: new Date() })
    .where(and(eq(payments.id, paymentId), inArray(payments.status, from)))
    .returning();
  return row ?? null;
}

/**
 * Applies a provider status to a swap and derives the payment status from it.
 * Idempotent: replaying the same state produces no new events.
 */
export async function applySwapState(ctx: Ctx, swapId: string, state: SwapState): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    // Write transactions are BEGIN IMMEDIATE, so this read is already serialized against other writers.
    const [swap] = await tx.select().from(swaps).where(eq(swaps.id, swapId));
    if (!swap) return;
    const changed = swap.status !== state.status || swap.providerStatus !== state.providerStatus;
    const terminal = TERMINAL_SWAP.includes(state.status);
    const [updated] = await tx
      .update(swaps)
      .set({
        status: state.status,
        providerStatus: state.providerStatus,
        depositTxHash: state.depositTxHash ?? swap.depositTxHash,
        settleTxHash: state.settleTxHash ?? swap.settleTxHash,
        settledAmount: state.settledAmount ?? swap.settledAmount,
        raw: state.raw as object,
        nextPollAt: terminal ? null : new Date(Date.now() + pollDelayMs(state.status)),
        updatedAt: new Date(),
      })
      .where(eq(swaps.id, swapId))
      .returning();
    if (!changed || !updated) return;

    const paymentId = swap.paymentId;
    switch (state.status) {
      case 'CONFIRMING':
      case 'EXCHANGING':
      case 'ON_HOLD': {
        const p = await transition(tx, paymentId, ['PENDING', 'EXPIRED', 'CANCELED'], 'PROCESSING');
        if (p) await emitEvent(ctx, tx, p, 'payment.processing', updated);
        break;
      }
      case 'SETTLED': {
        const [current] = await tx.select().from(payments).where(eq(payments.id, paymentId));
        if (!current) return;
        const received = new Decimal(updated.settledAmount ?? updated.settleAmount);
        const full = received.gte(minAcceptable(current.settleExpected, current.underpayTolBps));
        // Funds reached the merchant, so this wins over expired/canceled: report the truth.
        const p = await transition(
          tx,
          paymentId,
          ['PENDING', 'PROCESSING', 'EXPIRED', 'CANCELED', 'FAILED'],
          full ? 'PAID' : 'UNDERPAID',
          { settleReceived: fmt(received), paidAt: new Date() },
        );
        if (p) await emitEvent(ctx, tx, p, full ? 'payment.paid' : 'payment.underpaid', updated);
        break;
      }
      case 'REFUNDED': {
        const p = await transition(tx, paymentId, ['PROCESSING'], 'REFUNDED');
        if (p) await emitEvent(ctx, tx, p, 'payment.refunded', updated);
        break;
      }
      case 'FAILED': {
        const p = await transition(tx, paymentId, ['PROCESSING'], 'FAILED');
        if (p) await emitEvent(ctx, tx, p, 'payment.failed', updated);
        break;
      }
      default:
        break;
    }
  });
}

function pollDelayMs(status: SwapStatus): number {
  return status === 'AWAITING_DEPOSIT' ? 20_000 : status === 'ON_HOLD' ? 120_000 : 15_000;
}

/**
 * Claims swaps due for polling by pushing their next poll 2 minutes out (a lease).
 * A single UPDATE is atomic in SQLite, so concurrent workers never claim the same row.
 */
export async function claimDueSwaps(ctx: Ctx, limit = 50): Promise<Swap[]> {
  const now = new Date();
  const due = ctx.db
    .select({ id: swaps.id })
    .from(swaps)
    .where(and(isNotNull(swaps.nextPollAt), lte(swaps.nextPollAt, now)))
    .orderBy(asc(swaps.nextPollAt))
    .limit(limit);
  return ctx.db
    .update(swaps)
    .set({ nextPollAt: new Date(now.getTime() + 120_000) })
    .where(inArray(swaps.id, due))
    .returning();
}

export async function pollSwap(ctx: Ctx, swap: Swap): Promise<void> {
  const provider = ctx.providers.get(swap.provider);
  if (!provider) {
    ctx.log.error({ swap: swap.id, provider: swap.provider }, 'swap references unknown provider');
    return;
  }
  try {
    const state = await provider.getSwap({ providerOrderId: swap.providerOrderId, providerToken: swap.providerToken });
    await applySwapState(ctx, swap.id, state);
  } catch (err) {
    ctx.log.warn({ swap: swap.id, err: String(err) }, 'swap poll failed');
    // Back off; the lease set by claimDueSwaps already delays the next attempt by 2 minutes.
  }
}

export async function pollDueSwaps(ctx: Ctx): Promise<number> {
  const due = await claimDueSwaps(ctx);
  await Promise.all(due.map((s) => pollSwap(ctx, s)));
  return due.length;
}

/**
 * Expires PENDING payments past their deadline, unless a customer holds a still-valid quote.
 * A late deposit can still move an expired payment to PAID (see applySwapState).
 */
export async function expirePayments(ctx: Ctx): Promise<number> {
  const candidates = await ctx.db
    .select()
    .from(payments)
    .where(and(eq(payments.status, 'PENDING'), lte(payments.expiresAt, new Date())))
    .limit(200);
  let n = 0;
  for (const p of candidates) {
    await ctx.db.transaction(async (tx) => {
      const live = await tx
        .select({ id: swaps.id })
        .from(swaps)
        .where(
          and(
            eq(swaps.paymentId, p.id),
            eq(swaps.status, 'AWAITING_DEPOSIT'),
            gt(swaps.quoteExpiresAt, new Date()),
          ),
        )
        .limit(1);
      if (live.length) return;
      const updated = await transition(tx, p.id, ['PENDING'], 'EXPIRED');
      if (updated) {
        await emitEvent(ctx, tx, updated, 'payment.expired');
        n++;
      }
    });
  }
  return n;
}

export async function cancelPayment(ctx: Ctx, paymentId: string): Promise<Payment | null> {
  return ctx.db.transaction(async (tx) => {
    const p = await transition(tx, paymentId, ['PENDING'], 'CANCELED');
    if (p) await emitEvent(ctx, tx, p, 'payment.canceled');
    return p;
  });
}
