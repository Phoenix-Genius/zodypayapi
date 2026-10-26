import { Queue, Worker } from 'bullmq';
import { createContext } from './bootstrap.js';
import { JOBS } from './jobs.js';

/**
 * BullMQ worker for multi-process deployments (requires REDIS_URL). Each scheduler tick runs on
 * exactly one worker, and jobs claim rows with atomic leases, so several workers are safe.
 */
const { ctx, redis, close } = await createContext('worker');
if (!redis) {
  ctx.log.error('REDIS_URL is not set; the API runs jobs in-process, so this worker is not needed');
  process.exit(1);
}

const QUEUE = 'zodypay-jobs';
const queue = new Queue(QUEUE, { connection: redis });

for (const [name, job] of Object.entries(JOBS)) {
  await queue.upsertJobScheduler(name, { every: job.everyMs }, {
    name,
    opts: { removeOnComplete: 100, removeOnFail: 500 },
  });
}

const worker = new Worker(
  QUEUE,
  async (j) => {
    const job = JOBS[j.name];
    if (!job) return;
    return job.run(ctx);
  },
  { connection: redis.duplicate(), concurrency: Object.keys(JOBS).length },
);
worker.on('failed', (j, err) => ctx.log.error({ job: j?.name, err: err.message }, 'job failed'));
ctx.log.info({ jobs: Object.keys(JOBS) }, 'worker started');

// Warm the asset catalog right away instead of waiting an hour for the first sync.
JOBS['sync-assets']!.run(ctx).catch((err) => ctx.log.warn({ err: String(err) }, 'initial asset sync failed'));

const shutdown = async () => {
  await worker.close();
  await queue.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
