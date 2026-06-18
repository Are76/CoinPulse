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

export function DashboardHero(args: {
  backendStatusLabel: string;
  backendStatusTone: Exclude<BadgeTone, "danger">;
  pricingStatusLabel: string;
}) {
  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
            CoinPulse
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Wallet dashboard
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-[color:var(--color-text-muted)]">
            Frontend consumes normalized portfolio data from backend DTOs only.
            Valuation, pricing confidence, and PnL uncertainty remain visibly
            labeled instead of inferred in the browser.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/transactions"
              className="text-sm font-medium text-[color:var(--color-accent-2)] hover:underline"
            >
              Transaction history →
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <LabelBadge
            label={args.backendStatusLabel}
            tone={args.backendStatusTone}
          />
          <LabelBadge label={args.pricingStatusLabel} tone="neutral" />
        </div>
      </div>
    </SurfaceCard>
  );
}

export function BackendStatusPanel(args: {
  databaseStatus: string;
  redisStatus: string;
  sourceFamilies: string;
  metaError: string | null;
}) {
  return (
    <>
      <SurfaceCard className="grid gap-4 md:grid-cols-3">
        <MetaStat label="Database" value={args.databaseStatus} />
        <MetaStat label="Redis" value={args.redisStatus} />
        <MetaStat label="Source families" value={args.sourceFamilies} />
      </SurfaceCard>
      {args.metaError ? <WarningBanner>{args.metaError}</WarningBanner> : null}
    </>
  );
}

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
    <SectionCard
      title="Query dashboard DTO"
      subtitle="Load one tracked wallet and one chain at a time. The frontend only renders the backend response; it does not reconstruct balances or valuation locally."
    >
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
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--color-accent-2)] bg-[color:var(--color-accent-2)] px-4 font-medium text-slate-950 transition hover:opacity-90"
          >
            {args.isLoading ? "Loading..." : "Load dashboard"}
          </button>
        </div>
      </form>
      {args.selectedTrackedWalletLabel != null ? (
        <p className="mt-3 text-sm text-[color:var(--color-text-muted)]">
          Selected tracked wallet: {args.selectedTrackedWalletLabel} - will be used when you click Load dashboard.
        </p>
      ) : null}
    </SectionCard>
  );
}

