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
import { ApiClientError } from "@/lib/api/debug-client";
import { useWalletImportMutation } from "@/lib/query/use-wallet-import-mutation";

const DEFAULT_CHAIN_ID = "369";

type ImportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; payload: unknown }
  | { kind: "error"; message: string; details: string[] };

const fieldClassName =
  "w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60"
  + " bg-[#181d2c] text-[#e4e6f0] placeholder:text-[#586070]"
  + " border-[rgba(255,255,255,0.065)] focus:border-[#818cf8]";

export function WalletImportScreen() {
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [label, setLabel] = useState("");
  const [importState, setImportState] = useState<ImportState>({ kind: "idle" });

  const walletImportMutation = useWalletImportMutation();

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!walletAddress.trim()) {
      setImportState({
        kind: "error",
        message: "Wallet address is required.",
        details: [],
      });
      return;
    }

    const parsedChainId = parseChainId(chainId);
    if (!parsedChainId.ok) {
      setImportState({
        kind: "error",
        message: parsedChainId.message,
        details: [],
      });
      return;
    }

    setImportState({ kind: "loading" });

    try {
      const response = await walletImportMutation.mutateAsync({
        walletAddress: walletAddress.trim(),
        chainId: parsedChainId.value,
        label: label.trim() || undefined,
      });

      setImportState({ kind: "success", payload: response.data });
    } catch (error) {
      setImportState({
        kind: "error",
        message: getErrorMessage(error),
        details: getErrorDetails(error),
      });
    }
  }

  const isBusy = importState.kind === "loading";

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
              Wallet import
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-sm" style={{ color: "#a0a8c0" }}>
              Operator-facing page for registering a wallet address into backend
              tracking. Submits to POST /api/wallets/import and renders the
              backend response verbatim. The page does not compute balances,
              pricing, or PnL in the browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LabelBadge label="wallet import" tone="neutral" />
          </div>
        </div>
      </SurfaceCard>

      <OperatorToolsNav />

      <SectionCard
        title="Import a wallet"
        subtitle="Wallet address and chain ID are sent directly to the backend. The backend response is rendered without modification."
      >
        <form className="grid gap-4" onSubmit={handleImport}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
            <LabeledField label="Wallet address">
              <input
                aria-label="Wallet address"
                className={fieldClassName}
                placeholder="0x..."
                value={walletAddress}
                onChange={(event) => setWalletAddress(event.target.value)}
                disabled={isBusy}
              />
            </LabeledField>
            <LabeledField label="Chain ID">
              <input
                aria-label="Chain ID"
                className={fieldClassName}
                inputMode="numeric"
                value={chainId}
                onChange={(event) => setChainId(event.target.value)}
                disabled={isBusy}
              />
            </LabeledField>
          </div>
          <LabeledField label="Label (optional)">
            <input
              aria-label="Label"
              className={fieldClassName}
              placeholder="my-wallet"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={isBusy}
            />
          </LabeledField>
          <div>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] px-4 font-semibold text-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "#818cf8", color: "#0b0d14" }}
              disabled={isBusy}
            >
              {isBusy ? "Importing..." : "Import wallet"}
            </button>
          </div>
        </form>
      </SectionCard>

      <div aria-live="polite" aria-atomic="true">
        <ImportStatePanel state={importState} />
      </div>
    </PageContainer>
  );
}

function ImportStatePanel({ state }: { state: ImportState }) {
  if (state.kind === "idle") {
    return (
      <EmptyState
        title="No import submitted"
        message="Import result will appear here after submission. The raw backend response is preserved without modification."
      />
    );
  }

  if (state.kind === "loading") {
    return (
      <SectionCard
        title="Importing wallet"
        subtitle="The frontend is waiting for the backend import operation to finish."
      >
        <LoadingState blocks={2} className="grid gap-4 md:grid-cols-2" />
      </SectionCard>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState title="Import failed" message={state.message} />
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
      title="Import result"
      subtitle="Raw backend response is preserved below so operator-facing details stay explicit."
    >
      <div className="flex flex-wrap gap-2">
        <LabelBadge label="import completed" tone="fresh" />
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
