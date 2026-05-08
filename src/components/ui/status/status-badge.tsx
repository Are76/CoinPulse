import { ProvenanceChip } from "@/components/ui/provenance-chip";
import type { DashboardStatus } from "@/services/dashboard/types";

export type BadgeTone = "neutral" | "fresh" | "warn" | "danger";

export function StatusBadge({ status }: { status: DashboardStatus }) {
  const tone =
    status === "available"
      ? "fresh"
      : status === "stale_price" ||
          status === "low_confidence_price" ||
          status === "incomplete_basis" ||
          status === "partial"
        ? "warn"
        : "neutral";

  return <ProvenanceChip tone={tone}>{status}</ProvenanceChip>;
}

export function LabelBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  return <ProvenanceChip tone={tone}>{label}</ProvenanceChip>;
}
