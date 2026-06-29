"use client";

import { useState, type FormEvent } from "react";

import { OperatorToolsNav } from "@/components/debug/operator-tools-nav";
import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import {
  WarningBanner,
  WarningList,
} from "@/components/ui/data-state/warning-banner";
import { PageContainer } from "@/components/ui/page-container";
import { SectionCard } from "@/components/ui/section-card";
import { LabelBadge } from "@/components/ui/status/status-badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { TimestampLabel } from "@/components/ui/value/timestamp-label";
import {
  ApiClientError,
  OPERATOR_MAX_BLOCK_SPAN,
  SOURCE_FAMILY_OPTIONS,
  type DebugStatusReportDto,
  type HealthReportDto,
  type SourceFamily,
} from "@/lib/api/debug-client";
import { useDebugHealthQuery } from "@/lib/query/use-debug-health-query";
import { useManualSyncMutation } from "@/lib/query/use-manual-sync-mutation";
import { useRebuildMutation } from "@/lib/query/use-rebuild-mutation";
import { useDebugStatusQuery } from "@/lib/query/use-debug-status-query";

const DEFAULT_CHAIN_ID = "369";

type MetaState =
  | { kind: "loading" }
  | { kind: "ready"; health: HealthReportDto; status: DebugStatusReportDto }
  | { kind: "error"; message: string };

type OperationState =
  | { kind: "idle" }
  | { kind: "loading"; operation: "sync" | "rebuild" }
  | { kind: "success"; operation: "sync" | "rebuild"; payload: unknown }
  | {
      kind: "error";
      operation: "sync" | "rebuild";
      message: string;
      details: string[];
    };

