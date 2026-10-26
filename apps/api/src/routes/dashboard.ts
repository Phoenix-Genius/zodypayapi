import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { apiKeys, apps, webhookDeliveries, type App, type User } from '../db/schema.js';
import { generateApiKey, generateWebhookSecret } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { validateWebhookUrl } from '../lib/ssrf.js';
import { coinCode, cryptoAddress, decimalString, memo, modeParam, networkId } from '../lib/validation.js';
import { createPayment, publicPayment } from '../services/payments.js';
import { getCatalog } from '../services/providers.js';
import { paymentStats } from '../services/stats.js';
import { resendDelivery, sendTestWebhook } from '../services/webhooks.js';
import { PAYMENT_STATUSES, listPayments, paymentDetail, publicDelivery } from './shared.js';

const settlement = {
  settle_coin: coinCode,
  settle_network: networkId,
  settle_address: cryptoAddress,
  settle_memo: memo.nullish(),
};

const appParams = z.object({ appId: z.string().max(64) });

function publicApp(a: App) {
  return {
    id: a.id,
    name: a.name,
    webhook_url: a.webhookUrl,
    settle_coin: a.settleCoin,
    settle_network: a.settleNetwork,
    settle_address: a.settleAddress,
    settle_memo: a.settleMemo,
    underpay_tolerance_bps: a.underpayTolBps,
    created_at: a.createdAt.toISOString(),
  };
}

