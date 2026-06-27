"use client";

import { OperatorToolsNav } from "@/components/debug/operator-tools-nav";
import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { PageContainer } from "@/components/ui/page-container";
import { SectionCard } from "@/components/ui/section-card";
import { LabelBadge } from "@/components/ui/status/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TimestampLabel } from "@/components/ui/value/timestamp-label";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";

export function TrackedWalletsScreen() {
  const { data, error, isPending } = useTrackedWalletsQuery();

  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "#586070", letterSpacing: "0.08em" }}
            >
              CoinPulse
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight" style={{ color: "#e4e6f0" }}>
              Tracked wallets
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-sm" style={{ color: "#a0a8c0" }}>
              Operator-facing view of wallets registered in backend tracking.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data ? (
              <LabelBadge
                label={`${data.wallets.length} tracked`}
                tone="neutral"
              />
            ) : null}
          </div>
        </div>
      </SurfaceCard>

      <OperatorToolsNav />

      {isPending ? (
        <SectionCard
          title="Loading tracked wallets"
          subtitle="Fetching backend wallet registry."
        >
          <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
        </SectionCard>
      ) : null}

      {error ? (
        <ErrorState
          title="Failed to load tracked wallets"
          message={error instanceof Error ? error.message : "Unknown error."}
        />
      ) : null}

      {data && data.wallets.length === 0 ? (
        <EmptyState
          title="No tracked wallets"
          message="Imported wallets will appear here after the backend accepts them."
        />
      ) : null}

      {data && data.wallets.length > 0 ? (
        <SectionCard
          title="Registered wallets"
          subtitle={`Schema version: ${data.schemaVersion} · ${data.wallets.length} wallet${data.wallets.length === 1 ? "" : "s"} tracked.`}
        >
          <div className="flex flex-col divide-y divide-[rgba(255,255,255,0.04)]">
            {data.wallets.map((wallet) => (
              <WalletRow key={wallet.id} wallet={wallet} />
            ))}
          </div>
        </SectionCard>
      ) : null}
    </PageContainer>
  );
}

function WalletRow({ wallet }: { wallet: TrackedWalletDto }) {
  return (
    <div className="flex flex-col gap-1 py-4 md:flex-row md:items-start md:gap-6">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm" style={{ color: "#e4e6f0" }}>{wallet.address}</p>
        <p className="mt-1 text-xs" style={{ color: "#586070" }}>
          Chain ID: {wallet.chainId}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "#586070" }}>
          {wallet.label ?? "No label"}
        </p>
      </div>
      <div className="flex flex-col gap-1 text-right">
        <TimestampLabel label="Created:" value={wallet.createdAt} />
        <TimestampLabel label="Updated:" value={wallet.updatedAt} />
      </div>
    </div>
  );
}