export function DebugSyncScreen() {
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [sourceFamilies, setSourceFamilies] = useState<SourceFamily[]>([
    "TRANSFERS",
    "DEX",
    "LP",
    "STAKING",
  ]);
  const [syncStartBlock, setSyncStartBlock] = useState("");
  const [syncEndBlock, setSyncEndBlock] = useState("");
  const [policyLabel, setPolicyLabel] = useState("frontend-debug");
  const [rebuildFromBlock, setRebuildFromBlock] = useState("");
  const [rebuildToBlock, setRebuildToBlock] = useState("");
  const [operationState, setOperationState] = useState<OperationState>({
    kind: "idle",
  });

  const healthQuery = useDebugHealthQuery();
  const manualSyncMutation = useManualSyncMutation();
  const rebuildMutation = useRebuildMutation();
  const statusQuery = useDebugStatusQuery();

  const metaState = getMetaState({
    health: healthQuery.data,
    healthError: healthQuery.error,
    status: statusQuery.data,
    statusError: statusQuery.error,
  });

  async function handleManualSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedChainId = parseChainId(chainId);
    if (!parsedChainId.ok) {
      setOperationState({
        kind: "error",
        operation: "sync",
        message: parsedChainId.message,
        details: [],
      });
      return;
    }

    if (!walletAddress.trim()) {
      setOperationState({
        kind: "error",
        operation: "sync",
        message: "Wallet address is required.",
        details: [],
      });
      return;
    }

    if (!syncEndBlock.trim()) {
      setOperationState({
        kind: "error",
        operation: "sync",
        message: "End block is required for manual sync.",
        details: [],
      });
      return;
    }

    if (!policyLabel.trim()) {
      setOperationState({
        kind: "error",
        operation: "sync",
        message: "Policy label is required.",
        details: [],
      });
      return;
    }

    setOperationState({ kind: "loading", operation: "sync" });

    try {
      const response = await manualSyncMutation.mutateAsync({
        walletAddress: walletAddress.trim(),
        chainId: parsedChainId.value,
        sourceFamilies,
        startBlock: syncStartBlock.trim() || undefined,
        endBlock: syncEndBlock.trim(),
        policyLabel: policyLabel.trim(),
      });

      setOperationState({
        kind: "success",
        operation: "sync",
        payload: response.data,
      });
    } catch (error) {
      setOperationState({
        kind: "error",
        operation: "sync",
        message: getErrorMessage(error),
        details: getErrorDetails(error),
      });
    }
  }

  async function handleRebuild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedChainId = parseChainId(chainId);
    if (!parsedChainId.ok) {
      setOperationState({
        kind: "error",
        operation: "rebuild",
        message: parsedChainId.message,
        details: [],
      });
      return;
    }

    if (!walletAddress.trim()) {
      setOperationState({
        kind: "error",
        operation: "rebuild",
        message: "Wallet address is required.",
        details: [],
      });
      return;
    }

    if (!rebuildFromBlock.trim() || !rebuildToBlock.trim()) {
      setOperationState({
        kind: "error",
        operation: "rebuild",
        message: "Both from-block and to-block are required for rebuild.",
        details: [],
      });
      return;
    }

    setOperationState({ kind: "loading", operation: "rebuild" });

    try {
      const response = await rebuildMutation.mutateAsync({
        walletAddress: walletAddress.trim(),
        chainId: parsedChainId.value,
        sourceFamilies,
        fromBlock: rebuildFromBlock.trim(),
        toBlock: rebuildToBlock.trim(),
      });

      setOperationState({
        kind: "success",
        operation: "rebuild",
        payload: response.data,
      });
    } catch (error) {
      setOperationState({
        kind: "error",
        operation: "rebuild",
        message: getErrorMessage(error),
        details: getErrorDetails(error),
      });
    }
  }

  function toggleSourceFamily(value: SourceFamily) {
    setSourceFamilies((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }

      return [...current, value];
    });
  }

  const isBusy = operationState.kind === "loading";

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
              Debug and sync
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-sm" style={{ color: "#a0a8c0" }}>
              Operator-facing frontend for backend health, sync, and rebuild
              visibility. The page only renders backend responses and never
              computes balances, pricing, valuation, or PnL in the browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LabelBadge
              label={
                metaState.kind === "ready"
                  ? `backend ${metaState.health.status}`
                  : metaState.kind === "error"
                    ? "backend error"
                    : "backend loading"
              }
              tone={
                metaState.kind === "ready" && metaState.health.status === "ok"
                  ? "fresh"
                  : metaState.kind === "error"
                    ? "danger"
                    : "warn"
              }
            />
            <LabelBadge label="sync operator" tone="neutral" />
          </div>
        </div>
      </SurfaceCard>

      <OperatorToolsNav />

      {metaState.kind === "loading" ? (
        <SurfaceCard>
          <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
        </SurfaceCard>
      ) : null}

      {metaState.kind === "error" ? (
        <ErrorState
          title="Backend debug metadata failed"
          message={metaState.message}
        />
      ) : null}

      {metaState.kind === "ready" ? (
        <>
          <SurfaceCard className="grid gap-4 md:grid-cols-3">
            <MetaCard
              label="Database"
              value={metaState.health.dependencies.database.status}
            />
            <MetaCard
              label="Redis"
              value={metaState.health.dependencies.redis.status}
            />
            <MetaCard label="Environment" value={metaState.health.app.env} />
          </SurfaceCard>

          <SurfaceCard className="grid gap-4 md:grid-cols-3">
            <MetaCard
              label="Supported chains"
              value={metaState.status.supportedChains
                .map((chain) => `${chain.name} (${chain.chainId})`)
                .join(", ")}
            />
            <MetaCard
              label="Source families"
              value={metaState.status.sourceFamilies.join(", ")}
            />
            <MetaCard
              label="Pricing mode"
              value={
                metaState.status.pricing.persistedObservationsOnly
                  ? "persisted observations only"
                  : "not provided"
              }
              hint={
                metaState.status.pricing.liveAdaptersEnabled
                  ? "live adapters enabled"
                  : "live adapters disabled"
              }
            />
          </SurfaceCard>

          <SurfaceCard className="grid gap-4 md:grid-cols-2">
            <MetaCard
              label="Health timestamp"
              value={metaState.health.timestamp}
              isTimestamp
            />
            <MetaCard
              label="Status timestamp"
              value={metaState.status.timestamp}
              isTimestamp
            />
          </SurfaceCard>

          <RpcObservabilityCard rpcObservability={metaState.status.rpcObservability} />
        </>
      ) : null}

      <SectionCard
        title="Operator inputs"
        subtitle="Wallet, chain, and source families are sent directly to the backend APIs. Unknown or unavailable values stay explicit."
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          <LabeledField label="Wallet address">
            <input
              aria-label="Wallet address"
              className={fieldClassName}
              placeholder="0x..."
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value)}
            />
          </LabeledField>
          <LabeledField label="Chain ID">
            <input
              aria-label="Chain ID"
              className={fieldClassName}
              inputMode="numeric"
              value={chainId}
              onChange={(event) => setChainId(event.target.value)}
            />
          </LabeledField>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#586070", letterSpacing: "0.08em" }}
          >
            Source families
          </span>
          <div className="flex flex-wrap gap-2">
            {SOURCE_FAMILY_OPTIONS.map((family) => {
              const selected = sourceFamilies.includes(family);

              return (
                <button
                  key={family}
                  type="button"
                  className="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                  style={selected ? {
                    background: "#818cf8",
                    borderColor: "#818cf8",
                    color: "#0b0d14",
                    letterSpacing: "0.08em",
                  } : {
                    background: "#181d2c",
                    borderColor: "rgba(255,255,255,0.065)",
                    color: "#586070",
                    letterSpacing: "0.08em",
                  }}
                  onClick={() => toggleSourceFamily(family)}
                >
                  {family}
                </button>
              );
            })}
          </div>
          {sourceFamilies.length === 0 ? (
            <WarningBanner>
              Select at least one source family before running sync or rebuild.
            </WarningBanner>
          ) : null}
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Manual sync"
          subtitle="POST /api/sync/manual. The page sends the exact operator inputs and renders the backend response verbatim."
        >
          <form className="grid gap-4" onSubmit={handleManualSync}>
            <WarningBanner>
              Max block span: <strong>{OPERATOR_MAX_BLOCK_SPAN.toLocaleString()} blocks</strong>. For heavy source families (DEX, LP, STAKING) use a smaller range or run families separately.
            </WarningBanner>
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledField label="Start block (optional)">
                <input
                  aria-label="Start block"
                  className={fieldClassName}
                  inputMode="numeric"
                  placeholder="1000000"
                  value={syncStartBlock}
                  onChange={(event) => setSyncStartBlock(event.target.value)}
                />
              </LabeledField>
              <LabeledField label="End block">
                <input
                  aria-label="End block"
                  className={fieldClassName}
                  inputMode="numeric"
                  placeholder="1000100"
                  value={syncEndBlock}
                  onChange={(event) => setSyncEndBlock(event.target.value)}
                />
              </LabeledField>
            </div>
            <LabeledField label="Policy label">
              <input
                aria-label="Policy label"
                className={fieldClassName}
                value={policyLabel}
                onChange={(event) => setPolicyLabel(event.target.value)}
              />
            </LabeledField>
            <div>
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] px-4 font-semibold text-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "#818cf8", color: "#0b0d14" }}
                disabled={isBusy || sourceFamilies.length === 0}
              >
                {operationState.kind === "loading" &&
                operationState.operation === "sync"
                  ? "Syncing..."
                  : "Run manual sync"}
              </button>
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="Rebuild"
          subtitle="POST /api/rebuild. Rebuild stays backend-owned; the frontend only submits scope and renders the response."
        >
          <form className="grid gap-4" onSubmit={handleRebuild}>
            <WarningBanner>
              Max block span: <strong>{OPERATOR_MAX_BLOCK_SPAN.toLocaleString()} blocks</strong>. For heavy source families (DEX, LP, STAKING) use a smaller range or run families separately.
            </WarningBanner>
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledField label="From block">
                <input
                  aria-label="From block"
                  className={fieldClassName}
                  inputMode="numeric"
                  placeholder="1000000"
                  value={rebuildFromBlock}
                  onChange={(event) => setRebuildFromBlock(event.target.value)}
                />
              </LabeledField>
              <LabeledField label="To block">
                <input
                  aria-label="To block"
                  className={fieldClassName}
                  inputMode="numeric"
                  placeholder="1000100"
                  value={rebuildToBlock}
                  onChange={(event) => setRebuildToBlock(event.target.value)}
                />
              </LabeledField>
            </div>
            <div>
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border px-4 font-semibold text-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "#181d2c", borderColor: "rgba(255,255,255,0.065)", color: "#a0a8c0" }}
                disabled={isBusy || sourceFamilies.length === 0}
              >
                {operationState.kind === "loading" &&
                operationState.operation === "rebuild"
                  ? "Rebuilding..."
                  : "Run rebuild"}
              </button>
            </div>
          </form>
        </SectionCard>
      </div>

      <div aria-live="polite" aria-atomic="true">
        <OperationStatePanel state={operationState} />
      </div>
    </PageContainer>
  );
}