export async function dashboardRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('onRequest', requireUser(ctx));

  const ownedAppIds = async (user: User) =>
    (await ctx.db.select({ id: apps.id }).from(apps).where(eq(apps.ownerId, user.id))).map((a) => a.id);

  async function loadApp(user: User, appId: string): Promise<App> {
    const [a] = await ctx.db.select().from(apps).where(eq(apps.id, appId));
    if (!a || (a.ownerId !== user.id && user.role !== 'ADMIN')) throw notFound('App');
    return a;
  }

  const checkWebhookUrl = (url: string | null | undefined) => {
    if (!url) return;
    const err = validateWebhookUrl(url, {
      allowPrivate: ctx.config.ALLOW_PRIVATE_WEBHOOKS,
      requireHttps: ctx.config.NODE_ENV === 'production',
    });
    if (err) throw badRequest(err);
  };

  r.get('/overview', { schema: { querystring: z.object({ mode: modeParam }) } }, async (req) => {
    const ids = await ownedAppIds(req.user!);
    return { app_count: ids.length, stats: await paymentStats(ctx, ids, req.query.mode) };
  });

  /** Assets a merchant can choose as settlement currency. */
  r.get('/assets', async () => {
    const live = await getCatalog(ctx, 'LIVE');
    const test = await getCatalog(ctx, 'TEST');
    const pick = (c: typeof live) =>
      c.filter((a) => a.settle.length).map((a) => ({ coin: a.coin, network: a.network, name: a.name, network_name: a.networkName, has_memo: a.hasMemo }));
    return { live: pick(live), test: pick(test) };
  });

  r.get('/apps', async (req) => {
    const rows = await ctx.db.select().from(apps).where(eq(apps.ownerId, req.user!.id)).orderBy(desc(apps.createdAt));
    return { data: rows.map(publicApp) };
  });

  r.post(
    '/apps',
    { schema: { body: z.object({ name: z.string().trim().min(1).max(80), webhook_url: z.string().max(2048).nullish(), ...settlement }) } },
    async (req, reply) => {
      const b = req.body;
      checkWebhookUrl(b.webhook_url);
      const [row] = await ctx.db
        .insert(apps)
        .values({
          id: newId('app', 16),
          ownerId: req.user!.id,
          name: b.name,
          webhookUrl: b.webhook_url || null,
          webhookSecretEnc: ctx.encryptor.encrypt(generateWebhookSecret()),
          settleCoin: b.settle_coin,
          settleNetwork: b.settle_network,
          settleAddress: b.settle_address,
          settleMemo: b.settle_memo || null,
        })
        .returning();
      return reply.status(201).send(publicApp(row!));
    },
  );

  r.get('/apps/:appId', { schema: { params: appParams } }, async (req) => publicApp(await loadApp(req.user!, req.params.appId)));

  r.patch(
    '/apps/:appId',
    {
      schema: {
        params: appParams,
        body: z
          .object({
            name: z.string().trim().min(1).max(80),
            webhook_url: z.string().max(2048).nullable(),
            underpay_tolerance_bps: z.number().int().min(0).max(500),
            ...settlement,
          })
          .partial(),
      },
    },
    async (req) => {
      const a = await loadApp(req.user!, req.params.appId);
      const b = req.body;
      checkWebhookUrl(b.webhook_url);
      const [row] = await ctx.db
        .update(apps)
        .set({
          ...(b.name !== undefined && { name: b.name }),
          ...(b.webhook_url !== undefined && { webhookUrl: b.webhook_url || null }),
          ...(b.underpay_tolerance_bps !== undefined && { underpayTolBps: b.underpay_tolerance_bps }),
          ...(b.settle_coin !== undefined && { settleCoin: b.settle_coin }),
          ...(b.settle_network !== undefined && { settleNetwork: b.settle_network }),
          ...(b.settle_address !== undefined && { settleAddress: b.settle_address }),
          ...(b.settle_memo !== undefined && { settleMemo: b.settle_memo || null }),
          updatedAt: new Date(),
        })
        .where(eq(apps.id, a.id))
        .returning();
      return publicApp(row!);
    },
  );

  r.get('/apps/:appId/webhook-secret', { schema: { params: appParams } }, async (req) => {
    const a = await loadApp(req.user!, req.params.appId);
    return { secret: ctx.encryptor.decrypt(a.webhookSecretEnc) };
  });

  r.post('/apps/:appId/webhook-secret/rotate', { schema: { params: appParams } }, async (req) => {
    const a = await loadApp(req.user!, req.params.appId);
    const secret = generateWebhookSecret();
    await ctx.db.update(apps).set({ webhookSecretEnc: ctx.encryptor.encrypt(secret), updatedAt: new Date() }).where(eq(apps.id, a.id));
    return { secret };
  });

  r.post('/apps/:appId/webhook-test', { schema: { params: appParams } }, async (req) => {
    const a = await loadApp(req.user!, req.params.appId);
    return sendTestWebhook(ctx, a);
  });

  r.get('/apps/:appId/keys', { schema: { params: appParams } }, async (req) => {
    const a = await loadApp(req.user!, req.params.appId);
    const rows = await ctx.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.appId, a.id), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
    return {
      data: rows.map((k) => ({
        id: k.id,
        mode: k.mode.toLowerCase(),
        prefix: k.prefix,
        last_used_at: k.lastUsedAt?.toISOString() ?? null,
        created_at: k.createdAt.toISOString(),
      })),
    };
  });

  r.post(
    '/apps/:appId/keys',
    { schema: { params: appParams, body: z.object({ mode: z.enum(['live', 'test']) }) } },
    async (req, reply) => {
      const a = await loadApp(req.user!, req.params.appId);
      const mode = req.body.mode === 'live' ? 'LIVE' : 'TEST';
      const { key, prefix, hash } = generateApiKey(mode);
      const id = newId('key', 16);
      await ctx.db.insert(apiKeys).values({ id, appId: a.id, mode, prefix, keyHash: hash });
      // The full key is shown exactly once.
      return reply.status(201).send({ id, mode: req.body.mode, prefix, key });
    },
  );

  r.delete(
    '/apps/:appId/keys/:keyId',
    { schema: { params: appParams.extend({ keyId: z.string().max(64) }) } },
    async (req) => {
      const a = await loadApp(req.user!, req.params.appId);
      const res = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, req.params.keyId), eq(apiKeys.appId, a.id), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });
      if (!res.length) throw notFound('API key');
      return { revoked: true };
    },
  );

  r.get(
    '/apps/:appId/payments',
    {
      schema: {
        params: appParams,
        querystring: z.object({
          mode: modeParam,
          status: z.enum(PAYMENT_STATUSES).optional(),
          q: z.string().max(128).optional(),
          before: z.iso.datetime().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (req) => {
      const a = await loadApp(req.user!, req.params.appId);
      return listPayments(ctx, { ...req.query, appIds: [a.id] });
    },
  );

  r.get(
    '/apps/:appId/payments/:paymentId',
    { schema: { params: appParams.extend({ paymentId: z.string().max(64) }) } },
    async (req) => {
      const a = await loadApp(req.user!, req.params.appId);
      return paymentDetail(ctx, req.params.paymentId, [a.id]);
    },
  );

  // Lets merchants try the hosted checkout in test mode without writing any code.
  r.post(
    '/apps/:appId/test-payments',
    {
      schema: {
        params: appParams,
        body: z.object({
          amount: decimalString,
          currency: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/),
          description: z.string().max(500).optional(),
        }),
      },
    },
    async (req, reply) => {
      const a = await loadApp(req.user!, req.params.appId);
      const p = await createPayment(ctx, a, 'TEST', {
        amount: req.body.amount,
        currency: req.body.currency,
        description: req.body.description ?? 'Dashboard test payment',
        orderId: `test-${Date.now()}`,
      });
      return reply.status(201).send(publicPayment(ctx, p));
    },
  );

  r.get(
    '/apps/:appId/stats',
    { schema: { params: appParams, querystring: z.object({ mode: modeParam, days: z.coerce.number().int().min(1).max(365).default(30) }) } },
    async (req) => {
      const a = await loadApp(req.user!, req.params.appId);
      return paymentStats(ctx, [a.id], req.query.mode, req.query.days);
    },
  );

  r.get(
    '/apps/:appId/deliveries',
    { schema: { params: appParams, querystring: z.object({ status: z.enum(['pending', 'succeeded', 'failed']).optional() }) } },
    async (req) => {
      const a = await loadApp(req.user!, req.params.appId);
      const rows = await ctx.db
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.appId, a.id),
            req.query.status
              ? inArray(webhookDeliveries.status, [req.query.status.toUpperCase() as 'PENDING'])
              : undefined,
          ),
        )
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(100);
      return { data: rows.map(publicDelivery) };
    },
  );

  r.post(
    '/apps/:appId/deliveries/:deliveryId/resend',
    { schema: { params: appParams.extend({ deliveryId: z.string().max(64) }) } },
    async (req) => {
      const a = await loadApp(req.user!, req.params.appId);
      return resendDelivery(ctx, a.id, req.params.deliveryId);
    },
  );
}
