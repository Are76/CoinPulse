import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/data-state/empty-state";
import { WarningBanner, WarningList } from "@/components/ui/data-state/warning-banner";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TimestampLabel } from "@/components/ui/value/timestamp-label";
import { ValueDisplay, type ValueState } from "@/components/ui/value/value-display";
import type {
  LiveHoldingsSnapshotDto,
  LiveHoldingsSnapshotValuationStatus,
  LiveSnapshotAssetDto,
} from "@/services/portfolio/live-snapshot-types";

const BALANCE_READ_FAILED_PREFIX = "balance-read-failed:";

const VALUATION_STATUS_TONE: Record<LiveHoldingsSnapshotValuationStatus, "fresh" | "warn" | "stale"> = {
  available: "fresh",
  partial: "warn",
  unavailable: "stale",
};

const VALUATION_STATUS_VALUE_STATE: Record<LiveHoldingsSnapshotValuationStatus, ValueState> = {
  available: "present",
  partial: "present",
  unavailable: "unavailable",
};

function truncateAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function assetIdentityLabel(asset: LiveSnapshotAssetDto) {
  if (asset.symbol) return asset.symbol;
  if (asset.assetAddress) return truncateAddress(asset.assetAddress);
  return asset.assetId;
}

export function LiveSnapshotCard({ snapshot }: { snapshot: LiveHoldingsSnapshotDto }) {
  const assetCount = snapshot.assets.length;
  const pricedCount = snapshot.assets.filter((asset) => asset.priceStatus === "priced").length;
  const unpricedCount = assetCount - pricedCount;
  const warningsCount = snapshot.warnings.length;

  const failedReadWarnings = snapshot.warnings.filter((warning) => warning.startsWith(BALANCE_READ_FAILED_PREFIX));
  const otherWarnings = snapshot.warnings.filter((warning) => !warning.startsWith(BALANCE_READ_FAILED_PREFIX));

  return (
    <SurfaceCard className="flex flex-col gap-5" data-testid="live-snapshot-card">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Live Portfolio</h3>
          <ProvenanceChip tone="info" size="sm">
            Live
          </ProvenanceChip>
          <ProvenanceChip tone="neutral" size="sm">
            Known assets only
          </ProvenanceChip>
        </div>
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span>
            Wallet {truncateAddress(snapshot.wallet.address)} · chain {snapshot.wallet.chainId}
          </span>
          <span>Observed block {snapshot.observedBlock}</span>
          <TimestampLabel label="Observed" value={snapshot.asOf} />
          <span>Source: backend live RPC snapshot</span>
        </div>
      </div>

      {/* Coverage notice */}
      <p className="text-sm leading-6" style={{ color: "var(--color-text-muted)" }}>
        {snapshot.coverageNote} Native PLS and tokens already known to CoinPulse are checked here; a token
        CoinPulse does not yet know about will not appear, and a balance that failed to read is dropped and
        surfaced only as a warning below, never shown as a confirmed zero. Liquidity, farming, lending, and
        other DeFi positions are not included in this Live Portfolio V1 snapshot yet. They are planned as
        separate backend-supported portfolio sections. Historical sync, cost basis, and PnL are separate and
        are not part of this live view — they require the ledger sync workflow, which has not completed for
        this wallet yet.
      </p>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Total value">
          <ValueDisplay
            value={snapshot.totalValueQuote}
            prefix={snapshot.totalValueQuote !== null ? snapshot.quoteAsset : undefined}
            state={VALUATION_STATUS_VALUE_STATE[snapshot.valuationStatus]}
          />
        </SummaryTile>
        <SummaryTile label="Valuation status">
          <ProvenanceChip tone={VALUATION_STATUS_TONE[snapshot.valuationStatus]} size="sm">
            {snapshot.valuationStatus}
          </ProvenanceChip>
        </SummaryTile>
        <SummaryTile label="Assets">
          <span className="cp-data text-sm">
            {pricedCount} priced / {unpricedCount} unpriced ({assetCount} total)
          </span>
        </SummaryTile>
        <SummaryTile label="Quote asset">
          <span className="cp-data text-sm">{snapshot.quoteAsset}</span>
        </SummaryTile>
      </div>

      {/* Warnings */}
      {warningsCount > 0 ? (
        <div className="flex flex-col gap-2">
          {failedReadWarnings.length > 0 ? (
            <WarningBanner tone="warn" title="Balances that could not be read">
              <WarningList warnings={failedReadWarnings} />
            </WarningBanner>
          ) : null}
          {otherWarnings.length > 0 ? (
            <WarningBanner tone="warn" title="Other coverage warnings">
              <WarningList warnings={otherWarnings} />
            </WarningBanner>
          ) : null}
        </div>
      ) : null}

      {/* Asset list */}
      {assetCount === 0 ? (
        <EmptyState
          title="No known balances found"
          message="No native PLS or already-registered token balance was observed for this wallet at the observed block. This does not confirm the wallet holds nothing — Live Portfolio only checks native PLS plus tokens already known to CoinPulse, not full on-chain discovery."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {snapshot.assets.map((asset) => (
            <AssetRow key={asset.assetId} asset={asset} quoteAsset={snapshot.quoteAsset} />
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}

function SummaryTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-3 py-2.5"
    >
      <span
        className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: "var(--color-text-muted)", letterSpacing: "0.08em" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function AssetRow({ asset, quoteAsset }: { asset: LiveSnapshotAssetDto; quoteAsset: string }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium break-all" title={asset.assetId}>
          {assetIdentityLabel(asset)}
        </span>
        <ProvenanceChip tone={asset.priceStatus === "priced" ? "fresh" : "stale"} size="sm">
          {asset.priceStatus === "priced" ? "Priced" : "Price unavailable"}
        </ProvenanceChip>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
        <span>Balance {asset.balanceQuantity} raw units ({asset.decimals} decimals)</span>
        <ValueDisplay
          value={asset.valueQuote}
          prefix={asset.valueQuote !== null ? `≈ ${quoteAsset}` : undefined}
          state={asset.valueQuote !== null ? "present" : "unavailable"}
        />
      </div>

      {asset.priceStatus === "priced" && asset.pricing.sourceType !== null ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
          <span>Source {asset.pricing.sourceType}</span>
          {asset.pricing.observedBlock !== null ? <span>Priced at block {asset.pricing.observedBlock}</span> : null}
          {asset.pricing.observedAt !== null ? <TimestampLabel label="Priced at" value={asset.pricing.observedAt} /> : null}
        </div>
      ) : null}
    </li>
  );
}
