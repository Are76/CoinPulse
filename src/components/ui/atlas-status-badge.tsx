/**
 * Atlas StatusBadge — full variant set matching the Atlas design system spec.
 * Use this in new components. Legacy code uses ProvenanceChip + LabelBadge.
 */

export type BadgeVariant =
  | "synced" | "pending" | "stale" | "conflicting"
  | "unsupported" | "unavailable" | "error"
  | "estimated" | "evidence-available" | "evidence-missing";

const CONFIG: Record<BadgeVariant, { label: string; color: string; bg: string; border: string; dot?: boolean }> = {
  "synced":             { label: "Synced",             color: "#4ade80", bg: "rgba(74,222,128,0.09)",   border: "rgba(74,222,128,0.22)",   dot: true },
  "pending":            { label: "Pending",            color: "#f59e0b", bg: "rgba(245,158,11,0.09)",   border: "rgba(245,158,11,0.22)",   dot: true },
  "stale":              { label: "Stale",              color: "#94a3b8", bg: "rgba(148,163,184,0.09)",  border: "rgba(148,163,184,0.2)" },
  "conflicting":        { label: "Conflicting",        color: "#fb923c", bg: "rgba(251,146,60,0.09)",   border: "rgba(251,146,60,0.22)" },
  "unsupported":        { label: "Unsupported",        color: "#64748b", bg: "rgba(100,116,139,0.09)",  border: "rgba(100,116,139,0.2)" },
  "unavailable":        { label: "Unavailable",        color: "#64748b", bg: "rgba(100,116,139,0.09)",  border: "rgba(100,116,139,0.2)" },
  "error":              { label: "Error",              color: "#f87171", bg: "rgba(248,113,113,0.09)",  border: "rgba(248,113,113,0.22)", dot: true },
  "estimated":          { label: "Estimated",          color: "#c4b5fd", bg: "rgba(196,181,253,0.09)",  border: "rgba(196,181,253,0.2)" },
  "evidence-available": { label: "Evidence available", color: "#4ade80", bg: "rgba(74,222,128,0.07)",   border: "rgba(74,222,128,0.18)" },
  "evidence-missing":   { label: "Evidence missing",   color: "#f87171", bg: "rgba(248,113,113,0.07)",  border: "rgba(248,113,113,0.18)" },
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
