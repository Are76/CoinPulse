export type LiveSnapshotAssetPriceStatus = "priced" | "unpriced";

export type LiveHoldingsSnapshotValuationStatus = "available" | "partial" | "unavailable";

// Mirrors the field vocabulary of DashboardPricingDto (src/services/dashboard/types.ts)
// so price provenance reads the same way across both DTOs, plus the block the
// observation was made at (dashboard's equivalent doesn't need it — this DTO's
// whole premise is a single observed block, so it's included here).
export type LiveSnapshotPriceProvenanceDto = {
  sourceType: string | null;
  sourceId: string | null;
  confidence: string | null;
  observedAt: string | null;
  observedBlock: string | null;
  staleAfterSeconds: number | null;
  rejectedReasons: string[];
};

export type LiveSnapshotAssetDto = {
  assetId: string;
  assetAddress: string | null;
  symbol: string | null;
  decimals: number;
  balanceQuantity: string;
  priceStatus: LiveSnapshotAssetPriceStatus;
  valueQuote: string | null;
  pricing: LiveSnapshotPriceProvenanceDto;
};

export type LiveHoldingsSnapshotDto = {
  schemaVersion: "v1";
  wallet: {
    address: string;
    chainId: number;
  };
  quoteAsset: string;
  asOf: string;
  sourceType: "LIVE_RPC_SNAPSHOT";
  observedBlock: string;
  coverage: "known_assets_only";
  coverageNote: string;
  pnlStatus: "unsupported";
  assets: LiveSnapshotAssetDto[];
  totalValueQuote: string | null;
  valuationStatus: LiveHoldingsSnapshotValuationStatus;
  warnings: string[];
};
