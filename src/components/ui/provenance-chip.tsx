import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { STATUS_TONE_STYLES, type StatusToneKey } from "@/components/ui/status/status-style-map";

type ProvenanceTone = StatusToneKey;

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
  const { color, bg, border, dot } = STATUS_TONE_STYLES[tone];
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
