import { lt } from 'drizzle-orm';
import type { Ctx } from './context.js';
import { idempotencyKeys, sessions } from './db/schema.js';
import { expirePayments, pollDueSwaps } from './services/payments.js';
import { getCatalog } from './services/providers.js';
import { deliverDueWebhooks } from './services/webhooks.js';

/** Background jobs; run by the BullMQ worker, or in-process when Redis isn't configured. */
export const JOBS: Record<string, { everyMs: number; run: (ctx: Ctx) => Promise<unknown> }> = {
  'poll-swaps': { everyMs: 5_000, run: pollDueSwaps },
  'deliver-webhooks': { everyMs: 5_000, run: deliverDueWebhooks },
  'expire-payments': { everyMs: 30_000, run: expirePayments },
  'sync-assets': {
    everyMs: 3600_000,
    run: async (ctx) => {
      await getCatalog(ctx, 'LIVE', { refresh: true });
      await getCatalog(ctx, 'TEST', { refresh: true });
    },
  },
  cleanup: {
    everyMs: 6 * 3600_000,
    run: async (ctx) => {
      await ctx.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
      await ctx.db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(Date.now() - 7 * 86400_000)));
    },
  },
};

/** Simple timer loop for single-process deployments. Each job never overlaps with itself. */
export function startInProcessJobs(ctx: Ctx): () => void {
  const timers = Object.entries(JOBS).map(([name, job]) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run(ctx);
      } catch (err) {
        ctx.log.error({ job: name, err: String(err) }, 'job failed');
      } finally {
        running = false;
      }
    };
    if (name === 'sync-assets') void tick();
    return setInterval(tick, job.everyMs);
  });
  ctx.log.info({ jobs: Object.keys(JOBS) }, 'background jobs running in-process');
  return () => timers.forEach(clearInterval);
}
