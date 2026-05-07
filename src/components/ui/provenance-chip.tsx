import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ProvenanceTone = "neutral" | "fresh" | "warn" | "danger";

const toneClassNames: Record<ProvenanceTone, string> = {
  neutral: "border-[color:var(--color-border-strong)] text-[color:var(--color-text-muted)]",
  fresh: "border-[color:var(--color-status-fresh)] text-[color:var(--color-status-fresh)]",
  warn: "border-[color:var(--color-status-warning)] text-[color:var(--color-status-warning)]",
  danger: "border-[color:var(--color-status-danger)] text-[color:var(--color-status-danger)]",
};

type ProvenanceChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ProvenanceTone;
};

export function ProvenanceChip({
  className,
  tone = "neutral",
  ...props
}: ProvenanceChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tracking-[0.02em]",
        toneClassNames[tone],
        className,
      )}
      {...props}
    />
  );
}
