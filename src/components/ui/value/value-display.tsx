import { StatusBadge } from "@/components/ui/status/status-badge";
import type { DashboardStatus } from "@/services/dashboard/types";

export type ValueState = "present" | "unavailable" | "unsupported" | "stale" | "pending" | "null";

const STATE_STYLE: Record<ValueState, { color: string; italic?: boolean }> = {
  present:     { color: "#e4e6f0" },
  stale:       { color: "#94a3b8", italic: true },
  unavailable: { color: "#64748b", italic: true },
  unsupported: { color: "#64748b", italic: true },
  pending:     { color: "#f59e0b", italic: true },
  null:        { color: "#586070", italic: true },
};

export function ValueDisplay({
  status,
  value,
  prefix,
  fallback = "—",
  state,
}: {
  status?: DashboardStatus;
  value: string | null | undefined;
  prefix?: string;
  fallback?: string;
  state?: ValueState;
}) {
  const resolvedState: ValueState = state ?? (value != null ? "present" : "null");
  const { color, italic } = STATE_STYLE[resolvedState];
  const text = value ?? fallback;

  return (
    <div className="flex flex-col gap-1">
      {status ? <StatusBadge status={status} /> : null}
      <span
        className="cp-data"
        style={{
          color,
          fontStyle: italic ? "italic" : "normal",
          fontFamily: resolvedState === "present" ? "var(--font-mono-data), monospace" : "inherit",
        }}
      >
        {prefix ? `${prefix} ${text}` : text}
      </span>
    </div>
  );
}
