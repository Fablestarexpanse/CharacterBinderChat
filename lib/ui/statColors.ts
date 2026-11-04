// One palette for the five relationship stats, shared by the Character tab and
// the Relationships view (each had its own copy). The hues identify the stat,
// so they stay fixed across themes; "connection" takes the accent because it
// is the app's own bond color and was already purple.
export const STAT_COLORS: Record<string, string> = {
  affection:  "#e879a0",
  trust:      "#4f9cf8",
  desire:     "#f97316",
  connection: "var(--purple)",
  mood:       "#22d3ee",
};

export const STAT_FALLBACK_COLOR = "var(--purple)";
