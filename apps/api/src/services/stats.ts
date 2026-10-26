import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { payments, type Mode } from '../db/schema.js';
import { Decimal, fmt } from '../lib/money.js';

/**
 * Dashboard statistics for a set of apps over the last `days` days. Money is summed in JS with
 * decimal.js because SQLite's SUM() would go through floating point.
 */
export async function paymentStats(ctx: Ctx, appIds: string[], mode: Mode, days = 30) {
  if (!appIds.length) return { total: 0, paid: 0, conversion: 0, by_status: {}, volume: [], settled: [], daily: [] };
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await ctx.db
    .select({
      status: payments.status,
      amount: payments.amount,
      currency: payments.currency,
      settleCoin: payments.settleCoin,
      settleNetwork: payments.settleNetwork,
      settleReceived: payments.settleReceived,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(and(inArray(payments.appId, appIds), eq(payments.mode, mode), gte(payments.createdAt, since)));

  const byStatus: Record<string, number> = {};
  const volume = new Map<string, Decimal>();
  const settled = new Map<string, { coin: string; network: string; amount: Decimal }>();
  const daily = new Map<string, { day: string; created: number; paid: number }>();
  let paid = 0;

  for (const r of rows) {
    const status = r.status.toLowerCase();
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const day = r.createdAt.toISOString().slice(0, 10);
    const d = daily.get(day) ?? { day, created: 0, paid: 0 };
    d.created++;
    if (r.status === 'PAID' || r.status === 'UNDERPAID') {
      paid++;
      d.paid++;
      volume.set(r.currency, (volume.get(r.currency) ?? new Decimal(0)).plus(r.amount));
      const key = `${r.settleCoin}:${r.settleNetwork}`;
      const s = settled.get(key) ?? { coin: r.settleCoin, network: r.settleNetwork, amount: new Decimal(0) };
      s.amount = s.amount.plus(r.settleReceived ?? 0);
      settled.set(key, s);
    }
    daily.set(day, d);
  }

  return {
    total: rows.length,
    paid,
    conversion: rows.length ? Math.round((paid / rows.length) * 1000) / 10 : 0,
    by_status: byStatus,
    volume: [...volume].map(([currency, amount]) => ({ currency, amount: fmt(amount) })),
    settled: [...settled.values()].map((s) => ({ coin: s.coin, network: s.network, amount: fmt(s.amount) })),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
