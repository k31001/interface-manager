/** In-process cache that survives Next.js HMR reloads. */

type CacheMap = Map<string, Promise<unknown>>;

const g = globalThis as unknown as { __imCache?: CacheMap };
g.__imCache ??= new Map();

const cache = g.__imCache;

export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = fn().catch((err) => {
      cache.delete(key); // don't cache failures
      throw err;
    });
    cache.set(key, p);
  }
  return cache.get(key) as Promise<T>;
}

export function invalidatePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function invalidateAll() {
  cache.clear();
}
