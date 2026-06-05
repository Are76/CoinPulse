"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { PageContainer } from "@/components/ui/page-container";
import { SectionCard } from "@/components/ui/section-card";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/data-state/empty-state";
import { ErrorState } from "@/components/ui/data-state/error-state";
import { LoadingState } from "@/components/ui/data-state/loading-state";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { LabelBadge } from "@/components/ui/status/status-badge";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { TimestampLabel } from "@/components/ui/value/timestamp-label";
import { ApiClientError } from "@/lib/api/transactions-client";
import { queryKeys } from "@/lib/query/query-keys";
import { useTransactionsQuery } from "@/lib/query/use-transactions-query";
import type { TransactionDto, TransactionEntryDto, TransactionLedgerCoverageDto, TransactionsPageDto } from "@/services/transactions/types";

const DEFAULT_CHAIN_ID = "369";
const TRANSACTIONS_SCHEMA_VERSION = "v1" as const;

type SubmittedParams = {
  walletAddress: string;
  chainId: number;
  limit: number | undefined;
};

function resolveSubmission(args: {
  walletAddress: string;
  chainId: string;
  limit: string;
}):
  | { validationError: string; submittedParams: null }
  | { validationError: null; submittedParams: SubmittedParams } {
  const trimmed = args.walletAddress.trim();
  if (trimmed.length === 0) {
    return { validationError: "Wallet address is required.", submittedParams: null };
  }
  const chainIdNum = Number(args.chainId);
  if (!Number.isInteger(chainIdNum) || chainIdNum <= 0) {
    return { validationError: "Chain ID must be a positive integer.", submittedParams: null };
  }
  let limit: number | undefined;
  if (args.limit.trim().length > 0) {
    const limitNum = Number(args.limit.trim());
    if (!Number.isInteger(limitNum) || limitNum <= 0 || limitNum > 100) {
      return { validationError: "Limit must be a whole number between 1 and 100.", submittedParams: null };
    }
    limit = limitNum;
  }
  return {
    validationError: null,
    submittedParams: { walletAddress: trimmed, chainId: chainIdNum, limit },
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred.";
}

export function TransactionHistoryScreen() {
  const queryClient = useQueryClient();
  const [walletAddress, setWalletAddress] = useState("");
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [limit, setLimit] = useState("");
  const [submittedParams, setSubmittedParams] = useState<SubmittedParams | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const transactionsQuery = useTransactionsQuery({
    walletAddress: submittedParams?.walletAddress ?? "",
    chainId: submittedParams?.chainId ?? 0,
    limit: submittedParams?.limit,
    enabled: submittedParams !== null,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submission = resolveSubmission({ walletAddress, chainId, limit });
    if (submission.validationError !== null) {
      setValidationError(submission.validationError);
      setSubmittedParams(null);
      return;
    }
    setValidationError(null);
    const params = submission.submittedParams;

    queryClient.removeQueries({
      queryKey: queryKeys.transactions(TRANSACTIONS_SCHEMA_VERSION, {
        walletAddress: params.walletAddress.toLowerCase(),
        chainId: params.chainId,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
      }),
    });

    setSubmittedParams(params);
  }

  const isIdle = submittedParams === null && validationError === null;
  const errorMessage =
    validationError ??
    (transactionsQuery.isError ? getErrorMessage(transactionsQuery.error) : null);

  return (
    <PageContainer className="flex flex-col gap-6">
      <SurfaceCard className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-muted)]">
            CoinPulse
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Transaction history
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-[color:var(--color-text-muted)]">
            Read-only view of canonical transaction entries from the backend ledger.
            The frontend renders backend DTOs only — no local pricing, valuation, or
            PnL computation.
          </p>
        </div>
      </SurfaceCard>

      <TransactionQueryForm
        walletAddress={walletAddress}
        chainId={chainId}
        limit={limit}
        isLoading={submittedParams !== null && transactionsQuery.isFetching}
        onWalletAddressChange={setWalletAddress}
        onChainIdChange={setChainId}
        onLimitChange={setLimit}
        onSubmit={handleSubmit}
      />

      {isIdle ? (
        <EmptyState
          title="No query submitted"
          message="Enter a wallet address and click Load transactions to fetch canonical transaction history."
        />
      ) : null}

      {errorMessage !== null ? (
        <ErrorState message={errorMessage} />
      ) : null}

      {submittedParams !== null && transactionsQuery.isLoading ? (
        <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
      ) : null}

      {transactionsQuery.data !== undefined && errorMessage === null ? (
        <TransactionResultView page={transactionsQuery.data} />
      ) : null}
    </PageContainer>
  );
}

