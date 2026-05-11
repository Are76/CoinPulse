import type { AverageCostPnlResult, CalculateAverageCostPnlArgs, PnLWarning } from "@/services/pnl/types";
import type { PersistedPriceObservation, ResolveBestPriceResult } from "@/services/pricing/types";

export type DashboardStatus =
  | "available"
  | "unavailable"
  | "stale_price"
  | "low_confidence_price"
  | "unsupported"
  | "incomplete_basis"
  | "partial";

export type DashboardPricingDto = {
  status: Exclude<DashboardStatus, "partial" | "unsupported" | "incomplete_basis">;
  sourceType: PersistedPriceObservation["sourceType"] | null;
  sourceId: string | null;
  confidence: string | null;
  observedAt: string | null;
  staleAfterSeconds: number | null;
  rejectedReasons: string[];
};

export type DashboardValuationDto = {
  status: Exclude<DashboardStatus, "partial">;
  valueQuote: string | null;
};

export type DashboardPnlDto = {
  status: Exclude<DashboardStatus, "partial">;
  holdingsQuantity: string | null;
  averageCost: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  markPrice: string | null;
  totalAcquiredQuantity: string | null;
  totalDisposedQuantity: string | null;
  warnings: PnLWarning[];
};

export type DashboardMaterializationWarningCode =
  | "negative_token_balance"
  | "generic_persisted_warning";

export type DashboardMaterializationWarningDto = {
  code: DashboardMaterializationWarningCode;
  message: string;
};

export type DashboardNegativeBalanceDto = {
  assetId: string;
  assetAddress: string | null;
  balanceQuantity: string;
  decimals: number | null;
};

export type DashboardMaterializationFreshnessStatus = "fresh" | "stale" | "unknown";

export type DashboardMaterializationFreshnessDto = {
  status: DashboardMaterializationFreshnessStatus;
  reason: string | null;
  lastMaterializedAt: string | null;
  staleAfterSeconds: number | null;
};

export type DashboardLedgerCoverageStatus = "covered" | "partial" | "unknown";

export type DashboardLedgerCoverageDto = {
  status: DashboardLedgerCoverageStatus;
  fromBlock: string | null;
  toBlock: string | null;
  sourceFamilies: string[];
  reason: string | null;
};

export type DashboardMaterializationDto = {
  status: "RUNNING" | "FAILED" | "COMPLETED" | null;
  completedSuccessfully: boolean | null;
  lastAttemptedAt: string | null;
  latestMaterializedAt: string | null;
  updatedFromBlock: string | null;
  updatedToBlock: string | null;
  sourceLedgerFromBlock: string | null;
  sourceLedgerToBlock: string | null;
  warningCount: number;
  warnings: DashboardMaterializationWarningDto[];
  errorMessage: string | null;
  hasNegativeBalances: boolean;
  negativeBalances: DashboardNegativeBalanceDto[];
  freshness: DashboardMaterializationFreshnessDto;
};

export type PortfolioSummaryDto = {
  totalValueQuote: string | null;
  valuationStatus: DashboardStatus;
  valuationCoverage: {
    totalPositions: number;
    valuedPositions: number;
    unvaluedPositions: number;
  };
  warnings: string[];
};

export type DashboardTokenPositionDto = {
  assetId: string;
  assetAddress: string | null;
  balanceQuantity: string;
  decimals: number | null;
  updatedFromBlock: string | null;
  updatedToBlock: string | null;
  pricing: DashboardPricingDto;
  valuation: DashboardValuationDto;
  pnl: DashboardPnlDto;
};

export type DashboardLpPositionDto = {
  lpAssetId: string;
  lpTokenAddress: string | null;
  lpTokenQuantity: string;
  token0AssetId: string | null;
  token0Address: string | null;
  token1AssetId: string | null;
  token1Address: string | null;
  token0NetQuantity: string | null;
  token1NetQuantity: string | null;
  updatedFromBlock: string | null;
  updatedToBlock: string | null;
  valuation: DashboardValuationDto;
  pnl: DashboardPnlDto;
  warnings: string[];
};

export type DashboardStakePositionDto = {
  stakeKey: string;
  tokenAssetId: string;
  tokenAddress: string | null;
  principalQuantity: string;
  returnedQuantity: string;
  yieldQuantity: string | null;
  penaltyQuantity: string | null;
  status: string;
  startBlock: string | null;
  endBlock: string | null;
  valuation: DashboardValuationDto;
  pnl: DashboardPnlDto;
  warnings: string[];
};

