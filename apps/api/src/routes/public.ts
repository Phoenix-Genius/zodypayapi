import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { modeParam } from '../lib/validation.js';
import { getCatalog } from '../services/providers.js';

export async function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Powers the public "supported coins" page.
  r.get('/public/assets', { schema: { querystring: z.object({ mode: modeParam.optional() }) } }, async (req) => {
    const mode = req.query.mode ?? (ctx.providers.forMode('LIVE').length ? 'LIVE' : 'TEST');
    const catalog = await getCatalog(ctx, mode);
    return {
      livemode: mode === 'LIVE',
      assets: catalog.map((a) => ({
        coin: a.coin,
        network: a.network,
        name: a.name,
        network_name: a.networkName,
        can_pay: a.deposit.length > 0,
        can_settle: a.settle.length > 0,
      })),
    };
  });
}
