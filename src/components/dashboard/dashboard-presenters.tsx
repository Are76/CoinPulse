import type { FormEvent, ReactNode } from "react";

import Link from "next/link";

import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import {
  WarningBanner,
  WarningList,
} from "@/components/ui/data-state/warning-banner";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { SectionCard } from "@/components/ui/section-card";
import {
  LabelBadge,
  StatusBadge,
  type BadgeTone,
} from "@/components/ui/status/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TimestampLabel } from "@/components/ui/value/timestamp-label";
import { ValueDisplay } from "@/components/ui/value/value-display";
import type { TrackedWalletDto } from "@/lib/api/debug-client";
import { findTrackedWalletMatch } from "@/components/dashboard/dashboard-screen-helpers";
import type {
  DashboardLedgerCoverageDto,
  DashboardLpPositionDto,
  DashboardMaterializationFreshnessDto,
  DashboardPnlCoverageDto,
  DashboardPnlCoverageReason,
  DashboardPnlCoverageSection,
  DashboardPnlCoverageStatus,
  DashboardPnlDto,
  DashboardPricingDto,
  DashboardStakePositionDto,
  DashboardTokenMetadataProvenanceDto,
  DashboardStatus,
  DashboardTokenPositionDto,
  PortfolioDashboardDto,
} from "@/services/dashboard/types";

/* ── Top-level hero ──────────────────────────────────────────────────────── */

export function DashboardHero(args: {
  backendStatusLabel: string;
  backendStatusTone: Exclude<BadgeTone, "danger">;
  pricingStatusLabel: string;
}) {
  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
            CoinPulse
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight" style={{ color: "#e4e6f0" }}>
            Wallet dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: "#a0a8c0" }}>
            Normalized portfolio data from backend DTOs — valuation, pricing confidence, and PnL uncertainty stay visibly labeled.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href="/transactions" className="text-sm font-medium hover:underline" style={{ color: "#818cf8" }}>
              Transaction history →
            </Link>
            <Link href="/hexmining" className="text-sm font-medium hover:underline" style={{ color: "#818cf8" }}>
              HEX mining →
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <LabelBadge label={args.backendStatusLabel} tone={args.backendStatusTone} />
          <LabelBadge label={args.pricingStatusLabel} tone="neutral" />
        </div>
      </div>
    </SurfaceCard>
  );
}

/* ── Backend status ──────────────────────────────────────────────────────── */

export function BackendStatusPanel(args: {
  databaseStatus: string;
  redisStatus: string;
  sourceFamilies: string;
  metaError: string | null;
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <AtlasMetricCard label="Database" value={args.databaseStatus} />
        <AtlasMetricCard label="Redis" value={args.redisStatus} />
        <AtlasMetricCard label="Source families" value={args.sourceFamilies} />
      </div>
      {args.metaError ? (
        <WarningBanner tone="danger" title="Backend error">{args.metaError}</WarningBanner>
      ) : null}
    </>
  );
}

/* ── Wallet query form ───────────────────────────────────────────────────── */

export function WalletQueryForm(args: {
  walletAddress: string;
  chainId: string;
  isLoading: boolean;
  selectedTrackedWalletLabel?: string | null;
  onWalletAddressChange: (value: string) => void;
  onChainIdChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SectionCard title="Query dashboard DTO" subtitle="Load one tracked wallet and one chain at a time.">
      <form
        className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_auto]"
        onSubmit={args.onSubmit}
      >
        <LabeledField label="Wallet address">
          <input
            aria-label="Wallet address"
            className={fieldClassName}
            placeholder="0x..."
            value={args.walletAddress}
            onChange={(event) => args.onWalletAddressChange(event.target.value)}
          />
        </LabeledField>
        <LabeledField label="Chain ID">
          <input
            aria-label="Chain ID"
            className={fieldClassName}
            inputMode="numeric"
            value={args.chainId}
            onChange={(event) => args.onChainIdChange(event.target.value)}
          />
        </LabeledField>
        <div className="flex items-end">
          <button type="submit" className={submitButtonClassName}>
            {args.isLoading ? "Loading…" : "Load dashboard"}
          </button>
        </div>
      </form>
      {args.selectedTrackedWalletLabel != null ? (
        <p className="mt-3 text-xs" style={{ color: "#a0a8c0" }}>
          Selected tracked wallet: {args.selectedTrackedWalletLabel} — click Load dashboard to submit.
        </p>
      ) : null}
    </SectionCard>
  );
}