function getMetaState({
  health,
  healthError,
  status,
  statusError,
}: {
  health: HealthReportDto | undefined;
  healthError: Error | null;
  status: DebugStatusReportDto | undefined;
  statusError: Error | null;
}): MetaState {
  if (health && status) {
    return { kind: "ready", health, status };
  }

  const error = healthError ?? statusError;

  if (error) {
    return { kind: "error", message: getErrorMessage(error) };
  }

  return { kind: "loading" };
}

function OperationStatePanel({ state }: { state: OperationState }) {
  if (state.kind === "idle") {
    return (
      <EmptyState
        title="No operation executed"
        message="Manual sync and rebuild responses will appear here with raw backend detail preserved."
      />
    );
  }

  if (state.kind === "loading") {
    return (
      <SectionCard
        title={`Submitting ${state.operation}`}
        subtitle="The frontend is waiting for the backend to accept the operation."
      >
        <LoadingState blocks={2} className="grid gap-4 md:grid-cols-2" />
      </SectionCard>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          title={`${toTitle(state.operation)} failed`}
          message={state.message}
        />
        {state.details.length > 0 ? (
          <WarningBanner>
            <WarningList warnings={state.details} />
          </WarningBanner>
        ) : null}
      </div>
    );
  }

  return (
    <SectionCard
      title={`${toTitle(state.operation)} accepted`}
      subtitle="The backend accepted the operation. Debug status polling remains the source of truth for running, completed, or failed state."
    >
      <div className="flex flex-wrap gap-2">
        <LabelBadge label={`${state.operation} accepted`} tone="warn" />
        {getRunId(state.payload) ? (
          <LabelBadge label={`run ${getRunId(state.payload)}`} tone="neutral" />
        ) : null}
      </div>
      <details
        className="mt-4 rounded-[var(--radius-md)] border"
        style={{ background: "#181d2c", borderColor: "rgba(255,255,255,0.065)" }}
      >
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium" style={{ color: "#a0a8c0" }}>
          Show raw response
        </summary>
        <pre
          className="overflow-x-auto px-4 py-4 text-xs leading-6"
          style={{ borderTop: "1px solid rgba(255,255,255,0.065)", color: "#586070" }}
        >
          {JSON.stringify(state.payload, null, 2)}
        </pre>
      </details>
    </SectionCard>
  );
}

