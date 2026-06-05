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
import { SUPPORTED_CHAINS } from "@/config/chains";
import type {
  TransactionDto,
  TransactionEntryDto,
  TransactionLedgerCoverageDto,
  TransactionsPageDto,
} from "@/services/transactions/types";

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
  const trimmed = args.walletAddress.trim().toLowerCase();
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
      return {
        validationError: "Limit must be a whole number between 1 and 100.",
        submittedParams: null,
      };
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

function resolveExplorerTxUrl(chainId: number, txHash: string): string | null {
  const chain = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!chain?.blockExplorers?.default?.url) return null;
  return `${chain.blockExplorers.default.url}/tx/${txHash}`;
}

function truncateTxHash(txHash: string): string {
  if (txHash.length <= 18) return txHash;
  return `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
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
        walletAddress: params.walletAddress,
        chainId: params.chainId,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
      }),
    });

    setSubmittedParams(params);
  }

  const isIdle = submittedParams === null && validationError === null;
  const isFetching = submittedParams !== null && transactionsQuery.isFetching;
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
        isLoading={isFetching}
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
        <TransactionResultView
          page={transactionsQuery.data}
          chainId={submittedParams?.chainId ?? 0}
        />
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
        <LabeledField label="Wallet address" htmlFor="tx-wallet-address">
          <input
            id="tx-wallet-address"
            aria-label="Wallet address"
            className={fieldClassName}
            placeholder="0x…"
            value={args.walletAddress}
            onChange={(e) => args.onWalletAddressChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </LabeledField>
        <LabeledField label="Chain ID" htmlFor="tx-chain-id">
          <input
            id="tx-chain-id"
            aria-label="Chain ID"
            className={fieldClassName}
            inputMode="numeric"
            value={args.chainId}
            onChange={(e) => args.onChainIdChange(e.target.value)}
          />
        </LabeledField>
        <LabeledField label="Limit (opt.)" htmlFor="tx-limit">
          <input
            id="tx-limit"
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
            disabled={args.isLoading}
            aria-disabled={args.isLoading}
            aria-busy={args.isLoading}
            className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--color-accent-2)] bg-[color:var(--color-accent-2)] px-4 font-medium text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {args.isLoading ? "Loading…" : "Load transactions"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

function LabeledField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function TransactionResultView({
  page,
  chainId,
}: {
  page: TransactionsPageDto;
  chainId: number;
}) {
  return (
    <>
      <LedgerCoveragePanel coverage={page.ledgerCoverage} />
      <TransactionList transactions={page.transactions} coverage={page.ledgerCoverage} chainId={chainId} />
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

  const label =
    coverage.status === "covered"
      ? "Covered"
      : coverage.status === "partial"
        ? "Partial"
        : "Unknown";

  return (
    <SurfaceCard
      className="flex flex-col gap-3"
      role="status"
      aria-label={`Ledger coverage: ${label}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Ledger coverage</span>
        <ProvenanceChip tone={tone}>{label}</ProvenanceChip>
      </div>
      {coverage.status !== "covered" && coverage.reason ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          {coverage.reason === "wallet-not-tracked"
            ? "This wallet is not tracked. Import it first to build a transaction ledger."
            : `Reason: ${coverage.reason}`}
        </p>
      ) : null}
      {coverage.status === "covered" ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Full ledger coverage — all transactions are accounted for.
        </p>
      ) : null}
    </SurfaceCard>
  );
}