export function TrackedWalletSelector(args: {
  wallets: TrackedWalletDto[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onSelectWallet: (address: string, chainId: string) => void;
  selectedWalletAddress?: string;
  selectedChainId?: string;
}) {
  const matchedWallet = !args.isLoading && !args.isError
    ? findTrackedWalletMatch(
        args.wallets,
        args.selectedWalletAddress ?? "",
        args.selectedChainId ?? "",
      )
    : null;

  return (
    <SectionCard
      title="Tracked wallets"
      subtitle="Select a tracked wallet to populate the address and chain fields. Selecting does not load the dashboard — use the Load dashboard button to fetch."
    >
      {args.isLoading ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Loading tracked wallets…
        </p>
      ) : null}

      {args.isError ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Could not load tracked wallets. Use manual entry below.
        </p>
      ) : null}

      {!args.isLoading && !args.isError && args.wallets !== undefined && args.wallets.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          No tracked wallets yet.{" "}
          <Link
            href="/debug/wallets/import"
            className="font-medium text-[color:var(--color-accent-2)] hover:underline"
          >
            Import a wallet
          </Link>{" "}
          or use manual entry below.
        </p>
      ) : null}

      {!args.isLoading && !args.isError && args.wallets !== undefined && args.wallets.length > 0 ? (
        <div className="flex flex-col divide-y divide-[color:var(--color-border-soft)]">
          {args.wallets.map((wallet) => {
            const isSelected = matchedWallet !== null && wallet.id === matchedWallet.id;

            return (
              <button
                key={wallet.id}
                type="button"
                aria-label={`Select wallet ${wallet.address}`}
                className="flex items-start justify-between gap-4 py-3 text-left transition hover:opacity-80"
                onClick={() => args.onSelectWallet(wallet.address, String(wallet.chainId))}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{wallet.address}</p>
                  <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
                    Chain ID: {wallet.chainId}
                  </p>
                  <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">
                    {wallet.label ?? "Unlabeled"}
                  </p>
                </div>
                {isSelected ? (
                  <div className="flex items-center self-center">
                    <LabelBadge label="Selected" tone="fresh" />
                  </div>
                ) : null}
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
  return (
    <p className="text-sm text-[color:var(--color-text-muted)]">
      {source}
    </p>
  );
}

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

export function PortfolioSummarySection({
  dashboard,
}: {
  dashboard: PortfolioDashboardDto;
}) {
  return (
    <>
      <SurfaceCard className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Wallet" value={truncateAddress(dashboard.wallet.address)} />
        <MetricCard label="Chain" value={String(dashboard.wallet.chainId)} />
        <MetricCard
          label={dashboard.summary.valuationCoverage.unvaluedPositions > 0 ? "Partial valuation" : "Summary valuation"}
          value={formatNullable(dashboard.summary.totalValueQuote)}
          status={dashboard.summary.valuationStatus}
          hint={dashboard.summary.valuationCoverage.unvaluedPositions > 0
            ? `excludes ${dashboard.summary.valuationCoverage.unvaluedPositions} unpriced`
            : undefined}
        />
        <MetricCard
          label="Coverage"
          value={formatCoverage(dashboard.summary.valuationCoverage)}
          status={dashboard.summary.valuationStatus}
        />
      </SurfaceCard>
      <SurfaceCard className="grid gap-4 md:grid-cols-3">
        <SummaryMetaStat
          label="Quote asset"
          value={dashboard.quoteAsset}
          hint="Backend-selected valuation quote asset"
        />
        <SummaryMetaStat
          label="As of"
          value={dashboard.asOf}
          hint="Resolved dashboard timestamp"
          isTimestamp
        />
        <SummaryMetaStat
          label="Schema"
          value={dashboard.schemaVersion}
          hint="Dashboard DTO contract version"
        />
      </SurfaceCard>
      {dashboard.summary.warnings.length > 0 ? (
        <WarningBanner>
          <WarningList warnings={dashboard.summary.warnings} />
        </WarningBanner>
      ) : null}
    </>
  );
}

export function MaterializationFreshnessSection({
  freshness,
}: {
  freshness: DashboardMaterializationFreshnessDto;
}) {
  const tone: BadgeTone =
    freshness.status === "fresh"
      ? "fresh"
      : freshness.status === "stale"
        ? "warn"
        : "neutral";

  const label =
    freshness.status === "fresh"
      ? "Fresh"
      : freshness.status === "stale"
        ? "Stale"
        : "Unknown";

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
          Materialization freshness
        </span>
        <LabelBadge label={label} tone={tone} />
      </div>
      {freshness.reason != null ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">{freshness.reason}</p>
      ) : null}
      <div className="flex flex-wrap gap-4">
        {freshness.lastMaterializedAt != null ? (
          <TimestampLabel
            label="Last materialized:"
            value={freshness.lastMaterializedAt}
          />
        ) : null}
        {freshness.staleAfterSeconds != null ? (
          <span className="text-xs text-[color:var(--color-text-muted)]">
            Stale after: {freshness.staleAfterSeconds} seconds
          </span>
        ) : null}
        <Link
          href="/debug/prices/status"
          className="text-xs font-medium text-[color:var(--color-accent-2)] hover:underline"
        >
          View pricing source status
        </Link>
      </div>
    </SurfaceCard>
  );
}

export function LedgerCoverageSection({
  ledgerCoverage,
}: {
  ledgerCoverage: DashboardLedgerCoverageDto;
}) {
  const tone: BadgeTone =
    ledgerCoverage.status === "covered"
      ? "fresh"
      : ledgerCoverage.status === "partial"
        ? "warn"
        : "neutral";

  const label =
    ledgerCoverage.status === "covered"
      ? "Covered"
      : ledgerCoverage.status === "partial"
        ? "Partial"
        : "Unknown";

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
          Ledger coverage
        </span>
        <LabelBadge label={label} tone={tone} />
      </div>
      {ledgerCoverage.reason != null ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">{ledgerCoverage.reason}</p>
      ) : null}
      <div className="flex flex-wrap gap-4">
        {ledgerCoverage.fromBlock != null ? (
          <span className="text-xs text-[color:var(--color-text-muted)]">
            From block: {ledgerCoverage.fromBlock}
          </span>
        ) : null}
        {ledgerCoverage.toBlock != null ? (
          <span className="text-xs text-[color:var(--color-text-muted)]">
            To block: {ledgerCoverage.toBlock}
          </span>
        ) : null}
        {ledgerCoverage.sourceFamilies.length > 0 ? (
          <span className="text-xs text-[color:var(--color-text-muted)]">
            Sources: {ledgerCoverage.sourceFamilies.join(", ")}
          </span>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

export function PnlCoverageSection({
  pnlCoverage,
}: {
  pnlCoverage: DashboardPnlCoverageDto;
}) {
  const { label, tone } = formatPnlCoverageStatus(pnlCoverage.status);

  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
          PnL coverage
        </span>
        <LabelBadge label={label} tone={tone} />
      </div>

      {pnlCoverage.reasons.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pnlCoverage.reasons.map((reason) => (
            <LabelBadge
              key={reason}
              label={formatPnlCoverageReason(reason)}
              tone="neutral"
            />
          ))}
        </div>
      ) : null}

      {pnlCoverage.affectedSections.length > 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">
          Affected sections:{" "}
          {pnlCoverage.affectedSections.map(formatPnlCoverageSection).join(", ")}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <CoverageCount label="Priced" value={pnlCoverage.pricedPositionsCount} />
        <CoverageCount label="Unpriced" value={pnlCoverage.unpricedPositionsCount} />
        <CoverageCount label="Unsupported" value={pnlCoverage.unsupportedPositionsCount} />
        <CoverageCount
          label="Incomplete basis"
          value={pnlCoverage.incompleteBasisPositionsCount}
        />
        <CoverageCount label="Stale price" value={pnlCoverage.stalePricePositionsCount} />
        <CoverageCount
          label="Source disabled"
          value={pnlCoverage.sourceDisabledPositionsCount}
        />
      </div>

      <TimestampLabel label="As of" value={pnlCoverage.asOf} />
    </SurfaceCard>
  );
}

export function TokenPositionsTable({
  positions,
}: {
  positions: DashboardTokenPositionDto[];
}) {
  if (positions.length === 0) {
    return (
      <EmptyState
        title="Token positions"
        message="No token positions were materialized for this wallet and chain."
      />
    );
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
              <div className="flex flex-col gap-2">
                <span className="cp-data">{position.assetAddress ?? position.assetId}</span>
                <StatusBadge status={position.pricing.status} />
                <MetadataProvenanceDetails provenance={position.metadataProvenance} />
              </div>
            </td>
            <td className="cp-data">{position.balanceQuantity}</td>
            <td>
              <ValueDisplay
                status={position.valuation.status}
                value={position.valuation.valueQuote}
              />
            </td>
            <td>
              <PricingDetails pricing={position.pricing} />
            </td>
            <td>
              <PnlDetails pnl={position.pnl} />
            </td>
            <td>
              <WarningList
                warnings={[
                  ...position.pricing.rejectedReasons,
                  ...position.pnl.warnings.map((warning) => warning.detail),
                ]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}

export function LpPositionsTable({
  positions,
}: {
  positions: DashboardLpPositionDto[];
}) {
  if (positions.length === 0) {
    return (
      <EmptyState
        title="LP positions"
        message="No LP positions were materialized for this wallet and chain."
      />
    );
  }

  return (
    <DataTableShell
      title="LP positions"
      subtitle="Position quantities are shown even when valuation or PnL is unsupported."
    >
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
              <div className="flex flex-col gap-1 cp-data">
                <span>
                  {position.token0Address ?? "n/a"}: {position.token0NetQuantity ?? "n/a"}
                </span>
                <span>
                  {position.token1Address ?? "n/a"}: {position.token1NetQuantity ?? "n/a"}
                </span>
              </div>
            </td>
            <td>
              <ValueDisplay
                status={position.valuation.status}
                value={position.valuation.valueQuote}
              />
            </td>
            <td>
              <StatusBadge status={position.pnl.status} />
            </td>
            <td>
              <WarningList
                warnings={[
                  ...position.warnings,
                  ...position.pnl.warnings.map((warning) => warning.detail),
                ]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}

export function StakePositionsTable({
  positions,
}: {
  positions: DashboardStakePositionDto[];
}) {
  if (positions.length === 0) {
    return (
      <EmptyState
        title="Stake positions"
        message="No stake positions were materialized for this wallet and chain."
      />
    );
  }

  return (
    <DataTableShell
      title="Stake positions"
      subtitle="Principal, lifecycle state, and backend warnings are shown without fabricated valuation."
    >
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
              <LabelBadge label={position.status} tone="neutral" />
            </td>
            <td>
              <ValueDisplay
                status={position.valuation.status}
                value={position.valuation.valueQuote}
              />
            </td>
            <td>
              <StatusBadge status={position.pnl.status} />
            </td>
            <td>
              <WarningList
                warnings={[
                  ...position.warnings,
                  ...position.pnl.warnings.map((warning) => warning.detail),
                ]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTableShell>
  );
}

function formatPnlCoverageStatus(status: DashboardPnlCoverageStatus): {
  label: string;
  tone: BadgeTone;
} {
  switch (status) {
    case "valued":
      return { label: "Valued", tone: "fresh" };
    case "partial":
      return { label: "Partial", tone: "warn" };
    case "unavailable":
      return { label: "Unavailable", tone: "neutral" };
    case "unsupported":
      return { label: "Unsupported", tone: "neutral" };
    case "unknown":
      return { label: "Unknown", tone: "neutral" };
  }
}

function formatPnlCoverageReason(reason: DashboardPnlCoverageReason) {
  return reason.replaceAll("_", " ");
}

function formatPnlCoverageSection(section: DashboardPnlCoverageSection) {
  switch (section) {
    case "summary":
      return "summary";
    case "tokens":
      return "tokens";
    case "lpPositions":
      return "LP positions";
    case "stakePositions":
      return "stake positions";
  }
}

function CoverageCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-2 cp-data text-sm">{value}</div>
    </div>
  );
}

function MetadataProvenanceDetails({
  provenance,
}: {
  provenance: DashboardTokenMetadataProvenanceDto;
}) {
  const statusLabel = formatMetadataProvenanceStatus(provenance.status);
  const sourceLabel = formatMetadataProvenanceSource(provenance.source);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <LabelBadge label={statusLabel} tone="neutral" />
        <LabelBadge label={sourceLabel} tone="neutral" />
      </div>
      <span className="text-xs text-[color:var(--color-text-muted)]">
        Metadata confidence: {provenance.confidence}
      </span>
      <TimestampLabel
        label="metadata observed"
        value={provenance.observedAt}
        fallback="Metadata observation unavailable"
      />
      {provenance.conflictReason != null ? (
        <span className="text-xs text-[color:var(--color-text-muted)]">
          Metadata conflict: {provenance.conflictReason}
        </span>
      ) : null}
    </div>
  );
}

function formatMetadataProvenanceStatus(
  status: DashboardTokenMetadataProvenanceDto["status"],
) {
  switch (status) {
    case "observed":
      return "Observed metadata";
    case "unknown":
      return "Metadata status unknown";
    case "verified":
    case "conflicting":
    case "stale":
      return `Metadata status: ${status}`;
  }
}

function formatMetadataProvenanceSource(
  source: DashboardTokenMetadataProvenanceDto["source"],
) {
  switch (source) {
    case "chain":
      return "Metadata observed from RPC";
    case "scanner":
    case "manual":
    case "derived":
      return "Metadata source: " + source;
    case "unknown":
      return "Metadata source unknown";
  }
}

function PricingDetails({ pricing }: { pricing: DashboardPricingDto }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge status={pricing.status} />
      <ValueDisplay value={pricing.confidence} prefix="confidence" />
      <span className="text-xs text-[color:var(--color-text-muted)]">
        {pricing.sourceType ?? "no source"}
        {pricing.sourceId ? ` - ${pricing.sourceId}` : ""}
      </span>
      <TimestampLabel
        label="observed"
        value={pricing.observedAt}
        fallback="Observation unavailable"
      />
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

function MetricCard(args: {
  label: string;
  value: string;
  status?: DashboardStatus;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
          {args.label}
        </span>
        {args.status ? <StatusBadge status={args.status} /> : null}
      </div>
      <p className="mt-4 cp-data text-lg">{args.value}</p>
      {args.hint ? (
        <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">{args.hint}</p>
      ) : null}
    </div>
  );
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-3 cp-data text-sm">{value}</div>
    </div>
  );
}

function SummaryMetaStat(args: {
  label: string;
  value: string;
  hint: string;
  isTimestamp?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {args.label}
      </div>
      <div className="mt-3 cp-data text-sm">
        {args.isTimestamp ? <TimestampLabel value={args.value} /> : args.value}
      </div>
      <div className="mt-2 text-xs text-[color:var(--color-text-muted)]">
        {args.hint}
      </div>
    </div>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function truncateAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatNullable(value: string | null) {
  return value ?? "n/a";
}

function formatCoverage(value: PortfolioDashboardDto["summary"]["valuationCoverage"]) {
  return `${value.valuedPositions}/${value.totalPositions} valued`;
}

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-3 text-sm outline-none transition focus:border-[color:var(--color-accent-1)]";
