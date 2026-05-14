import Link from "next/link";

import { SurfaceCard } from "@/components/ui/surface-card";

const OPERATOR_TOOL_LINKS = [
  { href: "/debug/sync", label: "Debug sync" },
  { href: "/debug/wallets/import", label: "Wallet import" },
  { href: "/debug/wallets/tracked", label: "Tracked wallets" },
  { href: "/debug/prices/status", label: "Pricing status" },
] as const;

export function OperatorToolsNav() {
  return (
    <SurfaceCard className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
        Operator tools
      </span>
      <div className="flex flex-wrap gap-4">
        {OPERATOR_TOOL_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-[color:var(--color-accent-2)] hover:underline"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </SurfaceCard>
  );
}
