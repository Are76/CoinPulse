import { z } from "zod";

export const TRANSACTIONS_SCHEMA_VERSION = "v1" as const;

export const TRANSACTIONS_MAX_LIMIT = 100;
export const TRANSACTIONS_DEFAULT_LIMIT = 50;

// ─── Status unions ─────────────────────────────────────────────────────────────

export type TransactionStatus =
  | "complete"
  | "incomplete"
  | "unsupported"
  | "unknown";

/**
 * Aligned with PnLDirection in src/services/pnl/types.ts.
 * "INTERNAL" represents intra-wallet movements with no net external flow.
 */
export type TransactionEntryDirection = "IN" | "OUT" | "INTERNAL";

export type TransactionPricingStatus =
  | "priced"
  | "unpriced"
  | "stale"
  | "rejected"
  | "unsupported"
  | "unavailable";

export type TransactionValuationStatus =
  | "valued"
  | "unvalued"
  | "stale"
  | "rejected"
  | "unsupported"
  | "unavailable";

export type TransactionPnlStatus =
  | "computed"
  | "uncomputed"
  | "incomplete"
  | "unavailable";

// ─── Request schema + type ─────────────────────────────────────────────────────

export const listTransactionsArgsSchema = z.object({
  walletAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "walletAddress must be a valid EVM address.")
    .transform((v) => v.toLowerCase()),
  chainId: z.number().int().positive("chainId must be a positive integer."),
  limit: z
    .number()
    .int("limit must be an integer.")
    .positive("limit must be positive.")
    .max(TRANSACTIONS_MAX_LIMIT, `limit may not exceed ${TRANSACTIONS_MAX_LIMIT}.`)
    .optional(),
  cursor: z.string().trim().min(1).optional(),
  assetId: z.string().trim().min(1).optional(),
  actionType: z.string().trim().min(1).optional(),
  sourceFamily: z.string().trim().min(1).optional(),
  protocol: z.string().trim().min(1).optional(),
  fromDate: z.string().datetime({ offset: true }).optional(),
  toDate: z.string().datetime({ offset: true }).optional(),
  quoteAsset: z.string().trim().min(1).optional(),
});

export type ListTransactionsArgs = z.input<typeof listTransactionsArgsSchema>;

// ─── Page info ─────────────────────────────────────────────────────────────────

export type TransactionPageInfoDto = {
  hasNextPage: boolean;
  nextCursor: string | null;
  limit: number;
};

// ─── Provenance ────────────────────────────────────────────────────────────────

export type TransactionProvenanceDto = {
  ledgerFresh: boolean;
  materializationAsOf: string | null;
};

// ─── Entry ─────────────────────────────────────────────────────────────────────

export type TransactionPnlImpactDto = {
  status: TransactionPnlStatus;
  realizedGain: string | null;
  unrealizedGain: string | null;
};

export type TransactionEntryDto = {
  entryId: string;
  /** Chain-aware backend asset identity. Never symbol/name/ticker. */
  assetId: string;
  assetAddress: string | null;
  entryType: string;
  direction: TransactionEntryDirection;
  /** Decimal string — must not be parsed to JS number for computation. */
  quantity: string;
  decimals: number | null;
  pricingStatus: TransactionPricingStatus;
  pricingProvenance: string | null;
  valuationStatus: TransactionValuationStatus;
  /** Quote-asset string — null when not valued. Must not be parsed to JS number. */
  valueQuote: string | null;
  quoteAsset: string | null;
  pnlImpact: TransactionPnlImpactDto | null;
  warnings: string[];
  rejectedReason: string | null;
};

// ─── Transaction ───────────────────────────────────────────────────────────────

export type TransactionDto = {
  transactionId: string;
  txHash: string;
  chainId: number;
  walletId: string;
  walletAddress: string;
  occurredAt: string;
  /**
   * Block number as a string to avoid BigInt serialization issues.
   * Null when not available from canonical ledger truth without joining
   * raw ingestion tables. Route implementation must not populate this
   * from raw ingestion tables; expose as null until a persisted ledger
   * column is available.
   */
  blockNumber: string | null;
  actionGroupId: string;
  actionType: string;
  /**
   * Source family is not persisted on LedgerActionGroup in the current
   * schema. Null until a canonical ledger column is available. Route
   * implementation must not back-fill from raw ingestion tables.
   */
  sourceFamily: string | null;
  /**
   * Protocol slug. Not persisted on LedgerActionGroup in the current
   * schema. Null until a canonical ledger column is available.
   */
  protocol: string | null;
  status: TransactionStatus;
  warnings: string[];
  provenance: TransactionProvenanceDto;
  entries: TransactionEntryDto[];
};

// ─── Page response ─────────────────────────────────────────────────────────────

export type TransactionsPageDto = {
  schemaVersion: typeof TRANSACTIONS_SCHEMA_VERSION;
  walletAddress: string;
  chainId: number;
  pageInfo: TransactionPageInfoDto;
  transactions: TransactionDto[];
};
