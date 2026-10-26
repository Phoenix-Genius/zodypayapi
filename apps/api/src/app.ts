import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Ctx } from './context.js';
import { AppError } from './lib/errors.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { checkoutRoutes } from './routes/checkout.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { publicRoutes } from './routes/public.js';
import { v1Routes } from './routes/v1.js';

export async function buildApp(ctx: Ctx) {
  const app = Fastify({
    loggerInstance: ctx.log,
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'invalid_request',
          message: 'Request validation failed',
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'invalid_request', message: err.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Internal server error' } });
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ZodyPay API',
        version: '1.0.0',
        description:
          'Create crypto payments and receive signed webhooks. Authenticate with `Authorization: Bearer sk_live_...` (or sk_test_ for test mode).',
      },
      components: {
        securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'Secret API key' } },
      },
      tags: [
        { name: 'Payments', description: 'Merchant API' },
        { name: 'Assets', description: 'Supported coins and networks' },
      ],
    },
    transform: jsonSchemaTransform,
    // Only the merchant API is part of the public contract.
    hideUntagged: true,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(async (r) => publicRoutes(r, ctx));
  await app.register(async (r) => authRoutes(r, ctx), { prefix: '/auth' });
  await app.register(async (r) => dashboardRoutes(r, ctx), { prefix: '/dashboard' });
  await app.register(async (r) => adminRoutes(r, ctx), { prefix: '/admin' });
  await app.register(async (r) => checkoutRoutes(r, ctx), { prefix: '/checkout' });
  await app.register(async (r) => v1Routes(r, ctx), { prefix: '/v1' });
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
