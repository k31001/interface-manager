/**
 * Theme registry shared by the server layout (no-flash script) and the client
 * theme switcher. Each id maps to a `[data-theme="…"]` block in globals.css that
 * re-maps the Tailwind colour variables; the `swatch` colours are only for the
 * picker preview chip. Keep this in sync with globals.css.
 */

export interface ThemeDef {
  id: ThemeId;
  label: string;
  description: string;
  /** preview chip colours: page background, primary chrome, an accent */
  swatch: { bg: string; primary: string; accent: string };
}

export type ThemeId = "light" | "dark" | "colorful" | "pastel" | "metallic" | "wood";

export const THEMES: ThemeDef[] = [
  {
    id: "light",
    label: "Light",
    description: "The default bright theme.",
    swatch: { bg: "#ffffff", primary: "#0a0a0a", accent: "#0ea5e9" },
  },
  {
    id: "dark",
    label: "Dark",
    description: "Low-light surfaces, easy on the eyes at night.",
    swatch: { bg: "#18181b", primary: "#f5f5f7", accent: "#34d399" },
  },
  {
    id: "colorful",
    label: "Colorful",
    description: "Vivid violet chrome with saturated accents.",
    swatch: { bg: "#faf9ff", primary: "#4c1d95", accent: "#ec4899" },
  },
  {
    id: "pastel",
    label: "Pastel",
    description: "Soft, muted plum and powder tones.",
    swatch: { bg: "#fbf4f9", primary: "#5a3f6b", accent: "#e7a6c4" },
  },
  {
    id: "metallic",
    label: "Metallic",
    description: "Cool brushed-steel greys.",
    swatch: { bg: "#e9edf2", primary: "#334155", accent: "#8a94a3" },
  },
  {
    id: "wood",
    label: "Wood",
    description: "Warm tan and espresso tones.",
    swatch: { bg: "#f3ead9", primary: "#4a3728", accent: "#a98e6e" },
  },
];

export const DEFAULT_THEME: ThemeId = "light";
export const THEME_STORAGE_KEY = "im-theme";
export const THEME_IDS = THEMES.map((t) => t.id);

/**
 * Inline <script> body run before first paint to apply the saved theme and avoid
 * a flash of the default light palette. Kept tiny and dependency-free.
 */
export const NO_FLASH_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var ok=${JSON.stringify(THEME_IDS)};if(t&&ok.indexOf(t)>-1)document.documentElement.dataset.theme=t;}catch(e){}})();`;
