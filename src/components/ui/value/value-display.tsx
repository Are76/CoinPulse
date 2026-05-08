import { StatusBadge } from "@/components/ui/status/status-badge";
import type { DashboardStatus } from "@/services/dashboard/types";

export function ValueDisplay({
  status,
  value,
  prefix,
  fallback = "n/a",
}: {
  status?: DashboardStatus;
  value: string | null | undefined;
  prefix?: string;
  fallback?: string;
}) {
  const text = value ?? fallback;

  return (
    <div className="flex flex-col gap-1">
      {status ? <StatusBadge status={status} /> : null}
      <span className="cp-data">{prefix ? `${prefix} ${text}` : text}</span>
    </div>
  );
}