function TransactionList({
  transactions,
  coverage,
  chainId,
}: {
  transactions: TransactionDto[];
  coverage: TransactionLedgerCoverageDto;
  chainId: number;
}) {
  if (transactions.length === 0) {
    if (coverage.status === "unknown" && coverage.reason === "wallet-not-tracked") {
      return (
        <EmptyState
          title="Wallet not tracked"
          message="This wallet has no ledger entries. Import it via the wallet import page to begin tracking."
        />
      );
    }
    return (
      <EmptyState
        title="No transactions"
        message="No canonical transaction entries were found for this wallet and chain."
      />
    );
  }

  return (
    <DataTableShell
      title={`Transactions (${transactions.length})`}
      subtitle="Canonical ledger entries from the backend. All fields are backend-provided — no local reconstruction."
    >
      <thead>
        <tr>
          <th scope="col" className={thClassName}>Occurred at</th>
          <th scope="col" className={thClassName}>Tx hash</th>
          <th scope="col" className={thClassName}>Action type</th>
          <th scope="col" className={thClassName}>Status</th>
          <th scope="col" className={thClassName}>Entries</th>
          <th scope="col" className={thClassName}>Warnings</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[color:var(--color-border-soft)]">
        {transactions.map((tx) => (
          <TransactionRow key={tx.transactionId} tx={tx} chainId={chainId} />
        ))}
      </tbody>
    </DataTableShell>
  );
}

function TransactionRow({ tx, chainId }: { tx: TransactionDto; chainId: number }) {
  const statusTone =
    tx.status === "complete"
      ? "fresh"
      : tx.status === "incomplete"
        ? "warn"
        : "neutral";

  const explorerUrl = resolveExplorerTxUrl(chainId, tx.txHash);

  return (
    <tr>
      <td className="px-4 py-3 align-top">
        <TimestampLabel value={tx.occurredAt} />
      </td>
      <td className="px-4 py-3 align-top">
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={tx.txHash}
            aria-label={`View transaction ${tx.txHash} on block explorer`}
            className="cp-data break-all text-xs underline decoration-[color:var(--color-border-strong)] underline-offset-2 hover:decoration-current"
          >
            {truncateTxHash(tx.txHash)}
          </a>
        ) : (
          <span className="cp-data break-all text-xs" title={tx.txHash}>
            {tx.txHash}
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <LabelBadge label={tx.actionType} tone="neutral" />
      </td>
      <td className="px-4 py-3 align-top">
        <ProvenanceChip tone={statusTone}>{tx.status}</ProvenanceChip>
      </td>
      <td className="px-4 py-3 align-top">
        {tx.entries.length > 0 ? (
          <div className="flex flex-col gap-2" role="list" aria-label="Transaction entries">
            {tx.entries.map((entry) => (
              <EntryRow key={entry.entryId} entry={entry} />
            ))}
          </div>
        ) : (
          <span className="text-xs text-[color:var(--color-text-muted)]">No entries</span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {tx.warnings.length > 0 ? (
          <ul aria-label="Transaction warnings" className="flex flex-col gap-1">
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
    <div
      className="flex flex-col gap-1 rounded border border-[color:var(--color-border-soft)] p-2 text-xs"
      role="listitem"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceChip tone={directionTone} aria-label={`Direction: ${entry.direction}`}>
          {entry.direction}
        </ProvenanceChip>
        <span className="cp-data">{entry.assetId}</span>
      </div>
      {entry.assetAddress ? (
        <span className="cp-data text-[color:var(--color-text-muted)]">{entry.assetAddress}</span>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="cp-data" aria-label="Quantity">{entry.quantity}</span>
        {entry.decimals !== null ? (
          <span className="text-[color:var(--color-text-muted)]">decimals: {entry.decimals}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        <ProvenanceChip tone="neutral">pricing: {entry.pricingStatus}</ProvenanceChip>
        <ProvenanceChip tone="neutral">valuation: {entry.valuationStatus}</ProvenanceChip>
      </div>
      {entry.rejectedReason ? (
        <span className="text-xs text-[color:var(--color-status-danger)]" role="alert">
          Rejected: {entry.rejectedReason}
        </span>
      ) : null}
      {entry.warnings.length > 0 ? (
        <ul aria-label="Entry warnings" className="flex flex-col gap-1">
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

const thClassName =
  "px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--color-text-muted)]";
