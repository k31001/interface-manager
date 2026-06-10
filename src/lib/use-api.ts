"use client";

import { useCallback, useEffect, useState } from "react";

const memCache = new Map<string, unknown>();

interface ApiState<T> {
  url: string | null;
  data?: T;
  error?: string;
  loading: boolean;
}

function initial<T>(url: string | null): ApiState<T> {
  return {
    url,
    data: url ? (memCache.get(url) as T | undefined) : undefined,
    loading: !!url && !memCache.has(url),
  };
}

export function useApi<T>(url: string | null): {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
} {
  const [state, setState] = useState<ApiState<T>>(() => initial<T>(url));
  const [nonce, setNonce] = useState(0);

  // adjust state when the url prop changes (render-time adjustment pattern)
  if (state.url !== url) {
    setState(initial<T>(url));
  }

  useEffect(() => {
    if (!url) return;
    if (nonce === 0 && memCache.has(url)) return;
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as T;
      })
      .then((body) => {
        memCache.set(url, body);
        if (!cancelled) {
          setState((s) => (s.url === url ? { ...s, data: body, error: undefined, loading: false } : s));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState((s) => (s.url === url ? { ...s, error: message, loading: false } : s));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  const reload = useCallback(() => {
    if (url) memCache.delete(url);
    setState((s) => ({ ...s, loading: true }));
    setNonce((n) => n + 1);
  }, [url]);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}

export function clearApiCache() {
  memCache.clear();
}
