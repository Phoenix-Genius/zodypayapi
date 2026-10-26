import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createSession, destroySession, requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { AppError, conflict, forbidden } from '../lib/errors.js';
import { newId } from '../lib/ids.js';

const credentials = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

// Verified against when the email is unknown so login timing doesn't reveal which accounts exist.
const DUMMY_HASH = await hashPassword('timing-equaliser-not-a-real-password');

export const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  role: u.role.toLowerCase(),
  created_at: u.createdAt.toISOString(),
});

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const limited = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  r.post('/register', { schema: { body: credentials }, config: limited }, async (req, reply) => {
    if (!ctx.config.ALLOW_REGISTRATION) throw forbidden('Registration is closed');
    const { email, password } = req.body;
    const [existing] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) throw conflict('An account with this email already exists');
    // The very first account becomes the platform admin.
    const [{ n }] = (await ctx.db.select({ n: count() }).from(users)) as [{ n: number }];
    const [user] = await ctx.db
      .insert(users)
      .values({ id: newId('usr', 20), email, passwordHash: await hashPassword(password), role: n === 0 ? 'ADMIN' : 'MERCHANT' })
      .returning();
    await createSession(ctx, reply, user!.id);
    return reply.status(201).send({ user: publicUser(user!) });
  });

  r.post('/login', { schema: { body: credentials }, config: limited }, async (req, reply) => {
    const { email, password } = req.body;
    const [user] = await ctx.db.select().from(users).where(eq(users.email, email));
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || user.disabledAt) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    await createSession(ctx, reply, user.id);
    return { user: publicUser(user) };
  });

  r.post('/logout', async (req, reply) => {
    await destroySession(ctx, req, reply);
    return { ok: true };
  });

  r.get('/me', { preHandler: requireUser(ctx) }, async (req) => ({ user: publicUser(req.user!) }));
}
