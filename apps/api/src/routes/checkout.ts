import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { coinCode, cryptoAddress, networkId } from '../lib/validation.js';
import { checkoutView, depositOptions, loadPayment, quoteForCheckout, startSwap } from '../services/checkout.js';

/**
 * Public endpoints used by the hosted payment page. The unguessable payment id is the
 * capability; responses never include merchant secrets.
 */
export async function checkoutRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ id: z.string().regex(/^pay_[A-Za-z0-9]{24}$/) });

  r.get('/:id', { schema: { params }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) =>
    checkoutView(ctx, req.params.id),
  );

  r.get('/:id/options', { schema: { params }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const p = await loadPayment(ctx, req.params.id);
    return { options: await depositOptions(ctx, p) };
  });

  r.post(
    '/:id/quotes',
    {
      schema: { params, body: z.object({ coin: coinCode, network: networkId }) },
      // Each call fans out to every provider, so keep this tight.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => quoteForCheckout(ctx, req.params.id, req.body, req.ip),
  );

  r.post(
    '/:id/swaps',
    {
      schema: {
        params,
        body: z.object({ quote_ref: z.string().regex(/^qt_[A-Za-z0-9]{24}$/), refund_address: cryptoAddress.nullish() }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const swap = await startSwap(ctx, req.params.id, req.body.quote_ref, req.body.refund_address ?? null, req.ip);
      return reply.status(201).send(swap);
    },
  );
}
