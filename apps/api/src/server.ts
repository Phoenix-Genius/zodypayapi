import { buildApp } from './app.js';
import { createContext } from './bootstrap.js';
import { startInProcessJobs } from './jobs.js';

const { ctx, redis, close } = await createContext('api');
const app = await buildApp(ctx);
// With Redis, the separate BullMQ worker (worker.ts) runs the jobs; without it, this process does.
const stopJobs = redis ? null : startInProcessJobs(ctx);

const shutdown = async () => {
  stopJobs?.();
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: ctx.config.PORT, host: ctx.config.HOST });
