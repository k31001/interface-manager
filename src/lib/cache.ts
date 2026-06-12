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
 * Bump when the shape or computation of any disk-cached value changes (e.g. the
 * RDL parser starts emitting new fields). Cache keys are otherwise content-
 * addressed (git sha), not code-addressed, so without this a model parsed by an
 * older build would be served stale after a parser change.
 */
const CACHE_VERSION = "v2";

/**
 * Memory + disk cache for JSON-serializable results keyed by a content-addressed
 * key (it must include the git sha) plus CACHE_VERSION. Survives process
 * restarts, so re-opening a tag/baseline that was parsed before is instant.
 * The cache directory is disposable.
 */
export function diskCached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const vkey = `${CACHE_VERSION}:${key}`;
  return cached(vkey, async () => {
    const file = join(PARSED_DIR, createHash("sha1").update(vkey).digest("hex") + ".json");
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
