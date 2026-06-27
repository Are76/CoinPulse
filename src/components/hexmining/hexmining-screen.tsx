"use client";

import { type FormEvent, useState } from "react";

import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import {
  WarningBanner,
  WarningList,
} from "@/components/ui/data-state/warning-banner";
import { PageContainer } from "@/components/ui/page-container";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { SectionCard } from "@/components/ui/section-card";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ApiClientError } from "@/lib/api/hexmining-client";
import { formatHeartsAsHexDisplay } from "@/lib/hex-format";
import { useHexMiningStakesQuery } from "@/lib/query/use-hexmining-stakes-query";
import type { HexStakeDto, HexStakeListDto, HexStakeStatus } from "@/services/hexmining/types";

const PULSECHAIN_CHAIN_ID = 369;

type SubmittedParams = { walletAddress: string; chainId: number };

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

function resolveStatusTone(status: HexStakeStatus): "fresh" | "warn" | "neutral" | "danger" {
  if (status === "active") return "fresh";
  if (status === "overdue") return "danger";
  if (status === "pending") return "warn";
  return "neutral";
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

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
    if (!trimmed) {
      setValidationError("Wallet address is required.");
      setSubmittedParams(null);
      return;
    }
    setValidationError(null);
    setSubmittedParams({ walletAddress: trimmed, chainId: PULSECHAIN_CHAIN_ID });
  }

  const isIdle = submittedParams === null && validationError === null;
  const errorMessage = validationError ?? (stakesQuery.isError ? getErrorMessage(stakesQuery.error) : null);

  return (
    <PageContainer className="flex flex-col gap-6">
      {/* Hero */}
      <SurfaceCard className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          CoinPulse
        </p>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#e4e6f0" }}>
          HEX Mining
        </h1>
        <p className="text-sm leading-relaxed max-w-2xl" style={{ color: "#a0a8c0" }}>
          Native PulseChain pHEX stake monitoring. Phase 2 scope: chainId 369 pHEX stakes only.
          Backend-estimated yield shown when evidence is available. Pricing, valuation, and PnL remain unsupported.
          eHEX (Ethereum) and HSI/HTT stakes are deferred to later phases.
        </p>
        <div className="flex flex-wrap gap-2 mt-1">
          <ProvenanceChip tone="neutral" size="sm">pHEX only</ProvenanceChip>
          <ProvenanceChip tone="neutral" size="sm">chainId 369</ProvenanceChip>
          <ProvenanceChip tone="stale" size="sm">pricing unsupported</ProvenanceChip>
        </div>
      </SurfaceCard>

      {/* Query form */}
      <SectionCard
        title="Query pHEX stakes"
        subtitle="Enter a PulseChain wallet address to fetch native pHEX stake data. Chain ID is fixed to 369."
      >
        <form className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleSubmit}>
          <label htmlFor="hex-wallet-address" className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
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
              className={submitButtonClassName}
            >
              {stakesQuery.isFetching ? "Loading…" : "Load stakes"}
            </button>
          </div>
        </form>
      </SectionCard>

      {/* States */}
      {isIdle && (
        <EmptyState
          title="No wallet selected"
          message="Enter a PulseChain wallet address above to load native pHEX stakes."
        />
      )}
      {errorMessage !== null && <ErrorState message={errorMessage} />}
      {submittedParams !== null && stakesQuery.isLoading && (
        <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
      )}

      {/* Results */}
      {stakesQuery.data !== undefined && errorMessage === null && (
        <StakeResultView list={stakesQuery.data} />
      )}
    </PageContainer>
  );
}

/* ── Result view ─────────────────────────────────────────────────────────── */

function StakeResultView({ list }: { list: HexStakeListDto }) {
  const isUnsupportedChain = list.warnings.some((w) => w.startsWith("hexmining-unsupported-chain-"));

  return (
    <>
      {!list.isComplete && (
        <WarningBanner tone="warn" title="Partial read">
          Not all stakes could be read. The list may be incomplete.
        </WarningBanner>
      )}

      {list.warnings.length > 0 && (
        <WarningBanner tone="warn" title="Read warnings">
          <WarningList warnings={list.warnings} />
        </WarningBanner>
      )}

      {isUnsupportedChain ? (
        <EmptyState
          title="Unsupported chain"
          message="HexMining Phase 2 supports PulseChain (chainId 369) pHEX native stakes only."
        />
      ) : list.stakes.length === 0 ? (
        <EmptyState
          title="No active native pHEX stakes"
          message="This wallet has no native pHEX stakes on PulseChain. Stakes closed via endStake are not tracked in Phase 2."
        />
      ) : (
        <StakeList stakes={list.stakes} observedAt={list.observedAt} />
      )}
    </>
  );
}

/* ── Stake list ──────────────────────────────────────────────────────────── */

