import { Redis } from 'ioredis';

/** Minimal key-value store for short-lived data (quotes, asset catalog). */
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Atomically reads and deletes a key (single-use tokens). */
  take(key: string): Promise<string | null>;
  close(): Promise<void>;
}

export function createRedisKv(redis: Redis): Kv {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttl) => {
      await redis.set(key, value, 'EX', Math.max(1, Math.ceil(ttl)));
    },
    take: (key) => redis.getdel(key),
    close: async () => {
      await redis.quit();
    },
  };
}

export function createMemoryKv(): Kv {
  const store = new Map<string, { value: string; expires: number }>();
  const get = (key: string) => {
    const hit = store.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      store.delete(key);
      return null;
    }
    return hit.value;
  };
  return {
    get: async (key) => get(key),
    set: async (key, value, ttl) => {
      store.set(key, { value, expires: Date.now() + ttl * 1000 });
    },
    take: async (key) => {
      const v = get(key);
      store.delete(key);
      return v;
    },
    close: async () => {},
  };
}
