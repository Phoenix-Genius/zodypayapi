import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireApiKey } from '../auth.js';
import type { Ctx } from '../context.js';
import { idempotencyKeys, payments } from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { AppError, isUniqueViolation, notFound } from '../lib/errors.js';
import { decimalString, httpUrl } from '../lib/validation.js';
import { cancelPayment, createPayment, latestSwapFor, publicPayment } from '../services/payments.js';
import { getCatalog } from '../services/providers.js';
import { PAYMENT_STATUSES, listPayments } from './shared.js';

const nullableString = z.string().nullable();

const SwapSchema = z.object({
  id: z.string(),
  provider: z.string(),
  provider_name: z.string(),
  status: z.string(),
  deposit_coin: z.string(),
  deposit_network: z.string(),
  deposit_address: z.string(),
  deposit_memo: nullableString,
  deposit_amount: z.string(),
  settle_amount: z.string(),
  settled_amount: nullableString,
  rate: z.string(),
  quote_expires_at: z.string(),
  deposit_tx_hash: nullableString,
  deposit_tx_url: nullableString,
  settle_tx_hash: nullableString,
  tracking_url: nullableString,
  created_at: z.string(),
});

export const PaymentSchema = z
  .object({
    id: z.string().describe('Payment id; also used in the checkout URL'),
    object: z.literal('payment'),
    livemode: z.boolean(),
    status: z.enum(PAYMENT_STATUSES),
    order_id: z.string(),
    amount: z.string(),
    currency: z.string(),
    description: nullableString,
    settlement: z.object({
      coin: z.string(),
      network: z.string(),
      address: z.string(),
      memo: nullableString,
      expected_amount: z.string().describe('Amount of the settlement coin the merchant must receive'),
      received_amount: nullableString,
      tx_hash: nullableString,
      tx_url: nullableString,
    }),
    swap: SwapSchema.nullable().describe('Most recent exchange attempt chosen by the customer'),
    checkout_url: z.string(),
    success_url: nullableString,
    cancel_url: nullableString,
    metadata: z.record(z.string(), z.string()),
    expires_at: z.string(),
    paid_at: nullableString,
    created_at: z.string(),
  })
  .meta({ id: 'Payment' });

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const CreatePaymentBody = z.object({
  amount: decimalString.describe('Decimal string in `currency`, e.g. "49.99"'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,12}$/)
    .describe('Fiat code (USD, EUR, ...) or a coin ticker'),
  order_id: z.string().trim().min(1).max(128).describe('Your order reference'),
  description: z.string().max(500).optional(),
  success_url: httpUrl.optional().describe('Where the customer is sent after paying'),
  cancel_url: httpUrl.optional(),
  metadata: z
    .record(z.string().max(40), z.string().max(500))
    .refine((m) => Object.keys(m).length <= 20, 'At most 20 metadata keys')
    .optional(),
  expires_in_minutes: z.number().int().min(15).max(1440).optional(),
});

const security = [{ apiKey: [] }];

