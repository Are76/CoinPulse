import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

type PageContainerProps = PropsWithChildren<{
  className?: string;
}>;

export function PageContainer({
  children,
  className,
}: PageContainerProps) {
  return (
    <main className={cn("cp-container flex-1 py-10", className)}>{children}</main>
  );
}
