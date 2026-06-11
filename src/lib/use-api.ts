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
  streamCache.clear();
}

// ---------------- streaming loads with progress ----------------

const streamCache = new Map<string, unknown>();

export interface StreamProgress {
  phase?: string;
  label?: string;
  done?: number;
  total?: number;
}

export interface StreamState<T> {
  data: T | undefined;
  progress: StreamProgress | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

interface StreamInner<T> {
  url: string | null;
  data?: T;
  progress?: StreamProgress;
  error?: string;
  loading: boolean;
}

function initStream<T>(url: string | null): StreamInner<T> {
  return { url, data: url ? (streamCache.get(url) as T | undefined) : undefined, loading: !!url && !streamCache.has(url) };
}

/**
 * Consume an NDJSON progress stream: surfaces {phase, done, total, label} events
 * as `progress` and the final `{type:"done", payload}` as `data`. Results are
 * cached per-url so revisiting is instant.
 */
export function useStream<T>(url: string | null): StreamState<T> {
  const [s, setS] = useState<StreamInner<T>>(() => initStream<T>(url));
  const [nonce, setNonce] = useState(0);

  // adjust state when the url prop changes (render-time pattern, no effect setState)
  if (s.url !== url) setS(initStream<T>(url));

  useEffect(() => {
    if (!url) return;
    if (nonce === 0 && streamCache.has(url)) return; // data already came from cache
    let cancelled = false;
    const ctrl = new AbortController();
    const patch = (p: Partial<StreamInner<T>>) => setS((prev) => (prev.url === url ? { ...prev, ...p } : prev));

    (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line || cancelled) continue;
            const evt = JSON.parse(line) as { type: string; payload?: T; error?: string } & StreamProgress;
            if (evt.type === "progress" || evt.type === "phase") {
              patch({ progress: { phase: evt.phase, label: evt.label, done: evt.done, total: evt.total } });
            } else if (evt.type === "done") {
              streamCache.set(url, evt.payload);
              patch({ data: evt.payload, loading: false });
            } else if (evt.type === "error") {
              throw new Error(evt.error ?? "stream error");
            }
          }
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") {
          patch({ error: err instanceof Error ? err.message : String(err), loading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [url, nonce]);

  const reload = useCallback(() => {
    if (url) streamCache.delete(url);
    setS(initStream<T>(url));
    setNonce((n) => n + 1);
  }, [url]);

  return { data: s.data, progress: s.progress, error: s.error, loading: s.loading, reload };
}
