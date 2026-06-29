"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { PageContainer } from "@/components/ui/page-container";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { StatusBadge } from "@/components/ui/status/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ValueDisplay } from "@/components/ui/value/value-display";
import { useDashboardQuery } from "@/lib/query/use-dashboard-query";
import { useTrackedWalletsQuery } from "@/lib/query/use-tracked-wallets-query";
import type { DashboardTokenPositionDto, PortfolioSummaryDto } from "@/services/dashboard/types";

const DEFAULT_CHAIN_ID = 369;
const DEFAULT_QUOTE_ASSET = "fiat:usd";

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

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
          message="Import a wallet first via Operator › Wallet import, then run a sync to build your portfolio."
        />
      </PageContainer>
    );
  }

  const dashboard = dashboardQuery.data;

  return (
    <PageContainer className="flex flex-col gap-6">

      {/* Hero */}
      <SurfaceCard className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          CoinPulse
        </p>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#e4e6f0" }}>
          Asset holdings
        </h1>
        <p className="text-sm leading-relaxed max-w-2xl" style={{ color: "#a0a8c0" }}>
          Backend-resolved token balances. All values come from the backend — no frontend calculation.
        </p>
      </SurfaceCard>

      {/* Wallet selector + summary stats */}
      <SurfaceCard className="flex flex-col gap-4">
        {wallets.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {wallets.map((w) => {
              const isActive = w.id === (selectedWallet.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelectedWalletId(w.id)}
                  title={w.address}
                  className="cp-data text-xs transition"
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    background: isActive ? "#818cf8" : "rgba(255,255,255,0.06)",
                    color: isActive ? "#fff" : "#a0a8c0",
                    border: isActive ? "1px solid #818cf8" : "1px solid rgba(255,255,255,0.08)",
                    cursor: "pointer",
                  }}
                >
                  {w.label ?? truncateAddress(w.address)}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070" }}>Wallet</p>
            <p className="cp-data text-xs mt-1" style={{ color: "#a0a8c0" }} title={selectedWallet.address}>
              {selectedWallet.address}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070" }}>Chain</p>
            <p className="cp-data text-xs mt-1" style={{ color: "#a0a8c0" }}>
              {selectedWallet.chainId}
            </p>
          </div>
          {dashboard?.summary && (
            <SummaryStats summary={dashboard.summary} />
          )}
        </div>
      </SurfaceCard>

      {dashboardQuery.isPending ? <LoadingState /> : null}

      {dashboardQuery.isError ? (
        <ErrorState
          title="Holdings unavailable"
          message="Backend dashboard DTO could not be loaded. Check that the wallet has been synced via Operator › Debug sync."
        />
      ) : null}

      {dashboard !== undefined ? (
        <AssetHoldingsTable
          positions={dashboard.tokenPositions}
          chainId={dashboard.wallet.chainId}
          walletAddress={dashboard.wallet.address}
        />
      ) : null}
    </PageContainer>
  );
}

function SummaryStats({ summary }: { summary: PortfolioSummaryDto }) {
  const formattedValue = summary.totalValueQuote ?? null;
  const { valuedPositions, totalPositions } = summary.valuationCoverage;
  const coverageTone: "fresh" | "warn" | "neutral" =
    totalPositions > 0 && valuedPositions === totalPositions ? "fresh" : valuedPositions > 0 ? "warn" : "neutral";

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070" }}>Total value</p>
        {formattedValue ? (
          <p className="text-xl font-bold mt-1" style={{ color: "#e4e6f0" }}>
            ${formattedValue}
          </p>
        ) : (
          <p className="text-sm mt-1" style={{ color: "#586070" }}>—</p>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070" }}>Coverage</p>
        <div className="mt-1">
          <ProvenanceChip tone={coverageTone} size="sm">
            {valuedPositions}/{totalPositions} valued
          </ProvenanceChip>
        </div>
      </div>
    </>
  );
}

function AssetHoldingsTable({
  positions,
  chainId,
  walletAddress,
}: {
  positions: DashboardTokenPositionDto[];
  chainId: number;
  walletAddress: string;
}) {
  if (positions.length === 0) {
    return (
      <EmptyState
        title="No asset holdings"
        message="No positions found. Run a sync from Operator › Debug sync to ingest on-chain data."
      />
    );
  }

  return (
    <DataTableShell
      title={`${positions.length} position${positions.length === 1 ? "" : "s"}`}
      subtitle={`chain ${chainId} · backend-resolved · no frontend calculation · click a row to view transactions`}
    >
      <thead>
        <tr>
          <th scope="col" style={thStyle}>Token</th>
          <th scope="col" style={thStyle}>Balance</th>
          <th scope="col" style={thStyle}>Value</th>
          <th scope="col" style={thStyle}>PnL</th>
          <th scope="col" style={thStyle}>Pricing</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <PositionRow key={position.assetId} position={position} walletAddress={walletAddress} chainId={chainId} />
        ))}
      </tbody>
    </DataTableShell>
  );
}

function PositionRow({ position, walletAddress, chainId }: { position: DashboardTokenPositionDto; walletAddress: string; chainId: number }) {
  const router = useRouter();
  const displayAddress = position.assetAddress ?? position.assetId;

  function handleDrillDown() {
    const params = new URLSearchParams({
      walletAddress,
      chainId: String(chainId),
      assetId: position.assetId,
    });
    router.push(`/transactions?${params.toString()}`);
  }

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={`View transactions for ${displayAddress}`}
      onClick={handleDrillDown}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleDrillDown(); }}
      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}
      onMouseEnter={e => { e.currentTarget.style.background = "#1e2438"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      <td style={tdStyle}>
        <div className="flex flex-col gap-1">
          <span
            className="cp-data text-xs font-medium"
            style={{ color: "#e4e6f0" }}
            title={displayAddress}
          >
            {truncateAddress(displayAddress)}
          </span>
          <span className="text-[10px]" style={{ color: "#586070" }}>
            {position.decimals !== null ? `${position.decimals} decimals` : "decimals unknown"}
          </span>
        </div>
      </td>
      <td style={tdStyle}>
        <span className="cp-data text-sm font-medium" style={{ color: "#e4e6f0" }}>
          {position.balanceQuantity}
        </span>
      </td>
      <td style={tdStyle}>
        <ValueDisplay status={position.valuation.status} value={position.valuation.valueQuote} />
      </td>
      <td style={tdStyle}>
        <div className="flex flex-col gap-1">
          <StatusBadge status={position.pnl.status} />
          {position.pnl.unrealizedPnl && (
            <ValueDisplay value={position.pnl.unrealizedPnl} prefix="unrlzd" />
          )}
          {position.pnl.realizedPnl && (
            <ValueDisplay value={position.pnl.realizedPnl} prefix="rlzd" />
          )}
        </div>
      </td>
      <td style={tdStyle}>
        <div className="flex flex-col gap-1">
          <StatusBadge status={position.pricing.status} />
          {position.pricing.sourceType && (
            <span className="text-[10px]" style={{ color: "#586070" }}>
              {position.pricing.sourceType}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#586070",
  textAlign: "left",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  verticalAlign: "top",
};
