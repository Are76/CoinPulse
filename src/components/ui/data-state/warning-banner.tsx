import type { ReactNode } from "react";

import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";

export function WarningBanner({
  children,
  tone = "warn",
}: {
  children: ReactNode;
  tone?: "warn" | "danger";
}) {
  return (
    <SurfaceCard
      className={cn(
        "border px-5 py-4 text-sm leading-6",
        tone === "danger"
          ? "border-[color:var(--color-status-danger)] text-[color:var(--color-status-danger)]"
          : "border-[color:var(--color-status-warning)] text-[color:var(--color-status-warning)]",
      )}
    >
      {children}
    </SurfaceCard>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return <span className="text-[color:var(--color-text-muted)]">none</span>;
  }

  return (
    <ul className="space-y-1 text-xs leading-5 text-[color:var(--color-text-muted)]">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}
