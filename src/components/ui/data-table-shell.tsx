import type { ReactNode } from "react";

import { DataTable, TableFrame } from "@/components/ui/table-frame";

export function DataTableShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <TableFrame>
      <div className="flex flex-col gap-1 border-b border-[color:var(--color-border-soft)] px-6 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <DataTable className="cp-table">{children}</DataTable>
    </TableFrame>
  );
}
