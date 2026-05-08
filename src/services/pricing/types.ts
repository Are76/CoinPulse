export type PriceSourceType =
  | "ONCHAIN_POOL"
  | "ONCHAIN_ROUTE"
  | "ORACLE"
  | "MANUAL"
  | "DEXSCREENER";

export type PriceObservationDraft = {
  chainId: number;
  assetId: string;
  assetAddress: string | null;
  quoteAsset: string;
  price: string;
  sourceType: PriceSourceType;
  sourceId: string;
  routeMetadata: Record<string, unknown> | null;
  liquidityUsd: string | null;
  confidence: string;
  observedAt: Date;
  blockNumber: bigint | null;
  staleAfterSeconds: number;
};

export type PersistedPriceObservation = PriceObservationDraft & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PriceObservationRejectReason =
  | "STALE"
  | "LOW_CONFIDENCE"
  | "SOURCE_DISABLED";

export type RejectedPriceObservation = {
  id: string;
  reason: PriceObservationRejectReason;
};

export type ResolveBestPriceResult = {
  selected: PersistedPriceObservation | null;
  rejected: RejectedPriceObservation[];
};
