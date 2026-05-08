import type { ReactNode } from "react";

import { SurfaceCard } from "@/components/ui/surface-card";

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <SurfaceCard className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {subtitle ? (
        <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">
          {subtitle}
        </p>
      ) : null}
      {children}
    </SurfaceCard>
  );
}
