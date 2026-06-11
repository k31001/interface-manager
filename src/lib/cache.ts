/** In-process cache that survives Next.js HMR reloads. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const PARSED_DIR = join(process.cwd(), "data", "cache", "parsed");

/**
 * Memory + disk cache for JSON-serializable results keyed by a content-addressed
 * key (it must include the git sha). Survives process restarts, so re-opening a
 * tag/baseline that was parsed before is instant. Keys are content (sha) based,
 * so stale entries are never returned — the cache directory is disposable.
 */
export function diskCached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return cached(key, async () => {
    const file = join(PARSED_DIR, createHash("sha1").update(key).digest("hex") + ".json");
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, "utf-8")) as T;
      } catch {
        /* fall through and recompute */
      }
    }
    const value = await fn();
    try {
      mkdirSync(PARSED_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(value));
    } catch {
      /* best-effort cache write */
    }
    return value;
  });
}

export function invalidatePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function invalidateAll() {
  cache.clear();
}
