// ─── Theme ────────────────────────────────────────────────────────────────────
// Pure colour logic for the Appearance setting. No React, no DOM: the store,
// the applier component and the pre-paint script in app/layout.tsx all share it,
// and the unit tests load it directly.
//
// The whole app is driven by CSS variables (--purple, --purple-light,
// --purple-fg for the accent; --background/--card/--muted/... for surfaces), so
// "recolouring" is only ever a matter of setting those on <html>.

export type ThemeMode = "light" | "dark" | "system";

export interface ThemePrefs {
  mode: ThemeMode;
  /** id of an ACCENT_PRESETS entry, or "custom" to use `customAccent` */
  accentId: string;
  /** #rrggbb, used when accentId === "custom" */
  customAccent: string;
}

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: "violet",  label: "Violet",  hex: "#7c5cbf" },   // the original look
  { id: "indigo",  label: "Indigo",  hex: "#4f5bd5" },
  { id: "ocean",   label: "Ocean",   hex: "#2b7fc2" },
  { id: "teal",    label: "Teal",    hex: "#13857f" },
  { id: "forest",  label: "Forest",  hex: "#3c8a4e" },
  { id: "amber",   label: "Amber",   hex: "#b86e12" },
  { id: "rose",    label: "Rose",    hex: "#c4466f" },
  { id: "crimson", label: "Crimson", hex: "#c0392b" },
  { id: "slate",   label: "Slate",   hex: "#5b6678" },
];

export const DEFAULT_THEME: ThemePrefs = {
  mode: "light",
  accentId: "violet",
  customAccent: "#7c5cbf",
};

export const THEME_STORAGE_KEY = "fablechat-theme";

// ─── Colour maths ─────────────────────────────────────────────────────────────

type RGB = [number, number, number];

/** "#abc" / "#aabbcc" (with or without #) → "#aabbcc", or null when invalid. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend: t=0 → a, t=1 → b. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Darken until white text on the accent is readable (>= 4.5:1). Buttons and
 * chips put `text-white` on `--purple`, so a pale custom colour (yellow) would
 * otherwise produce unreadable buttons.
 */
function fitForWhiteText(hex: string): string {
  let out = hex;
  for (let i = 0; i < 20 && contrast(out, "#ffffff") < 4.5; i++) out = mix(out, "#000000", 0.08);
  return out;
}

// ─── CSS variables for an accent ──────────────────────────────────────────────

export interface AccentVars {
  "--purple": string;
  "--purple-light": string;
  "--purple-fg": string;
}

/**
 * The three accent variables for a base colour. `dark` flips the tint/ink pair:
 * on a dark surface the "light" tint is a deep wash of the accent and the
 * "fg" ink is a lightened accent.
 */
export function accentVars(baseHex: string, dark: boolean): AccentVars {
  const base = fitForWhiteText(normalizeHex(baseHex) ?? DEFAULT_THEME.customAccent);
  return dark
    ? {
        "--purple": base,
        "--purple-light": mix("#1b1b26", base, 0.22),
        "--purple-fg": mix(base, "#ffffff", 0.45),
      }
    : {
        "--purple": base,
        "--purple-light": mix("#ffffff", base, 0.1),
        "--purple-fg": mix(base, "#000000", 0.28),
      };
}

export function accentHex(prefs: ThemePrefs): string {
  if (prefs.accentId === "custom") return normalizeHex(prefs.customAccent) ?? DEFAULT_THEME.customAccent;
  return (ACCENT_PRESETS.find((p) => p.id === prefs.accentId) ?? ACCENT_PRESETS[0]).hex;
}

export function isDark(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark);
}

/** Everything the DOM needs for a given preference, as plain data. */
export function resolveTheme(prefs: ThemePrefs, systemPrefersDark: boolean) {
  const dark = isDark(prefs.mode, systemPrefersDark);
  return { dark, vars: accentVars(accentHex(prefs), dark) };
}

// ─── Pre-paint script ─────────────────────────────────────────────────────────
// Runs inline in <head> before first paint so a saved dark theme or accent never
// flashes the default. It deliberately contains no colour maths: ThemeApplier
// caches the already-resolved variables for both schemes under
// THEME_CACHE_KEY, and this only picks one. (Serialising the functions above
// would break the moment the bundler minifies them.)

export const THEME_CACHE_KEY = "fablechat-theme-cache";

export interface ThemeCache {
  mode: ThemeMode;
  light: AccentVars;
  dark: AccentVars;
}

export function buildThemeCache(prefs: ThemePrefs): ThemeCache {
  const hex = accentHex(prefs);
  return { mode: prefs.mode, light: accentVars(hex, false), dark: accentVars(hex, true) };
}

export const THEME_INIT_SCRIPT = `(function(){try{
var raw=localStorage.getItem(${JSON.stringify(THEME_CACHE_KEY)});
if(!raw)return;
var c=JSON.parse(raw);
var dark=c.mode==="dark"||(c.mode==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var el=document.documentElement;
if(dark)el.classList.add("dark");
var v=dark?c.dark:c.light;
for(var k in v)el.style.setProperty(k,v[k]);
}catch(e){}})();`;
