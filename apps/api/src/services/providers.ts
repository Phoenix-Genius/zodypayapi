import { eq } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import { providerConfigs, type Mode } from '../db/schema.js';
import { Decimal } from '../lib/money.js';
import { NETWORKS } from '../providers/networks.js';
import { ProviderError, type AssetRef, type Quote, type SwapProvider } from '../providers/types.js';

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
const QUOTE_TIMEOUT_MS = 6000;

type ProviderConfigRow = typeof providerConfigs.$inferSelect;
let configCache: { at: number; rows: Map<string, ProviderConfigRow> } | null = null;
const consecutiveFailures = new Map<string, number>();

async function loadConfigs(ctx: Ctx): Promise<Map<string, ProviderConfigRow>> {
  if (configCache && Date.now() - configCache.at < 10_000) return configCache.rows;
  const rows = await ctx.db.select().from(providerConfigs);
  configCache = { at: Date.now(), rows: new Map(rows.map((r) => [r.id, r])) };
  return configCache.rows;
}

export function invalidateProviderConfigCache() {
  configCache = null;
}

/** Providers for a mode that are enabled by the admin and not tripped by the circuit breaker. */
export async function activeProviders(ctx: Ctx, mode: Mode): Promise<SwapProvider[]> {
  const configs = await loadConfigs(ctx);
  const now = Date.now();
  return ctx.providers
    .forMode(mode)
    .filter((p) => {
      const c = configs.get(p.id);
      return !c || (c.enabled && (!c.disabledUntil || c.disabledUntil.getTime() < now));
    })
    .sort((a, b) => (configs.get(b.id)?.priority ?? 0) - (configs.get(a.id)?.priority ?? 0));
}

export async function recordProviderSuccess(providerId: string) {
  consecutiveFailures.set(providerId, 0);
}

export async function recordProviderFailure(ctx: Ctx, providerId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const isHealthIssue = !(err instanceof ProviderError) || err.kind === 'unavailable';
  if (!isHealthIssue) return;
  const count = (consecutiveFailures.get(providerId) ?? 0) + 1;
  consecutiveFailures.set(providerId, count);
  const tripped = count >= BREAKER_THRESHOLD;
  const values = {
    lastError: message.slice(0, 500),
    lastErrorAt: new Date(),
    updatedAt: new Date(),
    ...(tripped ? { disabledUntil: new Date(Date.now() + BREAKER_COOLDOWN_MS) } : {}),
  };
  await ctx.db
    .insert(providerConfigs)
    .values({ id: providerId, ...values })
    .onConflictDoUpdate({ target: providerConfigs.id, set: values });
  if (tripped) {
    consecutiveFailures.set(providerId, 0);
    invalidateProviderConfigCache();
    ctx.log.warn({ provider: providerId, err: message }, 'provider circuit breaker tripped');
  }
}

export interface CatalogAsset extends AssetRef {
  name: string;
  networkName: string;
  hasMemo: boolean;
  /** Provider ids that accept this asset as a deposit / can pay it out. */
  deposit: string[];
  settle: string[];
}

/** Union of all providers' assets for a mode, cached for an hour. */
export async function getCatalog(ctx: Ctx, mode: Mode, opts: { refresh?: boolean } = {}): Promise<CatalogAsset[]> {
  const key = `catalog:${mode}`;
  if (!opts.refresh) {
    const cached = await ctx.kv.get(key);
    if (cached) return JSON.parse(cached) as CatalogAsset[];
  }
  const merged = new Map<string, CatalogAsset>();
  const results = await Promise.allSettled(ctx.providers.forMode(mode).map(async (p) => ({ p, assets: await p.listAssets() })));
  let anyOk = false;
  for (const r of results) {
    if (r.status === 'rejected') {
      ctx.log.warn({ err: String(r.reason) }, 'asset sync failed');
      continue;
    }
    anyOk = true;
    for (const a of r.value.assets) {
      const k = `${a.coin}:${a.network}`;
      const entry = merged.get(k) ?? {
        coin: a.coin,
        network: a.network,
        name: a.name,
        networkName: NETWORKS[a.network]?.name ?? a.network,
        hasMemo: a.hasMemo,
        deposit: [],
        settle: [],
      };
      if (a.canDeposit) entry.deposit.push(r.value.p.id);
      if (a.canSettle) entry.settle.push(r.value.p.id);
      entry.hasMemo ||= a.hasMemo;
      merged.set(k, entry);
    }
  }
  const list = [...merged.values()].sort((a, b) => a.coin.localeCompare(b.coin) || a.network.localeCompare(b.network));
  // Don't cache an empty catalog caused by a transient outage for a full hour.
  await ctx.kv.set(key, JSON.stringify(list), anyOk ? 3600 : 60);
  return list;
}

export interface RankedQuotes {
  quotes: Quote[];
  failures: { provider: string; kind: string; message: string }[];
}

/**
 * Asks every eligible provider for a fixed-rate quote that delivers exactly `settleAmount`,
 * then ranks by what the customer pays (lowest deposit first). Provider priority breaks ties.
 */
export async function getRankedQuotes(
  ctx: Ctx,
  req: { mode: Mode; from: AssetRef; to: AssetRef; settleAmount: string; userIp: string },
): Promise<RankedQuotes> {
  const catalog = await getCatalog(ctx, req.mode);
  const fromEntry = catalog.find((a) => a.coin === req.from.coin && a.network === req.from.network);
  const toEntry = catalog.find((a) => a.coin === req.to.coin && a.network === req.to.network);
  const providers = (await activeProviders(ctx, req.mode)).filter(
    (p) => fromEntry?.deposit.includes(p.id) && toEntry?.settle.includes(p.id),
  );

  const quotes: Quote[] = [];
  const failures: RankedQuotes['failures'] = [];
  await Promise.all(
    providers.map(async (p) => {
      try {
        const q = await withTimeout(p.quote(req), QUOTE_TIMEOUT_MS, p.id);
        // Never accept a quote that delivers less than the invoice requires.
        if (new Decimal(q.settleAmount).lt(req.settleAmount)) {
          throw new ProviderError(p.id, 'unsupported', `Quote settles ${q.settleAmount} < ${req.settleAmount}`);
        }
        await recordProviderSuccess(p.id);
        quotes.push(q);
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(p.id, 'unavailable', String(err));
        failures.push({ provider: p.id, kind: pe.kind, message: pe.message });
        await recordProviderFailure(ctx, p.id, pe);
      }
    }),
  );
  const order = new Map(providers.map((p, i) => [p.id, i]));
  quotes.sort(
    (a, b) =>
      new Decimal(a.depositAmount).cmp(b.depositAmount) || (order.get(a.provider) ?? 0) - (order.get(b.provider) ?? 0),
  );
  return { quotes, failures };
}

function withTimeout<T>(p: Promise<T>, ms: number, provider: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError(provider, 'unavailable', `timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function setProviderConfig(ctx: Ctx, id: string, patch: { enabled?: boolean; priority?: number; resetBreaker?: boolean }) {
  const values = {
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.resetBreaker ? { disabledUntil: null } : {}),
    updatedAt: new Date(),
  };
  await ctx.db.insert(providerConfigs).values({ id, ...values }).onConflictDoUpdate({ target: providerConfigs.id, set: values });
  invalidateProviderConfigCache();
  return (await ctx.db.select().from(providerConfigs).where(eq(providerConfigs.id, id)))[0];
}
