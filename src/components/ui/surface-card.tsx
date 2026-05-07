import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function SurfaceCard({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn("cp-card rounded-[var(--radius-lg)] p-6", className)}
      {...props}
    />
  );
}
