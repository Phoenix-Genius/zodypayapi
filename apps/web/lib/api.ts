'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Calls the API through the same-origin /api proxy. Adds the CSRF header for mutations. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'x-zp-csrf': '1',
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: { error?: { message?: string; code?: string; details?: { message?: string }[] } } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON means the response didn't come from the API (e.g. the dev proxy can't reach it).
    throw new ApiError(
      res.status >= 500 ? 'Cannot reach the ZodyPay API. Is it running? (npm run dev:api)' : `Unexpected response (${res.status})`,
      res.status,
    );
  }
  if (!res.ok) {
    const err = data?.error;
    const detail = err?.details?.[0]?.message;
    throw new ApiError(detail ? `${err.message}: ${detail}` : (err?.message ?? `Request failed (${res.status})`), res.status, err?.code);
  }
  return data as T;
}

/** Fetches `path` (null to skip) and optionally re-polls every `pollMs`. */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === p) setError(e as ApiError);
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(!!path);
    void load();
    if (!path || !pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [path, pollMs, load]);

  return { data, error, loading, reload: load, setData };
}