function MetaCard({
  label,
  value,
  hint,
  isTimestamp,
}: {
  label: string;
  value: string;
  hint?: string;
  isTimestamp?: boolean;
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] border p-4"
      style={{ background: "#181d2c", borderColor: "rgba(255,255,255,0.065)" }}
    >
      <div
        className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: "#586070", letterSpacing: "0.08em" }}
      >
        {label}
      </div>
      <div className="mt-3 cp-data text-sm" style={{ color: "#e4e6f0" }}>
        {isTimestamp ? <TimestampLabel value={value} /> : value}
      </div>
      {hint ? (
        <div className="mt-2 text-xs" style={{ color: "#586070" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span
        className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: "#586070", letterSpacing: "0.08em" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function parseChainId(value: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false as const,
      message: "Chain ID must be a positive integer.",
    };
  }

  return {
    ok: true as const,
    value: parsed,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown frontend error.";
}

function getErrorDetails(error: unknown) {
  if (error instanceof ApiClientError && error.details?.length) {
    return error.details.map((detail) => {
      if (detail.path) {
        return `${detail.path}: ${detail.message ?? "Invalid value."}`;
      }

      return detail.message ?? "Invalid value.";
    });
  }

  return [];
}

function getRunId(payload: unknown) {
  return typeof payload === "object" &&
    payload !== null &&
    "runId" in payload &&
    typeof payload.runId === "string"
    ? payload.runId
    : null;
}

function toTitle(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function RpcObservabilityCard({
  rpcObservability,
}: {
  rpcObservability: DebugStatusReportDto["rpcObservability"];
}) {
  if (!rpcObservability) return null;

  const { totalRequestCount, recentErrorCount, latestRequestAt } = rpcObservability;
  const hasErrors = recentErrorCount > 0;

  return (
    <SectionCard
      title="RPC Observability"
      subtitle="Backend-reported RPC request counters and error tracking. Values are rendered verbatim from the debug status DTO."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div
          className="rounded-[var(--radius-md)] border p-4"
          style={{ background: "#181d2c", borderColor: "rgba(255,255,255,0.065)" }}
        >
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#586070", letterSpacing: "0.08em" }}
          >
            Total Requests
          </div>
          <div className="mt-3 cp-data text-sm" style={{ color: "#e4e6f0" }}>
            {totalRequestCount.toLocaleString()}
          </div>
        </div>

        <div
          className="rounded-[var(--radius-md)] border p-4"
          style={{ background: "#181d2c", borderColor: "rgba(255,255,255,0.065)" }}
        >
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#586070", letterSpacing: "0.08em" }}
          >
            Recent Errors
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="cp-data text-sm" style={{ color: "#e4e6f0" }}>
              {recentErrorCount.toLocaleString()}
            </span>
            <LabelBadge
              label={hasErrors ? "errors detected" : "no errors"}
              tone={hasErrors ? "warn" : "fresh"}
            />
          </div>
        </div>

        <div
          className="rounded-[var(--radius-md)] border p-4"
          style={{ background: "#181d2c", borderColor: "rgba(255,255,255,0.065)" }}
        >
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "#586070", letterSpacing: "0.08em" }}
          >
            Latest Request
          </div>
          <div className="mt-3 cp-data text-sm" style={{ color: "#e4e6f0" }}>
            {latestRequestAt === null ? (
              <span style={{ color: "#586070" }}>No requests recorded</span>
            ) : (
              <TimestampLabel value={latestRequestAt} />
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border px-3 text-sm outline-none transition"
  + " bg-[#181d2c] text-[#e4e6f0] placeholder:text-[#586070]"
  + " border-[rgba(255,255,255,0.065)] focus:border-[#818cf8]";
