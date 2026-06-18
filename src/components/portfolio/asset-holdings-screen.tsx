"use client";

import { useState } from "react";

import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { PageContainer } from "@/components/ui/page-container";
import { StatusBadge } from "@/components/ui/status/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ValueDisplay } from "@/components/ui/value/value-display";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";
import type { DashboardTokenPositionDto } from "@/services/dashboard/types";

const DEFAULT_CHAIN_ID = 369;
const DEFAULT_QUOTE_ASSET = "fiat:usd";

export function AssetHoldingsScreen() {
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const trackedWalletsQuery = useTrackedWalletsQuery();

  const wallets =
    trackedWalletsQuery.isSuccess ? trackedWalletsQuery.data.wallets : [];

  const selectedWallet =
    wallets.length > 0
      ? (wallets.find((w) => w.id === selectedWalletId) ?? wallets[0])
      : null;

  const dashboardQuery = useDashboardQuery({
    walletAddress: selectedWallet?.address ?? "",
    chainId: selectedWallet?.chainId ?? DEFAULT_CHAIN_ID,
    quoteAsset: DEFAULT_QUOTE_ASSET,
    enabled: selectedWallet !== null,
  });

  if (trackedWalletsQuery.isPending) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }

  if (trackedWalletsQuery.isError) {
    return (
      <PageContainer>
        <ErrorState
          title="Could not load wallets"
          message="Backend wallet list is unavailable. Retry or check the operator tools."
        />
      </PageContainer>
    );
  }

  if (selectedWallet === null) {
    return (
      <PageContainer>
        <EmptyState
          title="No tracked wallets"
          message="No backend asset holdings available for this portfolio yet. Import a wallet first via Operator > Wallet import."
        />
      </PageContainer>
    );
  }

  const dashboard = dashboardQuery.data;

  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Asset holdings</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Backend-resolved token balances for the selected tracked wallet. Valuation and pricing
          status are displayed verbatim from the backend DTO — no frontend calculation.
        </p>
        {wallets.length > 1 ? (
          <div className="mt-2">
            <label
              htmlFor="wallet-select"
              className="mb-1 block text-xs text-[color:var(--color-text-muted)]"
            >
              Wallet
            </label>
            <select
              id="wallet-select"
              className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-1 font-mono text-xs"
              value={selectedWallet.id}
              onChange={(e) => setSelectedWalletId(e.target.value)}
            >
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label ?? w.address} (chain {w.chainId})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-4 font-mono text-xs text-[color:var(--color-text-muted)]">
          <span>wallet: {selectedWallet.address}</span>
          <span>chainId: {selectedWallet.chainId}</span>
        </div>
      </SurfaceCard>

      {dashboardQuery.isPending ? <LoadingState /> : null}

      {dashboardQuery.isError ? (
        <ErrorState
          title="Holdings unavailable"
          message="Backend dashboard DTO could not be loaded. Check that the wallet has been synced."
        />
      ) : null}

      {dashboard !== undefined ? (
        <AssetHoldingsTable
          positions={dashboard.tokenPositions}
          chainId={dashboard.wallet.chainId}
        />
      ) : null}
    </PageContainer>
  );
}

function AssetHoldingsTable({
  positions,
  chainId,
}: {
  positions: DashboardTokenPositionDto[];
  chainId: number;
}) {
  if (positions.length === 0) {
    return (
      <EmptyState
        title="No asset holdings"
        message="No backend asset holdings available for this portfolio yet."
      />
    );
  }

  return (
    <DataTableShell
      title="Token holdings"
      subtitle={`${positions.length} position${positions.length === 1 ? "" : "s"} from backend DTO · chainId ${chainId}`}
    >
      <thead>
        <tr>
          <th>Asset identity</th>
          <th>Balance</th>
          <th>Valuation</th>
          <th>Pricing</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.assetId}>
            <td>
              <div className="flex flex-col gap-1">
                <span className="cp-data text-xs">
                  {position.assetAddress ?? position.assetId}
                </span>
                <span className="font-mono text-[10px] text-[color:var(--color-text-muted)]">
                  assetId: {position.assetId}
                </span>
                <span className="font-mono text-[10px] text-[color:var(--color-text-muted)]">
                  chainId: {chainId}
                </span>
              </div>
            </td>
            <td>
              <div className="flex flex-col gap-1">
                <span className="cp-data">{position.balanceQuantity}</span>
                {position.decimals !== null ? (
                  <span className="text-xs text-[color:var(--color-text-muted)]">
                    decimals: {position.decimals}
                  </span>
                ) : null}
              </div>
            </td>
            <td>
              <ValueDisplay
                status={position.valuation.status}
                value={position.valuation.valueQuote}
                fallback="Value unavailable"
              />
            </td>
            <td>
              <StatusBadge status={position.pricing.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}