export async function v1Routes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('onRequest', requireApiKey(ctx));

  async function loadOwn(req: { merchant?: { app: { id: string }; mode: 'LIVE' | 'TEST' } }, id: string) {
    const m = req.merchant!;
    const [p] = await ctx.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.appId, m.app.id), eq(payments.mode, m.mode)));
    if (!p) throw notFound('Payment');
    return p;
  }

  r.post(
    '/payments',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['Payments'],
        summary: 'Create a payment',
        description:
          'Creates a payment and returns a hosted `checkout_url`. Send an `Idempotency-Key` header to make retries safe.',
        security,
        headers: z.object({ 'idempotency-key': z.string().min(1).max(255).optional() }),
        body: CreatePaymentBody,
        response: { 201: PaymentSchema, 400: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { app: merchantApp, mode } = req.merchant!;
      const key = req.headers['idempotency-key'];
      const b = req.body;
      const input = {
        amount: b.amount,
        currency: b.currency,
        orderId: b.order_id,
        description: b.description,
        successUrl: b.success_url,
        cancelUrl: b.cancel_url,
        metadata: b.metadata,
        expiresInMinutes: b.expires_in_minutes,
      };
      if (!key) {
        const p = await createPayment(ctx, merchantApp, mode, input);
        return reply.status(201).send(publicPayment(ctx, p));
      }

      const requestHash = sha256(JSON.stringify({ mode, body: b }));
      const replay = async () => {
        const [prev] = await ctx.db
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.appId, merchantApp.id), eq(idempotencyKeys.key, key)));
        if (!prev) return false;
        if (prev.requestHash !== requestHash) {
          throw new AppError(409, 'idempotency_key_reused', 'Idempotency-Key was already used with a different request');
        }
        reply.header('idempotent-replayed', 'true');
        await reply.status(prev.responseCode as 201).send(prev.responseBody as z.infer<typeof PaymentSchema>);
        return true;
      };
      if (await replay()) return reply;
      try {
        const body = await ctx.db.transaction(async (tx) => {
          const p = await createPayment(ctx, merchantApp, mode, input, tx);
          const out = publicPayment(ctx, p);
          await tx.insert(idempotencyKeys).values({ appId: merchantApp.id, key, requestHash, responseCode: 201, responseBody: out });
          return out;
        });
        return reply.status(201).send(body);
      } catch (err) {
        // A concurrent request with the same key won the race; its transaction committed first.
        if (isUniqueViolation(err)) {
          if (await replay()) return reply;
        }
        throw err;
      }
    },
  );

  r.get(
    '/payments/:id',
    {
      schema: {
        tags: ['Payments'],
        summary: 'Retrieve a payment',
        security,
        params: z.object({ id: z.string().max(64) }),
        response: { 200: PaymentSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const p = await loadOwn(req, req.params.id);
      return publicPayment(ctx, p, await latestSwapFor(ctx.db, p.id));
    },
  );

  r.get(
    '/payments',
    {
      schema: {
        tags: ['Payments'],
        summary: 'List payments',
        description: 'Newest first. Use `next_before` from the response as `before` to fetch the next page.',
        security,
        querystring: z.object({
          order_id: z.string().max(128).optional(),
          status: z.enum(PAYMENT_STATUSES).optional(),
          before: z.iso.datetime().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
        response: {
          200: z.object({ data: z.array(PaymentSchema), has_more: z.boolean(), next_before: nullableString }),
        },
      },
    },
    async (req) => {
      const m = req.merchant!;
      return listPayments(ctx, {
        appIds: [m.app.id],
        mode: m.mode,
        status: req.query.status,
        q: req.query.order_id,
        before: req.query.before,
        limit: req.query.limit,
      });
    },
  );

  r.post(
    '/payments/:id/cancel',
    {
      schema: {
        tags: ['Payments'],
        summary: 'Cancel a pending payment',
        description: 'Only payments where the customer has not yet sent funds can be canceled.',
        security,
        params: z.object({ id: z.string().max(64) }),
        response: { 200: PaymentSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req) => {
      const p = await loadOwn(req, req.params.id);
      const canceled = await cancelPayment(ctx, p.id);
      if (!canceled) throw new AppError(409, 'not_cancelable', `Payment is ${p.status.toLowerCase()}`);
      return publicPayment(ctx, canceled);
    },
  );

  r.get(
    '/assets',
    {
      schema: {
        tags: ['Assets'],
        summary: 'List supported assets',
        description: 'Coins/networks customers can currently pay with, and which can be used for settlement.',
        security,
        response: {
          200: z.object({
            data: z.array(
              z.object({
                coin: z.string(),
                network: z.string(),
                name: z.string(),
                network_name: z.string(),
                can_pay: z.boolean(),
                can_settle: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const catalog = await getCatalog(ctx, req.merchant!.mode);
      return {
        data: catalog.map((a) => ({
          coin: a.coin,
          network: a.network,
          name: a.name,
          network_name: a.networkName,
          can_pay: a.deposit.length > 0,
          can_settle: a.settle.length > 0,
        })),
      };
    },
  );
}
