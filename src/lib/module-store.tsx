"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { dedupeChannels } from "./channels";
import type { SfrModule, SfrTree } from "./types";

type Focus = { sub?: string; ip?: string } | null;
interface Entry {
  path: string;
  sub: string;
  ip: string;
}

/** Tree distance from the focus: same IP (0) < same subsystem (1) < rest (2). */
function dist(e: Entry, focus: Focus): number {
  if (!focus) return 0;
  if (focus.ip && focus.sub && e.ip === focus.ip && e.sub === focus.sub) return 0;
  if (focus.sub && e.sub === focus.sub) return 1;
  return 2;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (typeof ric === "function") ric(() => resolve(), { timeout: 250 });
    else setTimeout(resolve, 30);
  });
}

export interface ModuleStore {
  subscribe: (cb: () => void) => () => void;
  /** cached, channel-deduped modules for `paths`, or null if any is still missing */
  get: (key: string, paths: string[]) => SfrModule[] | null;
  getProgress: () => { loaded: number; total: number };
  /** fetch these paths immediately (a click), ahead of the background queue */
  requestNow: (paths: string[]) => void;
  /** bias the background queue toward this tree location */
  setFocus: (focus: Focus) => void;
  start: () => () => void;
}

function createStore(project: string, tag: string | null | undefined, entries: Entry[]): ModuleStore {
  const cache = new Map<string, SfrModule>();
  const inflight = new Set<string>();
  const snap = new Map<string, SfrModule[] | null>();
  let progress = { loaded: 0, total: entries.length };
  let focus: Focus = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  async function fetchPaths(paths: string[]) {
    const need = paths.filter((p) => !cache.has(p) && !inflight.has(p));
    if (!need.length) return;
    need.forEach((p) => inflight.add(p));
    try {
      const url = `/api/projects/${project}/sfr/modules?${tag ? `ref=${encodeURIComponent(tag)}&` : ""}paths=${need
        .map(encodeURIComponent)
        .join(",")}`;
      const res = await fetch(url);
      if (res.ok) {
        const mods = (await res.json()) as SfrModule[];
        for (const m of mods) cache.set(m.path, { ...m, regs: dedupeChannels(m.regs) });
      }
    } catch {
      /* best-effort prefetch */
    } finally {
      need.forEach((p) => inflight.delete(p));
      progress = { loaded: cache.size, total: entries.length };
      emit();
    }
  }

  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get(key, paths) {
      const prev = snap.get(key);
      if (!paths.length) {
        if (prev) return prev;
        const empty: SfrModule[] = [];
        snap.set(key, empty);
        return empty;
      }
      if (!paths.every((p) => cache.has(p))) {
        if (prev === null) return null;
        snap.set(key, null);
        return null;
      }
      // all cached — return a stable reference unless the underlying modules changed
      if (prev && prev.length === paths.length && paths.every((p, i) => prev[i] === cache.get(p))) return prev;
      const arr = paths.map((p) => cache.get(p)!);
      snap.set(key, arr);
      return arr;
    },
    getProgress: () => progress,
    requestNow: (paths) => void fetchPaths(paths),
    setFocus: (f) => {
      focus = f;
    },
    start() {
      let cancelled = false;
      (async () => {
        while (!cancelled) {
          const next = entries
            .filter((e) => !cache.has(e.path) && !inflight.has(e.path))
            .sort((a, b) => dist(a, focus) - dist(b, focus))[0];
          if (!next) break; // everything cached
          await fetchPaths([next.path]);
          await idle();
        }
      })();
      return () => {
        cancelled = true;
      };
    },
  };
}

const Ctx = createContext<ModuleStore | null>(null);

export function ModuleStoreProvider({
  project,
  tag,
  tree,
  children,
}: {
  project: string;
  tag: string | null | undefined;
  tree: SfrTree | null;
  children: React.ReactNode;
}) {
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    if (tree)
      for (const sys of tree.systems)
        for (const sub of sys.subsystems) for (const ip of sub.ips) for (const m of ip.modules) out.push({ path: m.path, sub: sub.name, ip: ip.name });
    return out;
  }, [tree]);

  // new store per project/tag/tree; resets the cache + restarts the background fill
  const store = useMemo(() => createStore(project, tag, entries), [project, tag, entries]);
  useEffect(() => {
    if (!entries.length) return; // tree not loaded yet
    return store.start();
  }, [store, entries.length]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useModules(paths: string[]): SfrModule[] | null {
  const store = useContext(Ctx)!;
  const key = paths.join("|");
  const snapshot = () => store.get(key, paths);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

export function useModuleFocusRequest(): { requestNow: (paths: string[]) => void; setFocus: (f: Focus) => void } {
  const store = useContext(Ctx)!;
  return { requestNow: store.requestNow, setFocus: store.setFocus };
}

export function usePrefetchProgress(): { loaded: number; total: number } {
  const store = useContext(Ctx)!;
  const snapshot = () => store.getProgress();
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}
