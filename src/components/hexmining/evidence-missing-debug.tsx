"use client";

import { type FormEvent, useState } from "react";

import { DataTableShell } from "@/components/ui/data-table-shell";
import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { PageContainer } from "@/components/ui/page-container";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { SectionCard } from "@/components/ui/section-card";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ApiClientError } from "@/lib/api/hexmining-client";
import { useHexMiningEvidenceMissingQuery } from "@/lib/query/use-hexmining-evidence-missing-query";
import type { HexMiningEvidenceCoverageReportDto, HexMiningEvidenceCoverageStakeDto } from "@/services/hexmining/evidence-coverage-report";

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

export function EvidenceMissingDebug() {
  const [walletAddress, setWalletAddress] = useState("");
  const [submittedParams, setSubmittedParams] = useState<SubmittedParams | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const reportQuery = useHexMiningEvidenceMissingQuery({
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
    const next = { walletAddress: trimmed, chainId: PULSECHAIN_CHAIN_ID };
    if (submittedParams?.walletAddress === next.walletAddress && submittedParams?.chainId === next.chainId) {
      // Same params — query key unchanged, so manually trigger a fresh fetch.
      void reportQuery.refetch();
    } else {
      setSubmittedParams(next);
    }
  }

  const isIdle = submittedParams === null && validationError === null;
  const errorMessage =
    validationError ??
    (reportQuery.isError ? getErrorMessage(reportQuery.error) : null);

  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
            CoinPulse / Debug
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            HexMining — Missing Evidence Diagnostic
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-[color:var(--color-text-muted)]">
            Diagnostic only. Reports which active native pHEX stakes lack observation evidence in the
            database for their full staked day range. Does not estimate yield. Does not fetch or persist
            observations. Missing evidence does not mean yield is zero.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ProvenanceChip tone="neutral">Diagnostic only</ProvenanceChip>
            <ProvenanceChip tone="neutral">Does not estimate yield</ProvenanceChip>
            <ProvenanceChip tone="neutral">Does not fetch or persist observations</ProvenanceChip>
            <ProvenanceChip tone="warn">Missing evidence does not mean yield is zero</ProvenanceChip>
          </div>
        </div>
      </SurfaceCard>

      <SectionCard
        title="Run diagnostic"
        subtitle="Enter a PulseChain wallet address. ChainId is fixed to 369. The diagnostic calls the backend route, which reads active native pHEX stakes and checks database evidence coverage. No direct frontend RPC. No observation writes."
      >
        <form
          className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={handleSubmit}
        >
          <label htmlFor="evidence-wallet-address" className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
              Wallet address
            </span>
            <input
              id="evidence-wallet-address"
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
              disabled={reportQuery.isFetching}
              aria-disabled={reportQuery.isFetching}
              aria-busy={reportQuery.isFetching}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--color-accent-2)] bg-[color:var(--color-accent-2)] px-4 font-medium text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reportQuery.isFetching ? "Loading…" : "Run diagnostic"}
            </button>
          </div>
        </form>
      </SectionCard>

      {isIdle ? (
        <EmptyState
          title="No diagnostic run"
          message="Enter a PulseChain wallet address above and click Run diagnostic. No direct frontend RPC. No observation writes."
        />
      ) : null}

      {errorMessage !== null ? <ErrorState message={errorMessage} /> : null}

      {submittedParams !== null && reportQuery.isLoading ? (
        <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
      ) : null}

      {reportQuery.data !== undefined && errorMessage === null ? (
        <ReportView report={reportQuery.data} />
      ) : null}
    </PageContainer>
  );
}

function ReportView({ report }: { report: HexMiningEvidenceCoverageReportDto }) {
  const { summary, stakes } = report;
  const incompleteRead = !summary.stakeReadIsComplete;

  return (
    <>
      <SurfaceCard className="flex flex-col gap-4">
        <span className="text-sm font-semibold">Summary</span>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          <SummaryField label="Schema version" value={report.schemaVersion} />
          <SummaryField label="Chain ID" value={String(summary.chainId)} />
          <SummaryField label="Source family" value={summary.sourceFamily} />
          <SummaryField label="Total active stakes" value={String(summary.totalActiveStakes)} />
          <SummaryField label="Covered stakes" value={String(summary.coveredStakes)} />
          <SummaryField label="Missing evidence stakes" value={String(summary.missingEvidenceStakes)} />
          <div className="col-span-full flex flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
              Stake read complete
            </dt>
            <dd>
              {incompleteRead ? (
                <ProvenanceChip tone="warn">false — read may be incomplete</ProvenanceChip>
              ) : (
                <ProvenanceChip tone="fresh">true</ProvenanceChip>
              )}
            </dd>
          </div>
        </dl>

        {summary.stakeReadWarnings.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
              Stake read warnings
            </span>
            <ul aria-label="Stake read warnings" className="flex flex-col gap-1">
              {summary.stakeReadWarnings.map((w, i) => (
                <li
                  key={`read-warn-${i}`}
                  className="text-xs text-[color:var(--color-status-warning)]"
                >
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </SurfaceCard>

      {stakes.length === 0 ? (
        <EmptyState
          title="No active native pHEX stakes found"
          message="This wallet has no active native pHEX stakes on PulseChain (chainId 369) for the evidence diagnostic."
        />
      ) : (
        <EvidenceTable stakes={stakes} />
      )}
    </>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="cp-data text-sm">{value}</dd>
    </div>
  );
}

function EvidenceTable({ stakes }: { stakes: HexMiningEvidenceCoverageStakeDto[] }) {
  return (
    <DataTableShell
      title={`Evidence coverage — ${stakes.length} active stake(s)`}
      subtitle="Missing evidence does not mean yield is zero. Diagnostic only — no yield estimates, no observation fetching."
    >
      <thead>
        <tr>
          <th scope="col" className={thClassName}>Stake ID</th>
          <th scope="col" className={thClassName}>Locked day</th>
          <th scope="col" className={thClassName}>Current day</th>
          <th scope="col" className={thClassName}>Range start</th>
          <th scope="col" className={thClassName}>Range end</th>
          <th scope="col" className={thClassName}>Covered</th>
          <th scope="col" className={thClassName}>Observation ID</th>
          <th scope="col" className={thClassName}>Missing reason</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[color:var(--color-border-soft)]">
        {stakes.map((stake) => (
          <EvidenceRow key={stake.stakeId} stake={stake} />
        ))}
      </tbody>
    </DataTableShell>
  );
}

function EvidenceRow({ stake }: { stake: HexMiningEvidenceCoverageStakeDto }) {
  return (
    <tr>
      <td className={tdClassName}>
        <span className="cp-data">{stake.stakeId}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.lockedDay}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.currentDay}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.rangeStartDay}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.rangeEndDay}</span>
      </td>
      <td className={tdClassName}>
        {stake.covered ? (
          <ProvenanceChip tone="fresh">covered</ProvenanceChip>
        ) : stake.missingReason === "no_elapsed_days" ? (
          <ProvenanceChip tone="neutral">not applicable — no elapsed days</ProvenanceChip>
        ) : (
          <ProvenanceChip tone="warn">missing evidence</ProvenanceChip>
        )}
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.observationId ?? "—"}</span>
      </td>
      <td className={tdClassName}>
        <span className="cp-data">{stake.missingReason ?? "—"}</span>
      </td>
    </tr>
  );
}

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-3 text-sm outline-none transition focus:border-[color:var(--color-accent-1)]";

const thClassName =
  "px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]";

const tdClassName = "px-4 py-3 align-top";
