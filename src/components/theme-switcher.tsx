"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY, type ThemeId } from "@/lib/themes";
import { cx } from "./ui";

// The active theme lives on <html data-theme> (set by the no-flash script before
// paint). We treat that attribute as the external source of truth and subscribe
// to it with useSyncExternalStore — so every picker stays in sync, plus other
// tabs via the `storage` event, with no setState-in-effect.
const THEME_EVENT = "im-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const getSnapshot = (): ThemeId => (document.documentElement.dataset.theme as ThemeId) || DEFAULT_THEME;
const getServerSnapshot = (): ThemeId => DEFAULT_THEME;

/** Reads the active theme and returns a setter that applies + persists it. */
export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((id: ThemeId) => {
    document.documentElement.dataset.theme = id;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* private mode / storage disabled — theme still applies for this session */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return [theme, set];
}

/** Little palette chip previewing a theme: surface + primary wedge + accent dot. */
export function Swatch({ theme, size = 22 }: { theme: ThemeId; size?: number }) {
  const def = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const { bg, primary, accent } = def.swatch;
  return (
    <span
      className="relative inline-block shrink-0 overflow-hidden rounded-md border border-black/10"
      style={{ width: size, height: size, background: bg }}
    >
      <span className="absolute inset-0" style={{ background: primary, clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }} />
      <span
        className="absolute rounded-full"
        style={{ width: size * 0.3, height: size * 0.3, left: size * 0.16, top: size * 0.16, background: accent }}
      />
    </span>
  );
}

/** Compact row of theme swatches — used in the sidebar footer for quick switching. */
export function ThemeSwitcherCompact() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex flex-wrap gap-1.5">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          title={`${t.label} — ${t.description}`}
          aria-label={`${t.label} theme`}
          aria-pressed={theme === t.id}
          className={cx(
            "cursor-pointer rounded-md p-0.5 transition-all duration-150",
            theme === t.id
              ? "ring-2 ring-neutral-900 ring-offset-1 ring-offset-white"
              : "opacity-70 hover:opacity-100"
          )}
        >
          <Swatch theme={t.id} size={20} />
        </button>
      ))}
    </div>
  );
}

/** Full labelled picker — used in Settings → Appearance. */
export function ThemePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            aria-pressed={active}
            className={cx(
              "group flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-all duration-150",
              active
                ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900"
                : "border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50"
            )}
          >
            <span className="flex w-full items-center gap-2">
              <Swatch theme={t.id} size={28} />
              <span className="text-[13px] font-medium text-neutral-900">{t.label}</span>
              {active && <span className="ml-auto shrink-0 text-[10px] text-neutral-400">● active</span>}
            </span>
            <span className="block text-[11px] leading-snug text-neutral-400">{t.description}</span>
          </button>
        );
      })}
    </div>
  );
}
