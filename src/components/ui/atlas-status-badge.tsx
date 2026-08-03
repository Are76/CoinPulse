/**
 * Atlas StatusBadge — full variant set matching the Atlas design system spec.
 * Use this in new components. Legacy code uses ProvenanceChip + LabelBadge.
 *
 * Variants whose meaning exactly coincides with an existing ProvenanceChip
 * tone reuse `STATUS_TONE_STYLES` so the two systems can't drift apart.
 * `conflicting` keeps its own literal — no accepted shared token exists for
 * it yet (see docs/project-decisions.md). `unsupported`/`unavailable` and the
 * `evidence-*` pair are deliberately lower-emphasis variants distinct from
 * any existing tone and are not forced into the shared map.
 */

import { STATUS_TONE_STYLES } from "@/components/ui/status/status-style-map";

export type BadgeVariant =
  | "synced" | "pending" | "stale" | "conflicting"
  | "unsupported" | "unavailable" | "error"
  | "estimated" | "evidence-available" | "evidence-missing";

const CONFIG: Record<BadgeVariant, { label: string; color: string; bg: string; border: string; dot?: boolean }> = {
  "synced":             { label: "Synced",             ...STATUS_TONE_STYLES.fresh },
  "pending":            { label: "Pending",             ...STATUS_TONE_STYLES.warn },
  "stale":              { label: "Stale",               ...STATUS_TONE_STYLES.stale },
  "conflicting":        { label: "Conflicting",        color: "#fb923c", bg: "rgba(251,146,60,0.09)",   border: "rgba(251,146,60,0.22)" },
  "unsupported":        { label: "Unsupported",        color: "var(--status-muted)",   bg: "rgba(100,116,139,0.09)",  border: "rgba(100,116,139,0.2)" },
  "unavailable":        { label: "Unavailable",        color: "var(--status-muted)",   bg: "rgba(100,116,139,0.09)",  border: "rgba(100,116,139,0.2)" },
  "error":              { label: "Error",               ...STATUS_TONE_STYLES.danger },
  "estimated":          { label: "Estimated",           ...STATUS_TONE_STYLES.estimated },
  "evidence-available": { label: "Evidence available", color: "var(--status-fresh)",   bg: "rgba(74,222,128,0.07)",   border: "rgba(74,222,128,0.18)" },
  "evidence-missing":   { label: "Evidence missing",   color: "var(--status-danger)",  bg: "rgba(248,113,113,0.07)",  border: "rgba(248,113,113,0.18)" },
};

export function AtlasStatusBadge({
  variant,
  size = "md",
}: {
  variant: BadgeVariant;
  size?: "sm" | "md";
}) {
  const { label, color, bg, border, dot } = CONFIG[variant];
  const padding = size === "sm" ? "2px 8px" : "4px 10px";
  const fontSize = size === "sm" ? "10px" : "11px";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap"
      style={{ background: bg, border: `1px solid ${border}`, color, padding, fontSize, letterSpacing: "0.03em" }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />}
      {label}
    </span>
  );
}
