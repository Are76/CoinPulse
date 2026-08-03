/**
 * Shared color/text style map for status presentation.
 *
 * Both the legacy `ProvenanceChip` (tone-based, general-purpose) and
 * `AtlasStatusBadge` (variant-based, fixed label+meaning) render the same
 * underlying visual language. Where their meanings genuinely coincide
 * (e.g. a "fresh/synced" success state), they must share one color
 * definition instead of two independently maintained rgba literals that
 * can drift apart. Entries here are only ones with a single, unambiguous
 * meaning reused by more than one component — this is not a place to add
 * new semantic tones speculatively.
 */

export type StatusToneKey = "neutral" | "fresh" | "warn" | "danger" | "info" | "stale" | "estimated";

export interface StatusToneStyle {
  color: string;
  bg: string;
  border: string;
  dot?: boolean;
}

export const STATUS_TONE_STYLES: Record<StatusToneKey, StatusToneStyle> = {
  neutral:   { color: "var(--text-secondary)", bg: "rgba(160,168,192,0.08)",  border: "rgba(160,168,192,0.18)" },
  fresh:     { color: "var(--status-fresh)",   bg: "rgba(74,222,128,0.09)",   border: "rgba(74,222,128,0.22)",  dot: true },
  warn:      { color: "var(--status-warning)", bg: "rgba(245,158,11,0.09)",   border: "rgba(245,158,11,0.22)",  dot: true },
  danger:    { color: "var(--status-danger)",  bg: "rgba(248,113,113,0.09)",  border: "rgba(248,113,113,0.22)", dot: true },
  info:      { color: "var(--status-info)",    bg: "rgba(96,165,250,0.09)",   border: "rgba(96,165,250,0.2)" },
  stale:     { color: "var(--status-stale)",   bg: "rgba(148,163,184,0.09)",  border: "rgba(148,163,184,0.2)" },
  estimated: { color: "var(--accent-2)",       bg: "rgba(196,181,253,0.09)",  border: "rgba(196,181,253,0.2)" },
};
