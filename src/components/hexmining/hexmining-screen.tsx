"use client";

import { type FormEvent, useState } from "react";

import { DataTableShell } from "@/components/ui/data-table-shell";
import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { WarningBanner } from "@/components/ui/data-state/warning-banner";
import { PageContainer } from "@/components/ui/page-container";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { SectionCard } from "@/components/ui/section-card";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ApiClientError } from "@/lib/api/hexmining-client";
import { useHexMiningStakesQuery } from "@/lib/query/use-hexmining-stakes-query";
import type { HexStakeDto, HexStakeListDto, HexStakeStatus } from "@/services/hexmining/types";

const PULSECHAIN_CHAIN_ID = 369;

type SubmittedParams = {
  walletAddress: string;
  chainId: number;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred.";
}

function resolveStakeStatusTone(
  status: HexStakeStatus,
): "fresh" | "warn" | "neutral" | "danger" {
  if (status === "active") return "fresh";
  if (status === "overdue") return "danger";
  if (status === "pending") return "warn";
  return "neutral";
}

export function HexMiningScreen() {
  const [walletAddress, setWalletAddress] = useState("");
  const [submittedParams, setSubmittedParams] = useState<SubmittedParams | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const stakesQuery = useHexMiningStakesQuery({
    walletAddress: submittedParams?.walletAddress ?? "",
    chainId: submittedParams?.chainId ?? PULSECHAIN_CHAIN_ID,
    enabled: submittedParams !== null,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = walletAddress.trim().toLowerCase();
    if (trimmed.length === 0) {
      setValidationError("Wallet address is required.");
      setSubmittedParams(null);
      return;
    }
    setValidationError(null);
    setSubmittedParams({ walletAddress: trimmed, chainId: PULSECHAIN_CHAIN_ID });
  }

  const isIdle = submittedParams === null && validationError === null;
  const errorMessage =
    validationError ??
    (stakesQuery.isError ? getErrorMessage(stakesQuery.error) : null);

  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
            CoinPulse
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">HexMining</h1>
          <p className="mt-3 max-w-3xl leading-7 text-[color:var(--color-text-muted)]">
            Native PulseChain HEX stake monitoring. Phase 2 scope: PulseChain (chainId 369) pHEX
            native stakes only. Backend-estimated yield is shown when backend evidence is
            available. Pricing, valuation, and PnL remain unsupported. eHEX (Ethereum) and
            HSI/HTT stakes are deferred to later phases.
          </p>
        </div>
      </SurfaceCard>

      <SectionCard
        title="Query pHEX stakes"
        subtitle="Enter a PulseChain wallet address to fetch native pHEX stake data. ChainId is fixed to 369. All values are backend-provided; estimated yield is rendered from backend evidence only, and pricing, valuation, and PnL remain unsupported."
      >
        <form
          className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={handleSubmit}
        >
          <label htmlFor="hex-wallet-address" className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
              Wallet address
            </span>
            <input
              id="hex-wallet-address"
              aria-label="Wallet address"
              className={fieldClassName}
              placeholder="0x…"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={stakesQuery.isFetching}
              aria-disabled={stakesQuery.isFetching}
              aria-busy={stakesQuery.isFetching}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--color-accent-2)] bg-[color:var(--color-accent-2)] px-4 font-medium text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {stakesQuery.isFetching ? "Loading…" : "Load stakes"}
            </button>
          </div>
        </form>
      </SectionCard>

      {isIdle ? (
        <EmptyState
          title="No wallet selected"
          message="Enter a PulseChain wallet address above to load native pHEX stakes. Import a wallet via the Wallet import operator page if needed."
        />
      ) : null}

      {errorMessage !== null ? <ErrorState message={errorMessage} /> : null}

      {submittedParams !== null && stakesQuery.isLoading ? (
        <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
      ) : null}

      {stakesQuery.data !== undefined && errorMessage === null ? (
        <StakeResultView list={stakesQuery.data} />
      ) : null}
    </PageContainer>
  );
}

