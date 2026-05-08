import type { FormEvent, ReactNode } from "react";

import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DataTable, TableFrame } from "@/components/ui/table-frame";
import { cn } from "@/lib/utils";
import type {
  DashboardLpPositionDto,
  DashboardPnlDto,
  DashboardPricingDto,
  DashboardStakePositionDto,
  DashboardStatus,
  DashboardTokenPositionDto,
  PortfolioDashboardDto,
} from "@/services/dashboard/types";

export function DashboardHero(args: {
  backendStatusLabel: string;
  backendStatusTone: "fresh" | "warn";
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
        </div>
        <div className="flex flex-wrap gap-2">
          <ProvenanceChip tone={args.backendStatusTone}>
            {args.backendStatusLabel}
          </ProvenanceChip>
          <ProvenanceChip tone="neutral">{args.pricingStatusLabel}</ProvenanceChip>
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
  onWalletAddressChange: (value: string) => void;
  onChainIdChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SurfaceCard className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Query dashboard DTO</h2>
        <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">
          Load one tracked wallet and one chain at a time. The frontend only renders
          the backend response; it does not reconstruct balances or valuation locally.
        </p>
      </div>
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
    </SurfaceCard>
  );
}

export function IdleStateCard() {
  return (
    <SurfaceCard className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">No portfolio loaded</h3>
      <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">
        Enter a wallet address and chain to request the normalized dashboard DTO.
        Missing valuation or PnL will stay marked as unavailable, stale, unsupported,
        or incomplete rather than rendered as zero.
      </p>
    </SurfaceCard>
  );
}

export function LoadingStateCard() {
  return (
    <SurfaceCard className="grid gap-4 md:grid-cols-4">
      <LoadingBlock />
      <LoadingBlock />
      <LoadingBlock />
      <LoadingBlock />
    </SurfaceCard>
  );
}

export function ErrorStateCard({ message }: { message: string }) {
  return (
    <WarningBanner tone="danger">
      <div className="flex flex-col gap-1">
        <strong className="font-semibold">Dashboard request failed</strong>
        <span>{message}</span>
      </div>
    </WarningBanner>
  );
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
          label="Summary valuation"
          value={formatOptionalValue(dashboard.summary.totalValueQuote)}
          status={dashboard.summary.valuationStatus}
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
          value={formatTimestamp(dashboard.asOf)}
          hint="Resolved dashboard timestamp"
        />
        <SummaryMetaStat
          label="Schema"
          value={dashboard.schemaVersion}
          hint="Dashboard DTO contract version"
        />
      </SurfaceCard>
      {dashboard.summary.warnings.length > 0 ? (
        <WarningBanner>
          <WarningsList warnings={dashboard.summary.warnings} />
        </WarningBanner>
      ) : null}
    </>
  );
}

