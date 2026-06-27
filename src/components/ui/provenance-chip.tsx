import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ProvenanceTone = "neutral" | "fresh" | "warn" | "danger" | "info" | "stale" | "estimated";

const TONE_STYLES: Record<ProvenanceTone, { color: string; bg: string; border: string; dot?: boolean }> = {
  neutral:   { color: "#a0a8c0", bg: "rgba(160,168,192,0.08)",  border: "rgba(160,168,192,0.18)" },
  fresh:     { color: "#4ade80", bg: "rgba(74,222,128,0.09)",   border: "rgba(74,222,128,0.22)",  dot: true },
  warn:      { color: "#f59e0b", bg: "rgba(245,158,11,0.09)",   border: "rgba(245,158,11,0.22)",  dot: true },
  danger:    { color: "#f87171", bg: "rgba(248,113,113,0.09)",  border: "rgba(248,113,113,0.22)", dot: true },
  info:      { color: "#60a5fa", bg: "rgba(96,165,250,0.09)",   border: "rgba(96,165,250,0.2)" },
  stale:     { color: "#94a3b8", bg: "rgba(148,163,184,0.09)",  border: "rgba(148,163,184,0.2)" },
  estimated: { color: "#c4b5fd", bg: "rgba(196,181,253,0.09)",  border: "rgba(196,181,253,0.2)" },
};

type ProvenanceChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ProvenanceTone;
  size?: "sm" | "md";
};

export function ProvenanceChip({
  className,
  tone = "neutral",
  size = "md",
  children,
  ...props
}: ProvenanceChipProps) {
  const { color, bg, border, dot } = TONE_STYLES[tone];
  const padding = size === "sm" ? "2px 8px" : "4px 10px";
  const fontSize = size === "sm" ? "10px" : "11px";

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap", className)}
      style={{ background: bg, border: `1px solid ${border}`, color, padding, fontSize, letterSpacing: "0.03em" }}
      {...props}
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      )}
      {children}
    </span>
  );
}
