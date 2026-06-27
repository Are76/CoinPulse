import type { ReactNode } from "react";

import { SurfaceCard } from "@/components/ui/surface-card";

export function SectionCard({
  title,
  subtitle,
  action,
  highlight,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  highlight?: boolean;
  children?: ReactNode;
}) {
  return (
    <SurfaceCard highlight={highlight} className="flex flex-col gap-4">
      <div
        className="flex items-center justify-between pb-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.055)" }}
      >
        <div className="flex flex-col gap-0.5">
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#586070", letterSpacing: "0.08em" }}
          >
            {title}
          </span>
          {subtitle && (
            <span className="text-xs" style={{ color: "#a0a8c0" }}>
              {subtitle}
            </span>
          )}
        </div>
        {action}
      </div>
      {children}
    </SurfaceCard>
  );
}