export type PortfolioDashboardDto = {
  schemaVersion: "v1";
  wallet: {
    id: string;
    address: string;
    chainId: number;
  };
  quoteAsset: string;
  asOf: string;
  materialization: DashboardMaterializationDto;
  ledgerCoverage: DashboardLedgerCoverageDto;
  summary: PortfolioSummaryDto;
  tokenPositions: DashboardTokenPositionDto[];
  lpPositions: DashboardLpPositionDto[];
  stakePositions: DashboardStakePositionDto[];
};

export type DashboardDbClient = {
  portfolioTokenBalance: {
    findMany(args: {
      where: { walletId: string; chainId: number };
      orderBy?: Array<{ assetId: "asc" | "desc" }>;
    }): Promise<
      Array<{
        walletId: string;
        walletAddress: string;
        chainId: number;
        assetId: string;
        assetAddress: string | null;
        balanceQuantity: string | { toString(): string };
        decimals: number | null;
        updatedFromBlock: bigint | null;
        updatedToBlock: bigint | null;
      }>
    >;
  };
  portfolioLpPosition: {
    findMany(args: {
      where: { walletId: string; chainId: number };
      orderBy?: Array<{ lpAssetId: "asc" | "desc" }>;
    }): Promise<
      Array<{
        lpAssetId: string;
        lpTokenAddress: string | null;
        lpTokenQuantity: string | { toString(): string };
        token0AssetId: string | null;
        token0Address: string | null;
        token1AssetId: string | null;
        token1Address: string | null;
        token0NetQuantity: string | { toString(): string } | null;
        token1NetQuantity: string | { toString(): string } | null;
        updatedFromBlock: bigint | null;
        updatedToBlock: bigint | null;
      }>
    >;
  };
  portfolioStakePosition: {
    findMany(args: {
      where: { walletId: string; chainId: number };
      orderBy?: Array<{ stakeKey: "asc" | "desc" }>;
    }): Promise<
      Array<{
        stakeKey: string;
        tokenAssetId: string;
        tokenAddress: string | null;
        principalQuantity: string | { toString(): string };
        returnedQuantity: string | { toString(): string };
        yieldQuantity: string | { toString(): string } | null;
        penaltyQuantity: string | { toString(): string } | null;
        status: string;
        startBlock: bigint | null;
        endBlock: bigint | null;
      }>
    >;
  };
  portfolioMaterializationState?: {
    findUnique(args: {
      where: { walletId_chainId: { walletId: string; chainId: number } };
    }): Promise<{
      walletId: string;
      chainId: number;
      status: "RUNNING" | "FAILED" | "COMPLETED";
      completedSuccessfully: boolean;
      lastAttemptedAt: Date;
      latestMaterializedAt: Date | null;
      sourceLedgerFromBlock: bigint | null;
      sourceLedgerToBlock: bigint | null;
      updatedFromBlock: bigint | null;
      updatedToBlock: bigint | null;
      warningCount: number;
      warningDetails: unknown;
      errorMessage: string | null;
    } | null>;
  };
  ledgerEntry: {
    findMany(args: {
      where: { walletId: string; chainId: number };
      orderBy?: Array<{ occurredAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
      include?: {
        actionGroup: {
          select: {
            actionType: true;
          };
        };
      };
    }): Promise<
      Array<{
        id: string;
        chainId: number;
        walletId: string;
        assetId: string;
        entryType: string;
        direction: string;
        quantity: string | { toString(): string };
        occurredAt: Date;
        actionGroupId: string;
        txHash: string;
        sourceLogKey: string | null;
        actionType?: string;
        actionGroup?: { actionType: string };
      }>
    >;
  };
  priceObservation?: {
    findMany: NonNullable<Parameters<typeof import("@/services/pricing/price-resolver").resolveBestPriceFromStore>[1]["db"]>["priceObservation"]["findMany"];
  };
};

export type DashboardPriceResolver = (args: {
  chainId: number;
  assetId: string;
  quoteAsset: string;
  observedAt: Date;
  minimumConfidence?: string;
}) => Promise<ResolveBestPriceResult>;

export type DashboardPnlCalculator = (
  args: CalculateAverageCostPnlArgs,
) => Promise<AverageCostPnlResult>;
