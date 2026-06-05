import "server-only";

import { getDb } from "@/lib/db";
import { resolveTrackedWalletByAddress } from "@/services/api/wallets";
import {
  TRANSACTIONS_DEFAULT_LIMIT,
  TRANSACTIONS_MAX_LIMIT,
  TRANSACTIONS_SCHEMA_VERSION,
} from "@/services/transactions/types";
import type {
  ListTransactionsArgs,
  TransactionDto,
  TransactionEntryDto,
  TransactionLedgerCoverageDto,
  TransactionPageInfoDto,
  TransactionsPageDto,
} from "@/services/transactions/types";

/**
 * Resolve a bounded page limit from the caller-supplied value.
 * Server enforces TRANSACTIONS_MAX_LIMIT; callers may not request unbounded sets.
 */
export function resolveTransactionLimit(requested: number | undefined): number {
  if (
    requested === undefined ||
    !Number.isFinite(requested) ||
    !Number.isInteger(requested) ||
    requested <= 0
  ) {
    return TRANSACTIONS_DEFAULT_LIMIT;
  }

  return Math.min(requested, TRANSACTIONS_MAX_LIMIT);
}

/**
 * Normalise an opaque pagination cursor from caller input.
 * Returns null when no cursor is present or the value is blank, signalling
 * a first-page request. Non-null values are passed through trimmed; the
 * real implementation will validate/decode the cursor against storage.
 */
export function resolveTransactionCursor(
  cursor: string | undefined,
): string | null {
  if (cursor === undefined || cursor.trim() === "") return null;
  return cursor.trim();
}

/**
 * Build the pageInfo block for a transactions page response.
 * Defaults to no-next-page / null-cursor so callers only need to override
 * when real pagination data is available.
 */
export function buildTransactionPageInfo(args: {
  limit: number;
  hasNextPage?: boolean;
  nextCursor?: string | null;
}): TransactionPageInfoDto {
  return {
    hasNextPage: args.hasNextPage ?? false,
    nextCursor: args.nextCursor ?? null,
    limit: args.limit,
  };
}

/**
 * Build the stable empty page envelope for wallet/chain.
 * Used when no records exist or the wallet is not yet tracked.
 */
export function buildEmptyTransactionsPage(args: {
  walletAddress: string;
  chainId: number;
  limit: number;
  ledgerCoverage?: TransactionLedgerCoverageDto;
}): TransactionsPageDto {
  return {
    schemaVersion: TRANSACTIONS_SCHEMA_VERSION,
    walletAddress: args.walletAddress,
    chainId: args.chainId,
    ledgerCoverage: args.ledgerCoverage ?? {
      status: "unknown",
      reason: "transaction-ledger-query-not-implemented",
    },
    pageInfo: buildTransactionPageInfo({ limit: args.limit }),
    transactions: [],
  };
}

/**
 * Map a single LedgerEntry (with optional token join) to a TransactionEntryDto.
 * valueUsd drives pricingStatus/valuationStatus: priced/valued when present,
 * unavailable otherwise. No raw-log fields are included.
 */
function mapEntry(entry: {
  id: string;
  assetId: string;
  entryType: string;
  direction: string;
  quantity: { toString(): string };
  valueUsd: { toString(): string } | null;
  token: { address: string; decimals: number } | null;
}): TransactionEntryDto {
  const valued = entry.valueUsd != null;
  return {
    entryId: entry.id,
    assetId: entry.assetId,
    assetAddress: entry.token?.address ?? null,
    entryType: entry.entryType,
    direction: entry.direction as "IN" | "OUT" | "INTERNAL",
    quantity: entry.quantity.toString(),
    decimals: entry.token?.decimals ?? null,
    pricingStatus: valued ? "priced" : "unavailable",
    pricingProvenance: null,
    valuationStatus: valued ? "valued" : "unavailable",
    valueQuote: entry.valueUsd?.toString() ?? null,
    quoteAsset: valued ? "USD" : null,
    pnlImpact: null,
    warnings: [],
    rejectedReason: null,
  };
}

/**
 * List canonical transactions for a wallet/chain from persisted ledger truth.
 *
 * Reads LedgerActionGroup rows for the resolved wallet, ordered by occurredAt
 * descending, and maps each group with its entries to a TransactionDto.
 * Raw logs, RPC, and frontend reconstruction are never used.
 */
export async function listCanonicalTransactions(
  args: ListTransactionsArgs,
): Promise<TransactionsPageDto> {
  const limit = resolveTransactionLimit(args.limit);

  const wallet = await resolveTrackedWalletByAddress({
    walletAddress: args.walletAddress,
    chainId: args.chainId,
  });

  if (!wallet) {
    return buildEmptyTransactionsPage({
      walletAddress: args.walletAddress,
      chainId: args.chainId,
      limit,
      ledgerCoverage: { status: "unknown", reason: "wallet-not-tracked" },
    });
  }

  const db = getDb();
  const actionGroups = await db.ledgerActionGroup.findMany({
    where: { walletId: wallet.id, chainId: args.chainId },
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    take: limit,
    include: {
      entries: {
        include: {
          token: { select: { address: true, decimals: true } },
        },
      },
    },
  });

  const txCoverage: TransactionLedgerCoverageDto = { status: "covered", reason: null };

  const transactions: TransactionDto[] = actionGroups.map((ag) => ({
    transactionId: ag.id,
    txHash: ag.txHash,
    chainId: ag.chainId,
    walletId: ag.walletId,
    walletAddress: wallet.address,
    occurredAt: ag.occurredAt.toISOString(),
    blockNumber: null,
    actionGroupId: ag.id,
    actionType: ag.actionType,
    sourceFamily: null,
    protocol: null,
    status: "complete" as const,
    warnings: [],
    provenance: {
      ledgerCoverage: txCoverage,
      materializationAsOf: null,
    },
    entries: ag.entries.map(mapEntry),
  }));

  return {
    schemaVersion: TRANSACTIONS_SCHEMA_VERSION,
    walletAddress: args.walletAddress,
    chainId: args.chainId,
    ledgerCoverage: txCoverage,
    pageInfo: buildTransactionPageInfo({ limit }),
    transactions,
  };
}
