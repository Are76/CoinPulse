"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

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
import { ApiClientError, type TransactionFilters } from "@/lib/api/transactions-client";
import { queryKeys } from "@/lib/query/query-keys";
import { useTransactionsQuery } from "@/lib/query/use-transactions-query";
import { SUPPORTED_CHAINS } from "@/config/chains";
import type {
  TransactionDto,
  TransactionEntryDto,
  TransactionLedgerCoverageDto,
  TransactionPageInfoDto,
  TransactionsPageDto,
} from "@/services/transactions/types";

const DEFAULT_CHAIN_ID = "369";
const TRANSACTIONS_SCHEMA_VERSION = "v1" as const;

type SubmittedParams = { walletAddress: string; chainId: number; limit: number | undefined; filters: TransactionFilters; submitKey: number };

function resolveSubmission(args: { walletAddress: string; chainId: string; limit: string; filters: TransactionFilters }) {
  const trimmed = args.walletAddress.trim().toLowerCase();
  if (!trimmed) return { validationError: "Wallet address is required.", submittedParams: null };
  const chainIdNum = Number(args.chainId);
  if (!Number.isInteger(chainIdNum) || chainIdNum <= 0)
    return { validationError: "Chain ID must be a positive integer.", submittedParams: null };
  let limit: number | undefined;
  if (args.limit.trim()) {
    const n = Number(args.limit.trim());
    if (!Number.isInteger(n) || n <= 0 || n > 100)
      return { validationError: "Limit must be a whole number between 1 and 100.", submittedParams: null };
    limit = n;
  }
  // Only include filter values that are non-empty
  const filters: TransactionFilters = {};
  if (args.filters.assetId?.trim()) filters.assetId = args.filters.assetId.trim();
  if (args.filters.actionType?.trim()) filters.actionType = args.filters.actionType.trim();
  if (args.filters.sourceFamily?.trim()) filters.sourceFamily = args.filters.sourceFamily.trim();
  if (args.filters.protocol?.trim()) filters.protocol = args.filters.protocol.trim();
  if (args.filters.fromDate?.trim()) filters.fromDate = args.filters.fromDate.trim();
  if (args.filters.toDate?.trim()) filters.toDate = args.filters.toDate.trim();
  return { validationError: null, submittedParams: { walletAddress: trimmed, chainId: chainIdNum, limit, filters } };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
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

/* ── Screen ────────────────────────────────────────────────────────────────────────────── */

export function TransactionHistoryScreen() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const initialWalletAddress = searchParams?.get("walletAddress") ?? "";
  const initialChainId = searchParams?.get("chainId") ?? DEFAULT_CHAIN_ID;
  const initialAssetId = searchParams?.get("assetId") ?? "";

  const [walletAddress, setWalletAddress] = useState(initialWalletAddress);
  const [chainId, setChainId] = useState(initialChainId);
  const [limit, setLimit] = useState("");
  const [filterAssetId, setFilterAssetId] = useState(initialAssetId);
  const [filterActionType, setFilterActionType] = useState("");
  const [filterSourceFamily, setFilterSourceFamily] = useState("");
  const [filterProtocol, setFilterProtocol] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [submittedParams, setSubmittedParams] = useState<SubmittedParams | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Pagination state
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);
  const [accumulatedTransactions, setAccumulatedTransactions] = useState<TransactionDto[]>([]);
  const [latestPage, setLatestPage] = useState<TransactionsPageDto | null>(null);
  const activeSubmitKeyRef = useRef<number>(0);
  const drillDownSubmittedRef = useRef(false);

  const transactionsQuery = useTransactionsQuery({
    walletAddress: submittedParams?.walletAddress ?? "",
    chainId: submittedParams?.chainId ?? 0,
    limit: submittedParams?.limit,
    cursor: currentCursor,
    filters: submittedParams?.filters,
    enabled: submittedParams !== null,
  });

  const submitKey = submittedParams?.submitKey ?? 0;
  useEffect(() => {
    if (!transactionsQuery.data) return;
    const data = transactionsQuery.data;
    setLatestPage(data);
    if (currentCursor === undefined) {
      // First page — replace accumulated list entirely
      setAccumulatedTransactions(data.transactions);
    } else {
      // Subsequent page — append, deduplicating by transactionId
      setAccumulatedTransactions((prev) => {
        const existingIds = new Set(prev.map((t) => t.transactionId));
        const newTxns = data.transactions.filter((t) => !existingIds.has(t.transactionId));
        return [...prev, ...newTxns];
      });
    }
  // submitKey is included so a new form submit re-fires the effect even when
  // the query data reference is unchanged (e.g. in tests with stable mocks).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionsQuery.data, currentCursor, submitKey]);

  // Auto-submit once on mount when arriving via drill-down (assetId in URL)
  useEffect(() => {
    if (drillDownSubmittedRef.current) return;
    if (!initialWalletAddress || !initialAssetId) return;
    drillDownSubmittedRef.current = true;
    const submission = resolveSubmission({
      walletAddress: initialWalletAddress,
      chainId: initialChainId,
      limit: "",
      filters: { assetId: initialAssetId },
    });
    if (submission.submittedParams === null) return;
    const params = submission.submittedParams;
    const nextKey = activeSubmitKeyRef.current + 1;
    activeSubmitKeyRef.current = nextKey;
    setCurrentCursor(undefined);
    setAccumulatedTransactions([]);
    setLatestPage(null);
    setSubmittedParams({ ...params, submitKey: nextKey });
  // Only run once on mount — intentionally omitting reactive deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submission = resolveSubmission({
      walletAddress,
      chainId,
      limit,
      filters: {
        assetId: filterAssetId,
        actionType: filterActionType,
        sourceFamily: filterSourceFamily,
        protocol: filterProtocol,
        fromDate: filterFromDate,
        toDate: filterToDate,
      },
    });
    if (submission.validationError !== null) {
      setValidationError(submission.validationError);
      setSubmittedParams(null);
      setCurrentCursor(undefined);
      setAccumulatedTransactions([]);
      setLatestPage(null);
      return;
    }
    setValidationError(null);
    const params = submission.submittedParams;
    const nextKey = activeSubmitKeyRef.current + 1;
    activeSubmitKeyRef.current = nextKey;
    // Remove all cached pages for the prior query to ensure fresh results
    queryClient.removeQueries({
      queryKey: queryKeys.transactions(TRANSACTIONS_SCHEMA_VERSION, {
        walletAddress: params.walletAddress,
        chainId: params.chainId,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(Object.keys(params.filters).length > 0 ? { filters: params.filters } : {}),
      }),
    });
    setCurrentCursor(undefined);
    setAccumulatedTransactions([]);
    setLatestPage(null);
    setSubmittedParams({ ...params, submitKey: nextKey });
  }

  function handleLoadMore() {
    if (latestPage?.pageInfo.nextCursor) {
      setCurrentCursor(latestPage.pageInfo.nextCursor);
    }
  }

  const isIdle = submittedParams === null && validationError === null;
  const isFirstPageLoading = submittedParams !== null && transactionsQuery.isLoading && currentCursor === undefined && latestPage === null;
  const isLoadingMore = submittedParams !== null && transactionsQuery.isFetching && currentCursor !== undefined;
  const errorMessage = validationError ?? (transactionsQuery.isError ? getErrorMessage(transactionsQuery.error) : null);

  return (
    <PageContainer className="flex flex-col gap-6">
      {/* Hero */}
      <SurfaceCard className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          CoinPulse
        </p>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#e4e6f0" }}>
          Transaction history
        </h1>
        <p className="text-sm leading-relaxed max-w-2xl" style={{ color: "#a0a8c0" }}>
          Read-only view of canonical ledger entries. The frontend renders backend DTOs only — no local pricing, valuation, or PnL computation.
        </p>
      </SurfaceCard>

      {/* Query form */}
      <SectionCard title="Query transaction history" subtitle="Submit to fetch canonical transaction history for a wallet.">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_8rem_auto]">
            <LabeledField label="Wallet address" htmlFor="tx-wallet-address">
              <input
                id="tx-wallet-address"
                aria-label="Wallet address"
                className={fieldClassName}
                placeholder="0x…"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </LabeledField>
            <LabeledField label="Chain ID" htmlFor="tx-chain-id">
              <input id="tx-chain-id" aria-label="Chain ID" className={fieldClassName} inputMode="numeric" value={chainId} onChange={(e) => setChainId(e.target.value)} />
            </LabeledField>
            <LabeledField label="Limit" htmlFor="tx-limit">
              <input id="tx-limit" aria-label="Limit" className={fieldClassName} inputMode="numeric" placeholder="50" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </LabeledField>
            <div className="flex items-end">
              <button type="submit" disabled={isFirstPageLoading} aria-disabled={isFirstPageLoading} aria-busy={isFirstPageLoading} className={submitButtonClassName}>
                {isFirstPageLoading ? "Loading…" : "Load transactions"}
              </button>
            </div>
          </div>

          {/* Filters */}
          <details className="rounded-[var(--radius-md)] border" style={{ borderColor: "rgba(255,255,255,0.065)" }} open={!!initialAssetId}>
            <summary
              className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-widest select-none"
              style={{ color: "#586070", letterSpacing: "0.08em" }}
            >
              Filters
              {(filterAssetId || filterActionType || filterSourceFamily || filterProtocol || filterFromDate || filterToDate) && (
                <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#818cf8", color: "#0b0d14" }}>
                  active
                </span>
              )}
            </summary>
            <div className="border-t px-4 py-4" style={{ borderColor: "rgba(255,255,255,0.065)" }}>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <LabeledField label="Asset ID" htmlFor="tx-filter-asset-id">
                  <input
                    id="tx-filter-asset-id"
                    aria-label="Asset ID filter"
                    className={fieldClassName}
                    placeholder="chain:369:erc20:0x…"
                    value={filterAssetId}
                    onChange={(e) => setFilterAssetId(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </LabeledField>
                <LabeledField label="Action type" htmlFor="tx-filter-action-type">
                  <input
                    id="tx-filter-action-type"
                    aria-label="Action type filter"
                    className={fieldClassName}
                    placeholder="e.g. TRANSFER"
                    value={filterActionType}
                    onChange={(e) => setFilterActionType(e.target.value)}
                    autoComplete="off"
                  />
                </LabeledField>
                <LabeledField label="Source family" htmlFor="tx-filter-source-family">
                  <input
                    id="tx-filter-source-family"
                    aria-label="Source family filter"
                    className={fieldClassName}
                    placeholder="e.g. TRANSFERS"
                    value={filterSourceFamily}
                    onChange={(e) => setFilterSourceFamily(e.target.value)}
                    autoComplete="off"
                  />
                </LabeledField>
                <LabeledField label="Protocol" htmlFor="tx-filter-protocol">
                  <input
                    id="tx-filter-protocol"
                    aria-label="Protocol filter"
                    className={fieldClassName}
                    placeholder="e.g. pulsex-v2"
                    value={filterProtocol}
                    onChange={(e) => setFilterProtocol(e.target.value)}
                    autoComplete="off"
                  />
                </LabeledField>
                <LabeledField label="From date" htmlFor="tx-filter-from-date">
                  <input
                    id="tx-filter-from-date"
                    aria-label="From date filter"
                    type="datetime-local"
                    className={fieldClassName}
                    value={filterFromDate ? filterFromDate.slice(0, 16) : ""}
                    onChange={(e) => setFilterFromDate(e.target.value ? new Date(e.target.value).toISOString() : "")}
                  />
                </LabeledField>
                <LabeledField label="To date" htmlFor="tx-filter-to-date">
                  <input
                    id="tx-filter-to-date"
                    aria-label="To date filter"
                    type="datetime-local"
                    className={fieldClassName}
                    value={filterToDate ? filterToDate.slice(0, 16) : ""}
                    onChange={(e) => setFilterToDate(e.target.value ? new Date(e.target.value).toISOString() : "")}
                  />
                </LabeledField>
              </div>
              {(filterAssetId || filterActionType || filterSourceFamily || filterProtocol || filterFromDate || filterToDate) && (
                <div className="mt-4">
                  <button
                    type="button"
                    className="text-xs font-semibold hover:opacity-80 transition"
                    style={{ color: "#586070" }}
                    onClick={() => {
                      setFilterAssetId("");
                      setFilterActionType("");
                      setFilterSourceFamily("");
                      setFilterProtocol("");
                      setFilterFromDate("");
                      setFilterToDate("");
                    }}
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
          </details>
        </form>
      </SectionCard>

      {/* States */}
      {isIdle && (
        <EmptyState title="No query submitted" message="Enter a wallet address and click Load transactions to fetch canonical transaction history." />
      )}
      {errorMessage !== null && <ErrorState message={errorMessage} />}
      {isFirstPageLoading && (
        <LoadingState blocks={3} className="grid gap-4 md:grid-cols-3" />
      )}

      {/* Results: shown whenever we have a loaded page, even alongside a load-more error */}
      {submittedParams !== null && latestPage !== null && (
        <TransactionResultView
          transactions={accumulatedTransactions}
          ledgerCoverage={latestPage.ledgerCoverage}
          pageInfo={latestPage.pageInfo}
          chainId={submittedParams.chainId}
          isLoadingMore={isLoadingMore}
          onLoadMore={handleLoadMore}
        />
      )}
    </PageContainer>
  );
}

/* ── Result view ───────────────────────────────────────────────────────────────────────────── */

function TransactionResultView({
  transactions,
  ledgerCoverage,
  pageInfo,
  chainId,
  isLoadingMore,
  onLoadMore,
}: {
  transactions: TransactionDto[];
  ledgerCoverage: TransactionLedgerCoverageDto;
  pageInfo: TransactionPageInfoDto;
  chainId: number;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <>
      <LedgerCoveragePanel coverage={ledgerCoverage} />
      <TransactionList
        transactions={transactions}
        coverage={ledgerCoverage}
        chainId={chainId}
        pageInfo={pageInfo}
        isLoadingMore={isLoadingMore}
        onLoadMore={onLoadMore}
      />
    </>
  );
}

function LedgerCoveragePanel({ coverage }: { coverage: TransactionLedgerCoverageDto }) {
  const tone = coverage.status === "covered" ? "fresh" : coverage.status === "partial" ? "warn" : "neutral";
  const label = coverage.status === "covered" ? "Covered" : coverage.status === "partial" ? "Partial" : "Unknown";

  return (
    <SurfaceCard className="flex flex-col gap-2" role="status" aria-label={`Ledger coverage: ${label}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
          Ledger coverage
        </span>
        <ProvenanceChip tone={tone} size="sm">{label}</ProvenanceChip>
      </div>
      {coverage.status === "covered" ? (
        <p className="text-xs" style={{ color: "#a0a8c0" }}>
          Full ledger coverage — all transactions are accounted for.
        </p>
      ) : null}
      {coverage.status !== "covered" && coverage.reason ? (
        <p className="text-xs" style={{ color: "#a0a8c0" }}>
          {coverage.reason === "wallet-not-tracked"
            ? "This wallet is not tracked. Import it first to build a transaction ledger."
            : `Reason: ${coverage.reason}`}
        </p>
      ) : null}
    </SurfaceCard>
  );
}

function TransactionList({
  transactions,
  coverage,
  chainId,
  pageInfo,
  isLoadingMore,
  onLoadMore,
}: {
  transactions: TransactionDto[];
  coverage: TransactionLedgerCoverageDto;
  chainId: number;
  pageInfo: TransactionPageInfoDto;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (transactions.length === 0) {
    if (coverage.status === "unknown" && coverage.reason === "wallet-not-tracked") {
      return <EmptyState title="Wallet not tracked" message="This wallet has no ledger entries. Import it via the wallet import page to begin tracking." />;
    }
    return <EmptyState title="No transactions" message="No canonical transaction entries were found for this wallet and chain." />;
  }

  return (
    <>
      <DataTableShell
        title={`Transactions (${transactions.length}${pageInfo.hasNextPage ? "+" : ""})`}
        subtitle="Canonical ledger entries from the backend. All fields are backend-provided — no local reconstruction."
      >
        <thead>
          <tr>
            <th scope="col" className={thClassName}>Occurred at</th>
            <th scope="col" className={thClassName}>Tx hash</th>
            <th scope="col" className={thClassName}>Type</th>
            <th scope="col" className={thClassName}>Status</th>
            <th scope="col" className={thClassName}>Entries</th>
            <th scope="col" className={thClassName}>Warnings</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <TransactionRow key={tx.transactionId} tx={tx} chainId={chainId} />
          ))}
        </tbody>
      </DataTableShell>
      {pageInfo.hasNextPage && pageInfo.nextCursor !== null && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            aria-disabled={isLoadingMore}
            aria-busy={isLoadingMore}
            className={submitButtonClassName}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}

function TransactionRow({ tx, chainId }: { tx: TransactionDto; chainId: number }) {
  const statusTone = tx.status === "complete" ? "fresh" : tx.status === "incomplete" ? "warn" : "neutral";
  const explorerUrl = resolveExplorerTxUrl(chainId, tx.txHash);

  return (
    <tr
      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      onMouseEnter={e => { e.currentTarget.style.background = "#1e2438"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      <td className={tdClassName}>
        <TimestampLabel value={tx.occurredAt} />
      </td>
      <td className={tdClassName}>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={tx.txHash}
            aria-label={`View transaction ${tx.txHash} on block explorer`}
            className="cp-data text-xs hover:underline"
            style={{ color: "#818cf8" }}
          >
            {truncateTxHash(tx.txHash)}
          </a>
        ) : (
          <span className="cp-data text-xs" title={tx.txHash} style={{ color: "#a0a8c0" }}>
            {truncateTxHash(tx.txHash)}
          </span>
        )}
      </td>
      <td className={tdClassName}>
        <LabelBadge label={tx.actionType} tone="neutral" size="sm" />
      </td>
      <td className={tdClassName}>
        <ProvenanceChip tone={statusTone} size="sm">{tx.status}</ProvenanceChip>
      </td>
      <td className={tdClassName}>
        {tx.entries.length > 0 ? (
          <div className="flex flex-col gap-1.5" role="list" aria-label="Transaction entries">
            {tx.entries.map((entry) => (
              <EntryRow key={entry.entryId} entry={entry} />
            ))}
          </div>
        ) : (
          <span className="text-xs" style={{ color: "#586070" }}>—</span>
        )}
      </td>
      <td className={tdClassName}>
        {tx.warnings.length > 0 ? (
          <ul aria-label="Transaction warnings" className="flex flex-col gap-1">
            {tx.warnings.map((w, i) => (
              <li key={`warn-${i}`} className="text-xs" style={{ color: "#f59e0b" }}>{w}</li>
            ))}
          </ul>
        ) : (
          <span className="text-xs" style={{ color: "#586070" }}>—</span>
        )}
      </td>
    </tr>
  );
}

function EntryRow({ entry }: { entry: TransactionEntryDto }) {
  const directionTone = entry.direction === "IN" ? "fresh" : entry.direction === "OUT" ? "danger" : "neutral";
  const directionColor = entry.direction === "IN" ? "#4ade80" : entry.direction === "OUT" ? "#f87171" : "#a0a8c0";

  return (
    <div
      className="flex flex-col gap-1 rounded-lg p-2 text-xs"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.055)" }}
      role="listitem"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceChip tone={directionTone} size="sm" aria-label={`Direction: ${entry.direction}`}>
          {entry.direction}
        </ProvenanceChip>
        <span className="cp-data text-xs" style={{ color: "#e4e6f0" }}>
          {entry.quantity}
        </span>
        <span className="text-xs" style={{ color: "#586070" }}>
          {entry.assetAddress ?? entry.assetId}
        </span>
      </div>
      {entry.decimals !== null && (
        <span className="text-xs" style={{ color: "#586070" }}>decimals: {entry.decimals}</span>
      )}
      <div className="flex flex-wrap gap-1">
        <ProvenanceChip tone="neutral" size="sm">pricing: {entry.pricingStatus}</ProvenanceChip>
        <ProvenanceChip tone="neutral" size="sm">valuation: {entry.valuationStatus}</ProvenanceChip>
      </div>
      {entry.rejectedReason && (
        <span role="alert" style={{ color: "#f87171" }}>Rejected: {entry.rejectedReason}</span>
      )}
      {entry.warnings.length > 0 && (
        <ul aria-label="Entry warnings" className="flex flex-col gap-0.5">
          {entry.warnings.map((w, i) => (
            <li key={`ew-${i}`} style={{ color: "#f59e0b" }}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Shared style constants ──────────────────────────────────────────────────────────────────────────── */

function LabeledField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#586070", letterSpacing: "0.08em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const fieldClassName =
  "h-11 w-full rounded-[var(--radius-md)] border px-3 text-sm outline-none transition"
  + " bg-[#181d2c] text-[#e4e6f0] placeholder:text-[#586070]"
  + " border-[rgba(255,255,255,0.065)] focus:border-[#818cf8]";

const submitButtonClassName =
  "inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] px-4 font-semibold text-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
  + " bg-[#818cf8] text-white";

const thClassName = "px-4 py-3 text-xs font-semibold uppercase text-left text-[#586070]"
  + " border-b border-[rgba(255,255,255,0.06)]";

const tdClassName = "px-4 py-3 align-top";