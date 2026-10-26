import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from './context.js';
import { apiKeys, apps, sessions, users, type App, type Mode, type User } from './db/schema.js';
import { randomToken } from './lib/ids.js';
import { sha256 } from './lib/crypto.js';
import { AppError, forbidden, unauthorized } from './lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    merchant?: { app: App; mode: Mode; keyId: string };
  }
}

export const SESSION_COOKIE = 'zp_session';
const SESSION_TTL_MS = 30 * 86400_000;
/** Required on cookie-authenticated mutations; cross-site forms can't set custom headers. */
export const CSRF_HEADER = 'x-zp-csrf';

export async function createSession(ctx: Ctx, reply: FastifyReply, userId: string) {
  const token = randomToken(40);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await ctx.db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.COOKIE_SECURE,
    expires: expiresAt,
  });
}

export async function destroySession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await ctx.db.delete(sessions).where(eq(sessions.id, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireUser(ctx: Ctx, opts: { admin?: boolean } = {}) {
  return async (req: FastifyRequest) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw unauthorized();
    const [row] = await ctx.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
    if (!row || row.user.disabledAt) throw unauthorized();
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== '1') {
      throw new AppError(403, 'csrf', 'Missing CSRF header');
    }
    if (opts.admin && row.user.role !== 'ADMIN') throw forbidden();
    req.user = row.user;
  };
}

const lastUsedWrites = new Map<string, number>();

export function requireApiKey(ctx: Ctx) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!/^sk_(live|test)_[A-Za-z0-9]{32}$/.test(key)) throw unauthorized('Invalid API key');
    const [row] = await ctx.db
      .select({ key: apiKeys, app: apps })
      .from(apiKeys)
      .innerJoin(apps, eq(apps.id, apiKeys.appId))
      .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)));
    if (!row) throw unauthorized('Invalid API key');
    req.merchant = { app: row.app, mode: row.key.mode, keyId: row.key.id };
    // Throttle last-used bookkeeping to one write per key per minute.
    const last = lastUsedWrites.get(row.key.id) ?? 0;
    if (Date.now() - last > 60_000) {
      lastUsedWrites.set(row.key.id, Date.now());
      await ctx.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
    }
  };
}
