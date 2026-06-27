import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function SurfaceCard({
  className,
  highlight,
  ...props
}: HTMLAttributes<HTMLDivElement> & { highlight?: boolean }) {
  return (
    <section
      className={cn(
        highlight ? "cp-card--highlight" : "cp-card",
        "rounded-[var(--radius-lg)] p-5",
        className,
      )}
      {...props}
    />
  );
}
