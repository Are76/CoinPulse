export type LiveSnapshotAssetPriceStatus = "priced" | "unpriced";

export type LiveHoldingsSnapshotValuationStatus = "available" | "partial" | "unavailable";

export type LiveSnapshotAssetDto = {
  assetId: string;
  assetAddress: string | null;
  symbol: string | null;
  decimals: number;
  balanceQuantity: string;
  priceStatus: LiveSnapshotAssetPriceStatus;
  valueQuote: string | null;
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
