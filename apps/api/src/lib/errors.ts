export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'invalid_request', message, details);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Forbidden') => new AppError(403, 'forbidden', message);

/** SQLite UNIQUE/PRIMARY KEY violation; drizzle wraps driver errors, so check the cause chain. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code?.startsWith('SQLITE_CONSTRAINT_PRIMARYKEY') || e.code?.startsWith('SQLITE_CONSTRAINT_UNIQUE')) return true;
    if (e.message?.includes('UNIQUE constraint failed')) return true;
  }
  return false;
}

/** Case-insensitive substring match with LIKE wildcards in the user's input escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, '\\$&')}%`;
}