function StakeList({ stakes, observedAt }: { stakes: HexStakeDto[]; observedAt: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          Native pHEX stakes
        </span>
        <span className="cp-data text-xs font-bold" style={{ color: "#818cf8" }}>
          {stakes.length}
        </span>
        {observedAt && (
          <span className="text-xs ml-auto" style={{ color: "#586070" }}>
            Observed: {observedAt}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stakes.map((stake) => (
          <StakeCard key={stake.stakeId} stake={stake} />
        ))}
      </div>
    </div>
  );
}

/* ── Stake card ──────────────────────────────────────────────────────────── */

function StakeCard({ stake }: { stake: HexStakeDto }) {
  const statusTone = resolveStatusTone(stake.stakeStatus);
  const isActive = stake.stakeStatus === "active";
  const hasYield = stake.yield.status === "estimated";
  const estimatedYieldDisplay =
    hasYield && stake.yield.estimatedYieldHearts !== null
      ? formatHeartsAsHexDisplay(stake.yield.estimatedYieldHearts)
      : null;

  return (
    <div
      className="rounded-xl flex flex-col overflow-hidden"
      style={{
        background: isActive
          ? "linear-gradient(135deg, #111520 0%, #141828 100%)"
          : "#111520",
        border: isActive
          ? "1px solid rgba(74,222,128,0.2)"
          : "1px solid rgba(255,255,255,0.065)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.055)" }}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs" style={{ color: "#586070" }}>
            #{stake.stakeIndex} · Stake ID
          </span>
          <span
            className="cp-data text-xs truncate"
            style={{ color: "#a0a8c0" }}
            title={stake.stakeId}
          >
            {stake.stakeId}
          </span>
        </div>
        <ProvenanceChip tone={statusTone} size="sm">
          {stake.stakeStatus}
        </ProvenanceChip>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-px" style={{ background: "rgba(255,255,255,0.04)" }}>
        <MetricCell label="Principal HEX" value={stake.principalHex ?? "—"} mono />
        <MetricCell label="T-Shares" value={stake.tShares ?? "—"} mono />
        <MetricCell label="Locked day" value={String(stake.lockedDay ?? "—")} mono />
        <MetricCell label="Staked days" value={String(stake.stakedDays ?? "—")} mono />
        <MetricCell label="Unlocked day" value={String(stake.unlockedDay ?? "—")} mono />
        <MetricCell label="Auto-stake" value={stake.isAutoStake ? "Yes" : "No"} />
      </div>

      {/* Estimated yield */}
      {hasYield && estimatedYieldDisplay !== null && (
        <div
          className="px-4 py-3 flex flex-col gap-1.5"
          style={{
            borderTop: "1px solid rgba(74,222,128,0.12)",
            background: "rgba(74,222,128,0.04)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="font-semibold uppercase"
              style={{ color: "#4ade80", letterSpacing: "0.08em", fontSize: "9px" }}
            >
              Estimated yield
            </span>
            <ProvenanceChip tone="fresh" size="sm">estimated</ProvenanceChip>
          </div>
          <span className="cp-data text-xl font-bold" style={{ color: "#4ade80" }}>
            {estimatedYieldDisplay} HEX
          </span>
          <span className="cp-data text-xs" style={{ color: "#586070" }}>
            {stake.yield.estimatedYieldHearts} hearts raw
          </span>
          {stake.yield.status === "estimated" && (
            <span className="text-xs" style={{ color: "#586070" }}>
              Days {stake.yield.provenance.rangeStartDay}–{stake.yield.provenance.rangeEndDay}
              {" · "}{stake.yield.provenance.observationId}
            </span>
          )}
          {stake.yield.status === "estimated" && stake.yield.warnings.length > 0 && (
            <ul className="flex flex-col gap-0.5 mt-1">
              {stake.yield.warnings.map((w, i) => (
                <li key={`yw-${stake.stakeId}-${i}`} className="text-xs" style={{ color: "#f59e0b" }}>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Backend status chips */}
      <div
        className="flex flex-wrap gap-1.5 px-4 py-2.5"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        <ProvenanceChip tone="neutral" size="sm">yield: {stake.yield.status}</ProvenanceChip>
        <ProvenanceChip tone="stale" size="sm">pricing: {stake.pricing.status}</ProvenanceChip>
        <ProvenanceChip tone="stale" size="sm">pnl: {stake.pnl.status}</ProvenanceChip>
      </div>

      {/* Provenance + warnings */}
      {(stake.provenance.observedAtBlock !== null || stake.warnings.length > 0) && (
        <div
          className="px-4 py-2.5 flex flex-col gap-1"
          style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
        >
          {stake.provenance.observedAtBlock !== null && (
            <span className="text-xs" style={{ color: "#586070" }}>
              Block: <span className="cp-data">{stake.provenance.observedAtBlock}</span>
            </span>
          )}
          {stake.warnings.map((w, i) => (
            <span key={`sw-${stake.stakeId}-${i}`} className="text-xs" style={{ color: "#f59e0b" }}>
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5" style={{ background: "#111520" }}>
      <span className="text-xs" style={{ color: "#586070" }}>{label}</span>
      <span
        className="text-sm font-semibold"
        style={{
          color: "#e4e6f0",
          fontFamily: mono ? "var(--font-mono-data), monospace" : "inherit",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Shared style constants ──────────────────────────────────────────────── */

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border px-3 text-sm outline-none transition"
  + " bg-[#181d2c] text-[#e4e6f0] placeholder:text-[#586070]"
  + " border-[rgba(255,255,255,0.065)] focus:border-[#818cf8]";

const submitButtonClassName =
  "inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] px-4 font-semibold text-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
  + " bg-[#818cf8] text-white";
