import { and, count, desc, eq, gte, inArray, or, sql, type SQLWrapper } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { apps, payments, providerConfigs, swaps, users, webhookDeliveries } from '../db/schema.js';
import { badRequest, likePattern, notFound } from '../lib/errors.js';
import { modeParam } from '../lib/validation.js';
import { pollSwap } from '../services/payments.js';
import { getCatalog, setProviderConfig } from '../services/providers.js';
import { publicUser } from './auth.js';
import { PAYMENT_STATUSES, listPayments, paymentDetail, publicDelivery } from './shared.js';

// SQLite LIKE is case-insensitive for ASCII.
const contains = (col: SQLWrapper, q: string) => sql`${col} LIKE ${likePattern(q)} ESCAPE '\\'`;

export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('onRequest', requireUser(ctx, { admin: true }));

  async function providerHealth() {
    const since = new Date(Date.now() - 7 * 86400_000);
    const [configs, swapStats] = await Promise.all([
      ctx.db.select().from(providerConfigs),
      ctx.db
        .select({ provider: swaps.provider, status: swaps.status, n: count() })
        .from(swaps)
        .where(gte(swaps.createdAt, since))
        .groupBy(swaps.provider, swaps.status),
    ]);
    const live = new Set(ctx.providers.forMode('LIVE').map((p) => p.id));
    return ctx.providers.all().map((p) => {
      const c = configs.find((x) => x.id === p.id);
      const stats = Object.fromEntries(swapStats.filter((s) => s.provider === p.id).map((s) => [s.status.toLowerCase(), s.n]));
      const settled = stats.settled ?? 0;
      const failed = (stats.failed ?? 0) + (stats.refunded ?? 0);
      return {
        id: p.id,
        name: p.name,
        livemode: live.has(p.id),
        enabled: c?.enabled ?? true,
        priority: c?.priority ?? 0,
        breaker_open_until: c?.disabledUntil && c.disabledUntil > new Date() ? c.disabledUntil.toISOString() : null,
        last_error: c?.lastError ?? null,
        last_error_at: c?.lastErrorAt?.toISOString() ?? null,
        swaps_7d: stats,
        success_rate_7d: settled + failed ? Math.round((settled / (settled + failed)) * 1000) / 10 : null,
      };
    });
  }

  r.get('/overview', async () => {
    const day = new Date(Date.now() - 86400_000);
    const [[u], [a], byStatus, failedDeliveries, stuckSwaps] = await Promise.all([
      ctx.db.select({ n: count() }).from(users),
      ctx.db.select({ n: count() }).from(apps),
      ctx.db
        .select({ mode: payments.mode, status: payments.status, n: count() })
        .from(payments)
        .where(gte(payments.createdAt, day))
        .groupBy(payments.mode, payments.status),
      ctx.db.select({ n: count() }).from(webhookDeliveries).where(eq(webhookDeliveries.status, 'FAILED')),
      ctx.db
        .select()
        .from(swaps)
        .where(inArray(swaps.status, ['ON_HOLD', 'REFUNDING', 'FAILED']))
        .orderBy(desc(swaps.updatedAt))
        .limit(20),
    ]);
    return {
      users: u?.n ?? 0,
      apps: a?.n ?? 0,
      payments_24h: byStatus.map((s) => ({ mode: s.mode.toLowerCase(), status: s.status.toLowerCase(), count: s.n })),
      failed_webhooks: failedDeliveries[0]?.n ?? 0,
      attention_swaps: stuckSwaps.map((s) => ({
        id: s.id,
        payment_id: s.paymentId,
        provider: s.provider,
        status: s.status.toLowerCase(),
        provider_status: s.providerStatus,
        updated_at: s.updatedAt.toISOString(),
      })),
      providers: await providerHealth(),
    };
  });

  r.get('/users', { schema: { querystring: z.object({ q: z.string().max(254).optional() }) } }, async (req) => {
    const rows = await ctx.db
      .select({
        user: users,
        apps: sql<number>`(select count(*) from apps where apps.owner_id = ${users.id})`,
      })
      .from(users)
      .where(req.query.q ? contains(users.email, req.query.q) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(100);
    return { data: rows.map((r) => ({ ...publicUser(r.user), disabled: !!r.user.disabledAt, app_count: r.apps })) };
  });

  r.patch(
    '/users/:id',
    {
      schema: {
        params: z.object({ id: z.string().max(64) }),
        body: z.object({ disabled: z.boolean().optional(), role: z.enum(['merchant', 'admin']).optional() }),
      },
    },
    async (req) => {
      if (req.params.id === req.user!.id && (req.body.disabled || req.body.role === 'merchant')) {
        throw badRequest('You cannot demote or disable your own account');
      }
      const [row] = await ctx.db
        .update(users)
        .set({
          ...(req.body.disabled !== undefined && { disabledAt: req.body.disabled ? new Date() : null }),
          ...(req.body.role && { role: req.body.role === 'admin' ? ('ADMIN' as const) : ('MERCHANT' as const) }),
        })
        .where(eq(users.id, req.params.id))
        .returning();
      if (!row) throw notFound('User');
      return { ...publicUser(row), disabled: !!row.disabledAt };
    },
  );

  r.get('/apps', { schema: { querystring: z.object({ q: z.string().max(128).optional() }) } }, async (req) => {
    const q = req.query.q;
    const rows = await ctx.db
      .select({ app: apps, owner: users.email })
      .from(apps)
      .innerJoin(users, eq(users.id, apps.ownerId))
      .where(q ? or(contains(apps.name, q), eq(apps.id, q), contains(users.email, q)) : undefined)
      .orderBy(desc(apps.createdAt))
      .limit(100);
    return {
      data: rows.map(({ app: a, owner }) => ({
        id: a.id,
        name: a.name,
        owner,
        settle: `${a.settleCoin}/${a.settleNetwork}`,
        webhook_url: a.webhookUrl,
        created_at: a.createdAt.toISOString(),
      })),
    };
  });

  r.get(
    '/payments',
    {
      schema: {
        querystring: z.object({
          mode: modeParam.optional(),
          status: z.enum(PAYMENT_STATUSES).optional(),
          q: z.string().max(128).optional(),
          before: z.iso.datetime().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (req) => listPayments(ctx, req.query),
  );

  r.get('/payments/:id', { schema: { params: z.object({ id: z.string().max(64) }) } }, async (req) =>
    paymentDetail(ctx, req.params.id),
  );

  r.post('/swaps/:id/poll', { schema: { params: z.object({ id: z.string().max(64) }) } }, async (req) => {
    const [s] = await ctx.db.select().from(swaps).where(eq(swaps.id, req.params.id));
    if (!s) throw notFound('Swap');
    await pollSwap(ctx, s);
    const [after] = await ctx.db.select().from(swaps).where(eq(swaps.id, s.id));
    return { status: after!.status.toLowerCase(), provider_status: after!.providerStatus };
  });

  r.get('/providers', async () => ({ data: await providerHealth() }));

  r.patch(
    '/providers/:id',
    {
      schema: {
        params: z.object({ id: z.string().max(64) }),
        body: z.object({
          enabled: z.boolean().optional(),
          priority: z.number().int().min(-100).max(100).optional(),
          reset_breaker: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      if (!ctx.providers.get(req.params.id)) throw notFound('Provider');
      await setProviderConfig(ctx, req.params.id, {
        enabled: req.body.enabled,
        priority: req.body.priority,
        resetBreaker: req.body.reset_breaker,
      });
      return { data: await providerHealth() };
    },
  );

  r.post('/providers/refresh-assets', async () => {
    const [live, test] = await Promise.all([getCatalog(ctx, 'LIVE', { refresh: true }), getCatalog(ctx, 'TEST', { refresh: true })]);
    return { live: live.length, test: test.length };
  });

  r.get(
    '/deliveries',
    { schema: { querystring: z.object({ status: z.enum(['pending', 'succeeded', 'failed']).default('failed') }) } },
    async (req) => {
      const rows = await ctx.db
        .select()
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.status, req.query.status.toUpperCase() as 'FAILED')))
        .orderBy(desc(webhookDeliveries.updatedAt))
        .limit(100);
      return { data: rows.map(publicDelivery) };
    },
  );
}
