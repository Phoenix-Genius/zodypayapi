import { eq } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { apps, payments, swaps, type Payment } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { fmt } from '../lib/money.js';
import { ProviderError, type AssetRef, type Quote } from '../providers/types.js';
import { activeProviders, getCatalog, getRankedQuotes, recordProviderFailure } from './providers.js';
import { latestSwapFor, publicSwap } from './payments.js';

export async function loadPayment(ctx: Ctx, id: string): Promise<Payment> {
  const [p] = await ctx.db.select().from(payments).where(eq(payments.id, id));
  if (!p) throw notFound('Payment');
  return p;
}

/** Deposit assets a customer can pay with for this payment (at least one live route). */
export async function depositOptions(ctx: Ctx, p: Payment) {
  const catalog = await getCatalog(ctx, p.mode);
  const active = new Set((await activeProviders(ctx, p.mode)).map((x) => x.id));
  const settle = catalog.find((a) => a.coin === p.settleCoin && a.network === p.settleNetwork);
  const settleProviders = new Set((settle?.settle ?? []).filter((id) => active.has(id)));
  return catalog
    .filter((a) => !(a.coin === p.settleCoin && a.network === p.settleNetwork))
    .filter((a) => a.deposit.some((id) => settleProviders.has(id)))
    .map((a) => ({ coin: a.coin, network: a.network, name: a.name, network_name: a.networkName, has_memo: a.hasMemo }));
}

export async function checkoutView(ctx: Ctx, id: string) {
  const p = await loadPayment(ctx, id);
  const [app] = await ctx.db.select({ name: apps.name }).from(apps).where(eq(apps.id, p.appId));
  const swap = await latestSwapFor(ctx.db, p.id);
  return {
    id: p.id,
    livemode: p.mode === 'LIVE',
    status: p.status.toLowerCase(),
    merchant_name: app?.name ?? 'Merchant',
    order_id: p.orderId,
    description: p.description,
    amount: fmt(p.amount),
    currency: p.currency,
    settlement: { coin: p.settleCoin, network: p.settleNetwork, expected_amount: fmt(p.settleExpected) },
    expires_at: p.expiresAt.toISOString(),
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    swap: swap ? publicSwap(ctx, swap) : null,
  };
}

function assertPayable(p: Payment) {
  if (p.status !== 'PENDING') throw conflict(`Payment is ${p.status.toLowerCase()}`);
  if (p.expiresAt.getTime() <= Date.now()) throw conflict('Payment has expired');
}

interface StoredQuote {
  paymentId: string;
  quote: Quote;
}

export async function quoteForCheckout(ctx: Ctx, id: string, from: AssetRef, userIp: string) {
  const p = await loadPayment(ctx, id);
  assertPayable(p);
  const { quotes, failures } = await getRankedQuotes(ctx, {
    mode: p.mode,
    from,
    to: { coin: p.settleCoin, network: p.settleNetwork },
    settleAmount: fmt(p.settleExpected),
    userIp,
  });
  const out = [];
  for (const q of quotes) {
    const ref = newId('qt', 24);
    const ttl = Math.max(30, (new Date(q.expiresAt).getTime() - Date.now()) / 1000);
    await ctx.kv.set(`quote:${ref}`, JSON.stringify({ paymentId: p.id, quote: q } satisfies StoredQuote), ttl);
    out.push({
      ref,
      provider: q.provider,
      provider_name: ctx.providers.get(q.provider)?.name ?? q.provider,
      deposit_coin: q.from.coin,
      deposit_network: q.from.network,
      deposit_amount: fmt(q.depositAmount),
      settle_amount: fmt(q.settleAmount),
      rate: fmt(q.rate),
      expires_at: q.expiresAt,
    });
  }
  if (failures.length) ctx.log.info({ payment: p.id, failures }, 'some providers returned no quote');
  return { quotes: out, compared: quotes.length + failures.length };
}

export async function startSwap(ctx: Ctx, id: string, quoteRef: string, refundAddress: string | null, userIp: string) {
  const p = await loadPayment(ctx, id);
  assertPayable(p);
  const raw = await ctx.kv.take(`quote:${quoteRef}`);
  if (!raw) throw new AppError(410, 'quote_expired', 'Quote expired, please refresh');
  const { paymentId, quote } = JSON.parse(raw) as StoredQuote;
  if (paymentId !== p.id) throw badRequest('Quote does not belong to this payment');
  if (new Date(quote.expiresAt).getTime() < Date.now() + 15_000) {
    throw new AppError(410, 'quote_expired', 'Quote expired, please refresh');
  }
  const provider = ctx.providers.get(quote.provider);
  if (!provider) throw badRequest('Unknown provider');

  const swapId = newId('swp', 20);
  let order;
  try {
    order = await provider.createSwap({
      quote,
      settleAddress: p.settleAddress,
      settleMemo: p.settleMemo,
      refundAddress,
      userIp,
      externalId: swapId,
    });
  } catch (err) {
    await recordProviderFailure(ctx, provider.id, err);
    const msg = err instanceof ProviderError ? err.message : 'Exchange provider error';
    throw new AppError(502, 'provider_error', msg);
  }

  const [swap] = await ctx.db
    .insert(swaps)
    .values({
      id: swapId,
      paymentId: p.id,
      provider: provider.id,
      providerOrderId: order.providerOrderId,
      providerToken: order.providerToken,
      depositCoin: quote.from.coin,
      depositNetwork: quote.from.network,
      depositAddress: order.depositAddress,
      depositMemo: order.depositMemo,
      depositAmount: order.depositAmount,
      settleAmount: order.settleAmount,
      rate: quote.rate,
      refundAddress,
      quoteExpiresAt: new Date(order.expiresAt),
      providerStatus: order.providerStatus,
      raw: order.raw as object,
      nextPollAt: new Date(Date.now() + 10_000),
    })
    .returning();
  return publicSwap(ctx, swap!);
}