export function TokenPositionsTable({ positions }: { positions: DashboardTokenPositionDto[] }) {
  if (positions.length === 0) {
    return <EmptySectionCard title="Token positions" message="No token positions were materialized for this wallet and chain." />;
  }

  return (
    <TableFrame>
      <SectionHeader
        title="Token positions"
        subtitle="Backend-resolved balances, pricing provenance, valuation status, and PnL warnings."
      />
      <DataTable className="cp-table">
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
                  <StatusChip status={position.pricing.status} />
                </div>
              </td>
              <td className="cp-data">{position.balanceQuantity}</td>
              <td>
                <ValueWithStatus
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
                <WarningsList
                  warnings={[
                    ...position.pricing.rejectedReasons,
                    ...position.pnl.warnings.map((warning) => warning.detail),
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </TableFrame>
  );
}

export function LpPositionsTable({ positions }: { positions: DashboardLpPositionDto[] }) {
  if (positions.length === 0) {
    return <EmptySectionCard title="LP positions" message="No LP positions were materialized for this wallet and chain." />;
  }

  return (
    <TableFrame>
      <SectionHeader
        title="LP positions"
        subtitle="Position quantities are shown even when valuation or PnL is unsupported."
      />
      <DataTable className="cp-table">
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
                <ValueWithStatus
                  status={position.valuation.status}
                  value={position.valuation.valueQuote}
                />
              </td>
              <td>
                <StatusChip status={position.pnl.status} />
              </td>
              <td>
                <WarningsList
                  warnings={[
                    ...position.warnings,
                    ...position.pnl.warnings.map((warning) => warning.detail),
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </TableFrame>
  );
}

export function StakePositionsTable({ positions }: { positions: DashboardStakePositionDto[] }) {
  if (positions.length === 0) {
    return <EmptySectionCard title="Stake positions" message="No stake positions were materialized for this wallet and chain." />;
  }

  return (
    <TableFrame>
      <SectionHeader
        title="Stake positions"
        subtitle="Principal, lifecycle state, and backend warnings are shown without fabricated valuation."
      />
      <DataTable className="cp-table">
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
                <span className="rounded-full border border-[color:var(--color-border-soft)] px-2.5 py-1 text-xs font-medium text-[color:var(--color-text-muted)]">
                  {position.status}
                </span>
              </td>
              <td>
                <ValueWithStatus
                  status={position.valuation.status}
                  value={position.valuation.valueQuote}
                />
              </td>
              <td>
                <StatusChip status={position.pnl.status} />
              </td>
              <td>
                <WarningsList
                  warnings={[
                    ...position.warnings,
                    ...position.pnl.warnings.map((warning) => warning.detail),
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </TableFrame>
  );
}

export function WarningBanner({
  children,
  tone = "warn",
}: {
  children: ReactNode;
  tone?: "warn" | "danger";
}) {
  return (
    <SurfaceCard
      className={cn(
        "border px-5 py-4 text-sm leading-6",
        tone === "danger"
          ? "border-[color:var(--color-status-danger)] text-[color:var(--color-status-danger)]"
          : "border-[color:var(--color-status-warning)] text-[color:var(--color-status-warning)]",
      )}
    >
      {children}
    </SurfaceCard>
  );
}

export function WarningsList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return <span className="text-[color:var(--color-text-muted)]">none</span>;
  }

  return (
    <ul className="space-y-1 text-xs leading-5 text-[color:var(--color-text-muted)]">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

export function StatusChip({ status }: { status: DashboardStatus }) {
  const tone =
    status === "available"
      ? "fresh"
      : status === "stale_price" ||
          status === "low_confidence_price" ||
          status === "incomplete_basis" ||
          status === "partial"
        ? "warn"
        : "neutral";

  return <ProvenanceChip tone={tone}>{status}</ProvenanceChip>;
}

function PricingDetails({ pricing }: { pricing: DashboardPricingDto }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusChip status={pricing.status} />
      <span className="cp-data">
        confidence {formatOptionalValue(pricing.confidence)}
      </span>
      <span className="text-xs text-[color:var(--color-text-muted)]">
        {pricing.sourceType ?? "no source"}{pricing.sourceId ? ` - ${pricing.sourceId}` : ""}
      </span>
      <span className="text-xs text-[color:var(--color-text-muted)]">
        {pricing.observedAt ? `observed ${formatTimestamp(pricing.observedAt)}` : "observation unavailable"}
      </span>
    </div>
  );
}

function PnlDetails({ pnl }: { pnl: DashboardPnlDto }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusChip status={pnl.status} />
      <span className="cp-data">{formatOptionalValue(pnl.unrealizedPnl)}</span>
      <span className="text-xs text-[color:var(--color-text-muted)]">
        avg cost {formatOptionalValue(pnl.averageCost)}
      </span>
    </div>
  );
}

function ValueWithStatus(args: {
  status: DashboardStatus;
  value: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <StatusChip status={args.status} />
      <span className="cp-data">{formatOptionalValue(args.value)}</span>
    </div>
  );
}

function MetricCard(args: { label: string; value: string; status?: DashboardStatus }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
          {args.label}
        </span>
        {args.status ? <StatusChip status={args.status} /> : null}
      </div>
      <p className="mt-4 cp-data text-lg">{args.value}</p>
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

function SummaryMetaStat(args: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {args.label}
      </div>
      <div className="mt-3 cp-data text-sm">{args.value}</div>
      <div className="mt-2 text-xs text-[color:var(--color-text-muted)]">{args.hint}</div>
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

function LoadingBlock() {
  return (
    <div className="h-32 animate-pulse rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)]" />
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[color:var(--color-border-soft)] px-6 py-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">{subtitle}</p>
    </div>
  );
}

function EmptySectionCard({ title, message }: { title: string; message: string }) {
  return (
    <SurfaceCard className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm leading-6 text-[color:var(--color-text-muted)]">{message}</p>
    </SurfaceCard>
  );
}

function truncateAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatOptionalValue(value: string | null) {
  return value ?? "n/a";
}

function formatCoverage(value: PortfolioDashboardDto["summary"]["valuationCoverage"]) {
  return `${value.valuedPositions}/${value.totalPositions} valued`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-3 text-sm outline-none transition focus:border-[color:var(--color-accent-1)]";
