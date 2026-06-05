import "server-only";

import {
  TRANSACTIONS_DEFAULT_LIMIT,
  TRANSACTIONS_MAX_LIMIT,
  TRANSACTIONS_SCHEMA_VERSION,
} from "@/services/transactions/types";
import type {
  ListTransactionsArgs,
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
 * Used by the skeleton and by the real implementation when no records exist.
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
 * List canonical transactions for a wallet/chain from persisted ledger truth.
 *
 * This skeleton returns a stable empty envelope. Real implementation will
 * query the canonical ledger and action-group tables. It must never query
 * raw logs or reconstruct transaction meaning in the service layer.
 */
export async function listCanonicalTransactions(
  args: ListTransactionsArgs,
): Promise<TransactionsPageDto> {
  const limit = resolveTransactionLimit(args.limit);

  return buildEmptyTransactionsPage({
    walletAddress: args.walletAddress,
    chainId: args.chainId,
    limit,
  });
}
