import type { ResolveBestPriceResult } from "@/services/pricing/types";

export type PnLEntryType =
  | "RECEIVE"
  | "SEND"
  | "SWAP_IN"
  | "SWAP_OUT"
  | "FEE"
  | "LP_ADD_IN"
  | "LP_ADD_OUT"
  | "LP_REMOVE_IN"
  | "LP_REMOVE_OUT"
  | "STAKE_START"
  | "STAKE_END"
  | "STAKE_PRINCIPAL_LOCKED"
  | "STAKE_PRINCIPAL_RETURNED"
  | "STAKE_YIELD_RECEIVED"
  | "STAKE_PENALTY"
  | "INTERNAL_TRANSFER";

export type PnLActionType =
  | "TRANSFER"
  | "SWAP"
  | "LP_ADD"
  | "LP_REMOVE"
  | "HEX_STAKE_START"
  | "HEX_STAKE_END"
  | "HEX_STAKE_LOCK";

export type PnLDirection = "IN" | "OUT" | "INTERNAL";

export type PnLEntry = {
  id: string;
  chainId: number;
  walletId: string;
  assetId: string;
  entryType: PnLEntryType;
  actionType: PnLActionType;
  direction: PnLDirection;
  quantity: string;
  occurredAt: Date;
  actionGroupId: string;
  txHash: string;
  sourceLogKey: string | null;
};

export type ResolvePnLPriceArgs = {
  chainId: number;
  assetId: string;
  quoteAsset: string;
  at: Date;
  minimumConfidence?: string;
};

export type PnLPriceResolver = (
  args: ResolvePnLPriceArgs,
) => Promise<ResolveBestPriceResult>;

export type PnLWarningCode =
  | "MARK_PRICE_UNAVAILABLE"
  | "COUNTER_ASSET_PRICE_UNAVAILABLE"
  | "UNSUPPORTED_LP_ACTION"
  | "UNSUPPORTED_STAKE_ACTION"
  | "UNSUPPORTED_ACTION_GROUP"
  | "INSUFFICIENT_COST_BASIS";

export type PnLWarning = {
  code: PnLWarningCode;
  actionGroupId?: string;
  assetId?: string;
  detail: string;
};

export type CalculateAverageCostPnlArgs = {
  walletId: string;
  chainId: number;
  assetId: string;
  quoteAsset: string;
  asOf: Date;
  entries: readonly PnLEntry[];
  resolvePrice: PnLPriceResolver;
  minimumConfidence?: string;
};

export type AverageCostPnlResult = {
  walletId: string;
  chainId: number;
  assetId: string;
  quoteAsset: string;
  holdingsQuantity: string;
  averageCost: string;
  realizedPnl: string;
  unrealizedPnl: string | null;
  markPrice: string | null;
  totalAcquiredQuantity: string;
  totalDisposedQuantity: string;
  warnings: PnLWarning[];
};

export interface PnLEngine {
  calculate(args: CalculateAverageCostPnlArgs): Promise<AverageCostPnlResult>;
}
