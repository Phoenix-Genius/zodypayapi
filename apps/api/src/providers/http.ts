import { ProviderError } from './types.js';

export type FetchFn = typeof fetch;

/** JSON request with timeout; maps transport/5xx failures to `unavailable` and 4xx to `rejected`. */
export async function requestJson<T>(
  fetchFn: FetchFn,
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 8000) });
  } catch (err) {
    throw new ProviderError(provider, 'unavailable', (err as Error).message);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body; handled below
  }
  if (res.status >= 500 || res.status === 429) {
    throw new ProviderError(provider, 'unavailable', `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const msg = extractMessage(body) ?? `HTTP ${res.status}`;
    throw new ProviderError(provider, 'rejected', msg);
  }
  if (body === null) throw new ProviderError(provider, 'unavailable', 'Invalid JSON response');
  return body as T;
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  if (typeof b.message === 'string') return b.message;
  if (typeof b.msg === 'string') return b.msg;
  return null;
}