function StakeResultView({ list }: { list: HexStakeListDto }) {
  const isUnsupportedChain = list.warnings.some((w) =>
    w.startsWith("hexmining-unsupported-chain-"),
  );

  return (
    <>
      {!list.isComplete ? (
        <WarningBanner tone="warn">
          <div className="flex flex-col gap-1">
            <strong className="font-semibold">Partial read</strong>
            <span className="text-sm">
              Not all stakes could be read. The list may be incomplete.
            </span>
          </div>
        </WarningBanner>
      ) : null}

      {list.warnings.length > 0 ? (
        <SurfaceCard className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Read warnings</span>
          <ul aria-label="Stake list warnings" className="flex flex-col gap-1">
            {list.warnings.map((w, i) => (
              <li
                key={`list-warn-${i}`}
                className="text-xs text-[color:var(--color-status-warning)]"
              >
                {w}
              </li>
            ))}
          </ul>
        </SurfaceCard>
      ) : null}

      {isUnsupportedChain ? (
        <EmptyState
          title="Unsupported chain"
          message="HexMining Phase 2 supports PulseChain (chainId 369) pHEX native stakes only. eHEX (Ethereum) and other chains are deferred to later phases."
        />
      ) : list.stakes.length === 0 ? (
        <EmptyState
          title="No active native pHEX stakes found"
          message="This wallet has no native pHEX stakes on PulseChain. Stakes closed via endStake are not tracked in Phase 2."
        />
      ) : (
        <StakeTable stakes={list.stakes} observedAt={list.observedAt} />
      )}
    </>
  );
}

function StakeTable({
  stakes,
  observedAt,
}: {
  stakes: HexStakeDto[];
  observedAt: string | null;
}) {
  return (
    <DataTableShell
      title={`Native pHEX stakes (${stakes.length})`}
      subtitle="PulseChain chainId 369. Backend-estimated yield is shown when provided. Pricing, valuation, and PnL remain unsupported."
    >
      <thead>
        <tr>
          <th scope="col" className={thClassName}>#</th>
          <th scope="col" className={thClassName}>Stake ID</th>
          <th scope="col" className={thClassName}>Status</th>
          <th scope="col" className={thClassName}>Principal HEX</th>
          <th scope="col" className={thClassName}>T-Shares</th>
          <th scope="col" className={thClassName}>Locked day</th>
          <th scope="col" className={thClassName}>Staked days</th>
          <th scope="col" className={thClassName}>Unlocked day</th>
          <th scope="col" className={thClassName}>Auto</th>
          <th scope="col" className={thClassName}>Backend fields</th>
          <th scope="col" className={thClassName}>Provenance</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[color:var(--color-border-soft)]">
        {stakes.map((stake) => (
          <StakeRow key={stake.stakeId} stake={stake} />
        ))}
      </tbody>
      {observedAt ? (
        <tfoot>
          <tr>
            <td
              colSpan={11}
              className="px-4 py-2 text-xs text-[color:var(--color-text-muted)]"
            >
              Observed at: {observedAt}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </DataTableShell>
  );
}

function StakeRow({ stake }: { stake: HexStakeDto }) {
  const statusTone = resolveStakeStatusTone(stake.stakeStatus);

  return (
    <tr>
      <td className={tdClassName}>
        <span className="cp-data">{stake.stakeIndex}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data" title={stake.stakeId}>
          {stake.stakeId}
        </span>
      </td>
      <td className={tdClassName}>
        <ProvenanceChip tone={statusTone}>{stake.stakeStatus}</ProvenanceChip>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.principalHex ?? "—"}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.tShares ?? "—"}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.lockedDay ?? "—"}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.stakedDays ?? "—"}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.unlockedDay ?? "—"}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.isAutoStake ? "yes" : "no"}</span>
      </td>
      <td className={tdClassName}>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-1">
            <ProvenanceChip tone="neutral">yield: {stake.yield.status}</ProvenanceChip>
            <ProvenanceChip tone="neutral">pricing: {stake.pricing.status}</ProvenanceChip>
            <ProvenanceChip tone="neutral">valuation: {stake.valuation.status}</ProvenanceChip>
            <ProvenanceChip tone="neutral">pnl: {stake.pnl.status}</ProvenanceChip>
          </div>
          {stake.yield.status === "estimated" ? (
            <div className="flex flex-col gap-0.5">
              <span className="cp-data text-xs">
                estimated yield: {stake.yield.estimatedYieldHex} hearts
              </span>
              <span className="text-xs text-[color:var(--color-text-muted)]">
                yield observation: {stake.yield.provenance.observationId}
              </span>
              <span className="text-xs text-[color:var(--color-text-muted)]">
                yield days: {stake.yield.provenance.rangeStartDay}-{stake.yield.provenance.rangeEndDay}
              </span>
              {stake.yield.warnings.map((warning, index) => (
                <span
                  key={`yield-warn-${stake.stakeId}-${index}`}
                  className="text-xs text-[color:var(--color-status-warning)]"
                >
                  yield warning: {warning}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </td>
      <td className={tdClassName}>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-[color:var(--color-text-muted)]">
            block: {stake.provenance.observedAtBlock}
          </span>
          {stake.warnings.map((w, i) => (
            <span
              key={`stake-warn-${stake.stakeId}-${i}`}
              className="text-xs text-[color:var(--color-status-warning)]"
            >
              {w}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-3 text-sm outline-none transition focus:border-[color:var(--color-accent-1)]";

const thClassName =
  "px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]";

const tdClassName = "px-4 py-3 align-top";