function TransactionQueryForm(args: {
  walletAddress: string;
  chainId: string;
  limit: string;
  isLoading: boolean;
  onWalletAddressChange: (value: string) => void;
  onChainIdChange: (value: string) => void;
  onLimitChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SectionCard
      title="Query transaction history"
      subtitle="Query is only triggered by an explicit submit. The frontend renders the backend response without reconstructing entries, pricing, or PnL locally."
    >
      <form
        className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_8rem_auto]"
        onSubmit={args.onSubmit}
      >
        <LabeledField label="Wallet address">
          <input
            aria-label="Wallet address"
            className={fieldClassName}
            placeholder="0x..."
            value={args.walletAddress}
            onChange={(e) => args.onWalletAddressChange(e.target.value)}
          />
        </LabeledField>
        <LabeledField label="Chain ID">
          <input
            aria-label="Chain ID"
            className={fieldClassName}
            inputMode="numeric"
            value={args.chainId}
            onChange={(e) => args.onChainIdChange(e.target.value)}
          />
        </LabeledField>
        <LabeledField label="Limit (opt.)">
          <input
            aria-label="Limit"
            className={fieldClassName}
            inputMode="numeric"
            placeholder="50"
            value={args.limit}
            onChange={(e) => args.onLimitChange(e.target.value)}
          />
        </LabeledField>
        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--color-accent-2)] bg-[color:var(--color-accent-2)] px-4 font-medium text-slate-950 transition hover:opacity-90"
          >
            {args.isLoading ? "Loading..." : "Load transactions"}
          </button>
        </div>
      </form>
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
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function TransactionResultView({ page }: { page: TransactionsPageDto }) {
  return (
    <>
      <LedgerCoveragePanel coverage={page.ledgerCoverage} />
      <TransactionList transactions={page.transactions} />
    </>
  );
}

function LedgerCoveragePanel({ coverage }: { coverage: TransactionLedgerCoverageDto }) {
  const tone =
    coverage.status === "covered"
      ? "fresh"
      : coverage.status === "partial"
        ? "warn"
        : "neutral";

  return (
    <SurfaceCard className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Ledger coverage</span>
        <ProvenanceChip tone={tone}>{coverage.status}</ProvenanceChip>
      </div>
      {coverage.status !== "covered" && coverage.reason ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Reason: {coverage.reason}
        </p>
      ) : null}
    </SurfaceCard>
  );
}

function TransactionList({ transactions }: { transactions: TransactionDto[] }) {
  if (transactions.length === 0) {
    return (
      <EmptyState
        title="No transactions"
        message="No canonical transaction entries were found for this wallet and chain."
      />
    );
  }

  return (
    <DataTableShell
      title="Transactions"
      subtitle="Canonical ledger entries from the backend. All fields are backend-provided — no local reconstruction."
    >
      <thead>
        <tr>
          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
            Occurred at
          </th>
          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
            Tx hash
          </th>
          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
            Action type
          </th>
          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
            Status
          </th>
          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
            Entries
          </th>
          <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
            Warnings
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[color:var(--color-border-soft)]">
        {transactions.map((tx) => (
          <TransactionRow key={tx.transactionId} tx={tx} />
        ))}
      </tbody>
    </DataTableShell>
  );
}

function TransactionRow({ tx }: { tx: TransactionDto }) {
  const statusTone =
    tx.status === "complete"
      ? "fresh"
      : tx.status === "incomplete"
        ? "warn"
        : "neutral";

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <TimestampLabel value={tx.occurredAt} />
      </td>
      <td className="px-4 py-3 align-top">
        <span className="cp-data break-all text-xs">{tx.txHash}</span>
      </td>
      <td className="px-4 py-3 align-top">
        <LabelBadge label={tx.actionType} tone="neutral" />
      </td>
      <td className="px-4 py-3 align-top">
        <ProvenanceChip tone={statusTone}>{tx.status}</ProvenanceChip>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col gap-2">
          {tx.entries.map((entry) => (
            <EntryRow key={entry.entryId} entry={entry} />
          ))}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        {tx.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {tx.warnings.map((w, i) => (
              <li key={`warn-${i}`} className="text-xs text-[color:var(--color-status-warning)]">
                {w}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-[color:var(--color-text-muted)]">—</span>
        )}
      </td>
    </tr>
  );
}

function EntryRow({ entry }: { entry: TransactionEntryDto }) {
  const directionTone =
    entry.direction === "IN"
      ? "fresh"
      : entry.direction === "OUT"
        ? "danger"
        : "neutral";

  return (
    <div className="flex flex-col gap-1 rounded border border-[color:var(--color-border-soft)] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceChip tone={directionTone}>{entry.direction}</ProvenanceChip>
        <span className="cp-data">{entry.assetId}</span>
      </div>
      {entry.assetAddress ? (
        <span className="cp-data text-[color:var(--color-text-muted)]">{entry.assetAddress}</span>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="cp-data">{entry.quantity}</span>
        {entry.decimals !== null ? (
          <span className="text-[color:var(--color-text-muted)]">decimals: {entry.decimals}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        <ProvenanceChip tone="neutral">pricing: {entry.pricingStatus}</ProvenanceChip>
        <ProvenanceChip tone="neutral">valuation: {entry.valuationStatus}</ProvenanceChip>
      </div>
      {entry.rejectedReason ? (
        <span className="text-[color:var(--color-status-danger)]">
          Rejected: {entry.rejectedReason}
        </span>
      ) : null}
      {entry.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {entry.warnings.map((w, i) => (
            <li key={`ew-${i}`} className="text-[color:var(--color-status-warning)]">
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border border-[color:var(--color-border-soft)] bg-[color:var(--color-surface-2)] px-3 text-sm outline-none transition focus:border-[color:var(--color-accent-1)]";
