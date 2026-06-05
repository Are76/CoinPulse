export const TRANSACTIONS_SCHEMA_VERSION = "v1" as const;

export const TRANSACTIONS_MAX_LIMIT = 100;
export const TRANSACTIONS_DEFAULT_LIMIT = 50;

// ─── Status unions ─────────────────────────────────────────────────────────────

export type TransactionStatus =
  | "complete"
  | "incomplete"
  | "unsupported"
  | "unknown";

export type TransactionEntryDirection = "IN" | "OUT" | "NEUTRAL";

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

// ─── Request ───────────────────────────────────────────────────────────────────

export type ListTransactionsArgs = {
  walletAddress: string;
  chainId: number;
  limit?: number;
  cursor?: string;
  assetId?: string;
  actionType?: string;
  sourceFamily?: string;
  protocol?: string;
  fromDate?: string;
  toDate?: string;
  quoteAsset?: string;
};

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
  /** String to avoid BigInt serialization issues at the DTO boundary. */
  blockNumber: string;
  actionGroupId: string;
  actionType: string;
  sourceFamily: string;
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
