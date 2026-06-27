import { ProvenanceChip } from "@/components/ui/provenance-chip";
import type { DashboardStatus } from "@/services/dashboard/types";
import type { BadgeVariant } from "@/components/ui/atlas-status-badge";

export type BadgeTone = "neutral" | "fresh" | "warn" | "danger" | "stale" | "estimated" | "info";

function toneFromDashboardStatus(status: DashboardStatus): BadgeTone {
  switch (status) {
    case "available":           return "fresh";
    case "stale_price":
    case "low_confidence_price":
    case "incomplete_basis":
    case "partial":             return "warn";
    case "unavailable":
    case "unsupported":         return "stale";
    default:                    return "neutral";
  }
}

export function StatusBadge({ status }: { status: DashboardStatus }) {
  return (
    <ProvenanceChip tone={toneFromDashboardStatus(status)} size="sm">
      {status.replace(/_/g, " ")}
    </ProvenanceChip>
  );
}

export function LabelBadge({
  label,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  tone?: BadgeTone;
  size?: "sm" | "md";
}) {
  return (
    <ProvenanceChip tone={tone} size={size}>
      {label}
    </ProvenanceChip>
  );
}

export { type BadgeVariant };