/* ── Tracked wallet selector ─────────────────────────────────────────────── */

export function TrackedWalletSelector(args: {
  wallets: TrackedWalletDto[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onSelectWallet: (address: string, chainId: string) => void;
  selectedWalletAddress?: string;
  selectedChainId?: string;
}) {
  const matchedWallet = !args.isLoading && !args.isError
    ? findTrackedWalletMatch(args.wallets, args.selectedWalletAddress ?? "", args.selectedChainId ?? "")
    : null;

  return (
    <SectionCard title="Tracked wallets" subtitle="Select a wallet to populate the address field, then click Load dashboard.">
      {args.isLoading ? (
        <p className="text-sm" style={{ color: "#586070" }}>Loading tracked wallets…</p>
      ) : null}

      {args.isError ? (
        <p className="text-sm" style={{ color: "#586070" }}>Could not load tracked wallets. Use manual entry.</p>
      ) : null}

      {!args.isLoading && !args.isError && args.wallets?.length === 0 ? (
        <p className="text-sm" style={{ color: "#586070" }}>
          No tracked wallets yet.{" "}
          <Link href="/debug/wallets/import" className="font-medium hover:underline" style={{ color: "#818cf8" }}>
            Import a wallet
          </Link>
        </p>
      ) : null}

      {!args.isLoading && !args.isError && args.wallets && args.wallets.length > 0 ? (
        <div className="flex flex-col" style={{ gap: "1px" }}>
          {args.wallets.map((wallet) => {
            const isSelected = matchedWallet !== null && wallet.id === matchedWallet.id;
            return (
              <button
                key={wallet.id}
                type="button"
                aria-label={`Select wallet ${wallet.address}`}
                className="flex items-start justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors duration-100"
                style={{ background: isSelected ? "rgba(129,140,248,0.08)" : "transparent" }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#1e2438"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                onClick={() => args.onSelectWallet(wallet.address, String(wallet.chainId))}
              >
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <p className="truncate text-sm" style={{ color: "#e4e6f0", fontFamily: "var(--font-mono-data), monospace" }}>
                    {wallet.address}
                  </p>
                  <p className="text-xs" style={{ color: "#586070" }}>
                    Chain ID: {wallet.chainId}
                  </p>
                  {wallet.label ? (
                    <p className="text-xs" style={{ color: "#a0a8c0" }}>{wallet.label}</p>
                  ) : null}
                </div>
                {isSelected ? <LabelBadge label="Selected" tone="fresh" size="sm" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </SectionCard>
  );
}

export function SubmittedWalletSourceIndicator({ source }: { source: string | null }) {
  if (source === null) return null;
  return <p className="text-sm" style={{ color: "#586070" }}>{source}</p>;
}

/* ── State cards ─────────────────────────────────────────────────────────── */

export function IdleStateCard() {
  return (
    <EmptyState
      title="No portfolio loaded"
      message="Enter a wallet address and chain to request the normalized dashboard DTO. Missing valuation or PnL will stay marked as unavailable, stale, unsupported, or incomplete rather than rendered as zero."
    />
  );
}

export function LoadingStateCard() {
  return (
    <SurfaceCard className="grid gap-4 md:grid-cols-4">
      <LoadingState />
    </SurfaceCard>
  );
}

export function ErrorStateCard({ message }: { message: string }) {
  return <ErrorState title="Dashboard request failed" message={message} />;
}

/* ── Portfolio summary ───────────────────────────────────────────────────── */

export function PortfolioSummarySection({ dashboard }: { dashboard: PortfolioDashboardDto }) {
  const isPartial = dashboard.summary.valuationStatus === "partial";

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <AtlasMetricCard label="Wallet" value={truncateAddress(dashboard.wallet.address)} />
        <AtlasMetricCard label="Chain" value={String(dashboard.wallet.chainId)} />
        <AtlasMetricCard
          label={isPartial ? "Partial valuation" : "Total value"}
          value={formatNullable(dashboard.summary.totalValueQuote)}
          status={dashboard.summary.valuationStatus}
          hint={isPartial ? `excludes ${dashboard.summary.valuationCoverage.unvaluedPositions} unpriced` : undefined}
          highlight
        />
        <AtlasMetricCard
          label="Coverage"
          value={formatCoverage(dashboard.summary.valuationCoverage)}
          status={dashboard.summary.valuationStatus}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <AtlasSummaryCard label="Quote asset" value={dashboard.quoteAsset} hint="Backend-selected valuation quote asset" />
        <AtlasSummaryCard label="As of" value={dashboard.asOf} hint="Resolved dashboard timestamp" isTimestamp />
        <AtlasSummaryCard label="Schema" value={dashboard.schemaVersion} hint="Dashboard DTO contract version" />
      </div>
      {dashboard.summary.warnings.length > 0 ? (
        <WarningBanner tone="warn" title="Portfolio warnings">
          <WarningList warnings={dashboard.summary.warnings} />
        </WarningBanner>
      ) : null}
    </>
  );
}

/* ── Materialization freshness ───────────────────────────────────────────── */

export function MaterializationFreshnessSection({ freshness }: { freshness: DashboardMaterializationFreshnessDto }) {
  const tone: BadgeTone = freshness.status === "fresh" ? "fresh" : freshness.status === "stale" ? "warn" : "neutral";
  const label = freshness.status === "fresh" ? "Fresh" : freshness.status === "stale" ? "Stale" : "Unknown";

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          Materialization freshness
        </span>
        <LabelBadge label={label} tone={tone} size="sm" />
      </div>
      {freshness.reason != null ? (
        <p className="text-xs" style={{ color: "#a0a8c0" }}>{freshness.reason}</p>
      ) : null}
      <div className="flex flex-wrap gap-4 items-center">
        {freshness.lastMaterializedAt != null ? (
          <TimestampLabel label="Last materialized:" value={freshness.lastMaterializedAt} />
        ) : null}
        {freshness.staleAfterSeconds != null ? (
          <span className="text-xs" style={{ color: "#586070" }}>Stale after: {freshness.staleAfterSeconds}s</span>
        ) : null}
        <Link href="/debug/prices/status" className="text-xs font-medium hover:underline" style={{ color: "#818cf8" }}>
          View pricing status →
        </Link>
      </div>
    </SurfaceCard>
  );
}

/* ── Ledger coverage ─────────────────────────────────────────────────────── */

export function LedgerCoverageSection({ ledgerCoverage }: { ledgerCoverage: DashboardLedgerCoverageDto }) {
  const tone: BadgeTone = ledgerCoverage.status === "covered" ? "fresh" : ledgerCoverage.status === "partial" ? "warn" : "neutral";
  const label = ledgerCoverage.status === "covered" ? "Covered" : ledgerCoverage.status === "partial" ? "Partial" : "Unknown";

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          Ledger coverage
        </span>
        <LabelBadge label={label} tone={tone} size="sm" />
      </div>
      {ledgerCoverage.reason != null ? (
        <p className="text-xs" style={{ color: "#a0a8c0" }}>{ledgerCoverage.reason}</p>
      ) : null}
      <div className="flex flex-wrap gap-4">
        {ledgerCoverage.fromBlock != null && (
          <span className="text-xs" style={{ color: "#a0a8c0", fontFamily: "var(--font-mono-data), monospace" }}>
            From block {ledgerCoverage.fromBlock}
          </span>
        )}
        {ledgerCoverage.toBlock != null && (
          <span className="text-xs" style={{ color: "#a0a8c0", fontFamily: "var(--font-mono-data), monospace" }}>
            To block {ledgerCoverage.toBlock}
          </span>
        )}
        {ledgerCoverage.sourceFamilies.length > 0 && (
          <span className="text-xs" style={{ color: "#586070" }}>
            Sources: {ledgerCoverage.sourceFamilies.join(", ")}
          </span>
        )}
      </div>
    </SurfaceCard>
  );
}

/* ── PnL coverage ────────────────────────────────────────────────────────── */

export function PnlCoverageSection({ pnlCoverage }: { pnlCoverage: DashboardPnlCoverageDto }) {
  const { label, tone } = formatPnlCoverageStatus(pnlCoverage.status);

  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          PnL coverage
        </span>
        <LabelBadge label={label} tone={tone} size="sm" />
      </div>

      {pnlCoverage.reasons.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pnlCoverage.reasons.map((reason) => (
            <LabelBadge key={reason} label={formatPnlCoverageReason(reason)} tone="neutral" size="sm" />
          ))}
        </div>
      ) : null}

      {pnlCoverage.affectedSections.length > 0 ? (
        <p className="text-xs" style={{ color: "#a0a8c0" }}>
          Affected sections: {pnlCoverage.affectedSections.map(formatPnlCoverageSection).join(", ")}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <CoverageCount label="Priced" value={pnlCoverage.pricedPositionsCount} />
        <CoverageCount label="Unpriced" value={pnlCoverage.unpricedPositionsCount} />
        <CoverageCount label="Unsupported" value={pnlCoverage.unsupportedPositionsCount} />
        <CoverageCount label="Incomplete basis" value={pnlCoverage.incompleteBasisPositionsCount} />
        <CoverageCount label="Stale price" value={pnlCoverage.stalePricePositionsCount} />
        <CoverageCount label="Source disabled" value={pnlCoverage.sourceDisabledPositionsCount} />
      </div>

      <TimestampLabel label="As of" value={pnlCoverage.asOf} />
    </SurfaceCard>
  );
}

/* ── Position tables ─────────────────────────────────────────────────────── */

export function TokenPositionsTable({ positions }: { positions: DashboardTokenPositionDto[] }) {
  if (positions.length === 0) {
    return <EmptyState title="Token positions" message="No token positions were materialized for this wallet and chain." />;
  }

  return (
    <DataTableShell
      title="Token positions"
      subtitle="Backend-resolved balances, pricing provenance, valuation status, and PnL warnings."
    >
      <thead>
        <tr>
          <th>Asset</th>
          <th>Quantity</th>
          <th>Valuation</th>
          <th>Pricing</th>
          <th>PnL</th>
          <th>Warnings</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.assetId}>
            <td>
              <div className="flex flex-col gap-1.5">
                <span className="cp-data text-xs" style={{ color: "#e4e6f0" }}>
                  {position.assetAddress ?? position.assetId}
                </span>
                <StatusBadge status={position.pricing.status} />
                <MetadataProvenanceDetails provenance={position.metadataProvenance} />
              </div>
            </td>
            <td className="cp-data">{position.balanceQuantity}</td>
            <td>
              <ValueDisplay status={position.valuation.status} value={position.valuation.valueQuote} />
            </td>
            <td>
              <PricingDetails pricing={position.pricing} />
            </td>
            <td>
              <PnlDetails pnl={position.pnl} />
            </td>
            <td>
              <WarningList warnings={[
                ...position.pricing.rejectedReasons,
                ...position.pnl.warnings.map((w) => w.detail),
              ]} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}

export function LpPositionsTable({ positions }: { positions: DashboardLpPositionDto[] }) {
  if (positions.length === 0) {
    return <EmptyState title="LP positions" message="No LP positions were materialized for this wallet and chain." />;
  }

  return (
    <DataTableShell title="LP positions" subtitle="Position quantities are shown even when valuation or PnL is unsupported.">
      <thead>
        <tr>
          <th>LP token</th>
          <th>LP quantity</th>
          <th>Underlying</th>
          <th>Valuation</th>
          <th>PnL</th>
          <th>Warnings</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.lpAssetId}>
            <td className="cp-data">{position.lpTokenAddress ?? position.lpAssetId}</td>
            <td className="cp-data">{position.lpTokenQuantity}</td>
            <td>
              <div className="flex flex-col gap-0.5 cp-data text-xs">
                <span style={{ color: "#a0a8c0" }}>{position.token0Address ?? "n/a"}: {position.token0NetQuantity ?? "n/a"}</span>
                <span style={{ color: "#a0a8c0" }}>{position.token1Address ?? "n/a"}: {position.token1NetQuantity ?? "n/a"}</span>
              </div>
            </td>
            <td>
              <ValueDisplay status={position.valuation.status} value={position.valuation.valueQuote} />
            </td>
            <td>
              <StatusBadge status={position.pnl.status} />
            </td>
            <td>
              <WarningList warnings={[...position.warnings, ...position.pnl.warnings.map((w) => w.detail)]} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}

export function StakePositionsTable({ positions }: { positions: DashboardStakePositionDto[] }) {
  if (positions.length === 0) {
    return <EmptyState title="Stake positions" message="No stake positions were materialized for this wallet and chain." />;
  }

  return (
    <DataTableShell title="Stake positions" subtitle="Principal, lifecycle state, and backend warnings without fabricated valuation.">
      <thead>
        <tr>
          <th>Stake key</th>
          <th>Token</th>
          <th>Principal</th>
          <th>Status</th>
          <th>Valuation</th>
          <th>PnL</th>
          <th>Warnings</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.stakeKey}>
            <td className="cp-data">{position.stakeKey}</td>
            <td className="cp-data">{position.tokenAddress ?? position.tokenAssetId}</td>
            <td className="cp-data">{position.principalQuantity}</td>
            <td>
              <LabelBadge label={position.status} tone="neutral" size="sm" />
            </td>
            <td>
              <ValueDisplay status={position.valuation.status} value={position.valuation.valueQuote} />
            </td>
            <td>
              <StatusBadge status={position.pnl.status} />
            </td>
            <td>
              <WarningList warnings={[...position.warnings, ...position.pnl.warnings.map((w) => w.detail)]} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}

/* ── Private helpers ─────────────────────────────────────────────────────── */

function AtlasMetricCard(args: {
  label: string;
  value: string;
  status?: DashboardStatus;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-all duration-200"
      style={{
        background: args.highlight
          ? "linear-gradient(135deg, #111520 0%, #141828 100%)"
          : "#111520",
        border: args.highlight
          ? "1px solid rgba(129,140,248,0.2)"
          : "1px solid rgba(255,255,255,0.065)",
        boxShadow: args.highlight
          ? "0 0 0 1px rgba(129,140,248,0.05), 0 4px 20px rgba(0,0,0,0.35)"
          : "0 2px 12px rgba(0,0,0,0.25)",
      }}
    >
      {args.highlight && (
        <div className="h-px -mx-4 -mt-4 mb-0" style={{ background: "linear-gradient(90deg, transparent, rgba(129,140,248,0.4), transparent)" }} />
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          {args.label}
        </span>
        {args.status ? <StatusBadge status={args.status} /> : null}
      </div>
      <span className="text-xl font-bold leading-tight cp-data" style={{ color: "#e4e6f0" }}>
        {args.value}
      </span>
      {args.hint ? (
        <span className="text-xs" style={{ color: "#a0a8c0" }}>{args.hint}</span>
      ) : null}
    </div>
  );
}

function AtlasSummaryCard(args: {
  label: string;
  value: string;
  hint: string;
  isTimestamp?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{ background: "#111520", border: "1px solid rgba(255,255,255,0.065)", boxShadow: "0 2px 12px rgba(0,0,0,0.25)" }}
    >
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
        {args.label}
      </span>
      <span className="text-sm cp-data" style={{ color: "#e4e6f0" }}>
        {args.isTimestamp ? <TimestampLabel value={args.value} /> : args.value}
      </span>
      <span className="text-xs" style={{ color: "#586070" }}>{args.hint}</span>
    </div>
  );
}

function CoverageCount({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1.5"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.055)" }}
    >
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span className="text-sm cp-data font-bold" style={{ color: value > 0 ? "#e4e6f0" : "#586070" }}>
        {value}
      </span>
    </div>
  );
}

function MetadataProvenanceDetails({ provenance }: { provenance: DashboardTokenMetadataProvenanceDto }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      {provenance.status === "observed" ? (
        <span style={{ color: "#4ade80" }}>Observed metadata</span>
      ) : provenance.status === "unknown" ? (
        <span style={{ color: "#586070" }}>Metadata status unknown</span>
      ) : (
        <span style={{ color: "#a0a8c0" }}>Metadata status: {provenance.status}</span>
      )}

      {provenance.source === "chain" ? (
        <span style={{ color: "#a0a8c0" }}>Metadata observed from RPC</span>
      ) : provenance.source === "unknown" ? (
        <span style={{ color: "#586070" }}>Metadata source unknown</span>
      ) : (
        <span style={{ color: "#a0a8c0" }}>Metadata source: {provenance.source}</span>
      )}

      <span style={{ color: "#586070" }}>Metadata confidence: {provenance.confidence}</span>

      <TimestampLabel label="metadata observed" value={provenance.observedAt} fallback="Metadata observation unavailable" />

      {provenance.conflictReason != null ? (
        <span style={{ color: "#f59e0b" }}>Metadata conflict: {provenance.conflictReason}</span>
      ) : null}
    </div>
  );
}

function PricingDetails({ pricing }: { pricing: DashboardPricingDto }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge status={pricing.status} />
      <ValueDisplay value={pricing.confidence} prefix="confidence" />
      <span className="text-xs" style={{ color: "#586070" }}>
        {pricing.sourceType ?? "no source"}
        {pricing.sourceId ? ` · ${pricing.sourceId}` : ""}
      </span>
      <TimestampLabel label="observed" value={pricing.observedAt} fallback="Unavailable" />
    </div>
  );
}

function PnlDetails({ pnl }: { pnl: DashboardPnlDto }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge status={pnl.status} />
      <ValueDisplay value={pnl.unrealizedPnl} />
      <ValueDisplay value={pnl.averageCost} prefix="avg cost" />
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

/* ── Formatters ──────────────────────────────────────────────────────────── */

function formatPnlCoverageStatus(status: DashboardPnlCoverageStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case "valued":      return { label: "Valued",      tone: "fresh" };
    case "partial":     return { label: "Partial",     tone: "warn" };
    case "unavailable": return { label: "Unavailable", tone: "stale" };
    case "unsupported": return { label: "Unsupported", tone: "stale" };
    case "unknown":     return { label: "Unknown",     tone: "neutral" };
  }
}

function formatPnlCoverageReason(reason: DashboardPnlCoverageReason) {
  return reason.replaceAll("_", " ");
}

function formatPnlCoverageSection(section: DashboardPnlCoverageSection) {
  switch (section) {
    case "summary":        return "summary";
    case "tokens":         return "tokens";
    case "lpPositions":    return "LP positions";
    case "stakePositions": return "stake positions";
  }
}

function formatMetadataProvenanceStatus(status: DashboardTokenMetadataProvenanceDto["status"]) {
  switch (status) {
    case "observed":    return "Observed";
    case "verified":    return "Verified";
    case "conflicting": return "Conflicting";
    case "stale":       return "Stale";
    case "unknown":     return "Unknown";
  }
}

function formatMetadataProvenanceSource(source: DashboardTokenMetadataProvenanceDto["source"]) {
  switch (source) {
    case "chain":   return "RPC";
    case "scanner": return "Scanner";
    case "manual":  return "Manual";
    case "derived": return "Derived";
    case "unknown": return "Unknown";
  }
}

function truncateAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatNullable(value: string | null) {
  return value ?? "—";
}

function formatCoverage(value: PortfolioDashboardDto["summary"]["valuationCoverage"]) {
  return `${value.valuedPositions}/${value.totalPositions}`;
}

/* ── Shared style constants ──────────────────────────────────────────────── */

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border px-3 text-sm outline-none transition"
  + " bg-[#181d2c] text-[#e4e6f0] placeholder:text-[#586070]"
  + " border-[rgba(255,255,255,0.065)] focus:border-[#818cf8]";

const submitButtonClassName =
  "inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] px-4 font-semibold text-sm transition hover:opacity-90"
  + " bg-[#818cf8] text-white";
