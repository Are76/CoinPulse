import "server-only";

import Decimal from "decimal.js";

import { getDb } from "@/lib/db";
import { calculateAverageCostPnl } from "@/services/pnl/average-cost";
import type { PnLEntry, PnLWarning } from "@/services/pnl/types";
import { resolveBestPriceFromStore } from "@/services/pricing/price-resolver";
import type { ResolveBestPriceResult } from "@/services/pricing/types";
import type {
  DashboardDbClient,
  DashboardPnlCalculator,
  DashboardPnlDto,
  DashboardPriceResolver,
  DashboardPricingDto,
  DashboardStatus,
  PortfolioDashboardDto,
} from "@/services/dashboard/types";

const ZERO = new Decimal(0);

export async function assemblePortfolioDashboard(args: {
  wallet: { id: string; address: string; chainId: number };
  quoteAsset: string;
  asOf: Date;
  db?: DashboardDbClient;
  resolvePrice?: DashboardPriceResolver;
  calculatePnl?: DashboardPnlCalculator;
  minimumConfidence?: string;
}): Promise<PortfolioDashboardDto> {
  const db = args.db ?? (getDb() as unknown as DashboardDbClient);
  const resolvePrice =
    args.resolvePrice ??
    (async (priceArgs) => {
      if (!db.priceObservation) {
        return { selected: null, rejected: [] } satisfies ResolveBestPriceResult;
      }

      return resolveBestPriceFromStore(
        {
          chainId: priceArgs.chainId,
          assetId: priceArgs.assetId,
          quoteAsset: priceArgs.quoteAsset,
        },
        {
          db: { priceObservation: db.priceObservation } as never,
          observedAt: priceArgs.observedAt,
          minimumConfidence: priceArgs.minimumConfidence,
        },
      );
    });
  const calculatePnl = args.calculatePnl ?? calculateAverageCostPnl;

  const [tokenBalances, lpPositions, stakePositions, ledgerEntries] = await Promise.all([
    db.portfolioTokenBalance.findMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
      orderBy: [{ assetId: "asc" }],
    }),
    db.portfolioLpPosition.findMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
      orderBy: [{ lpAssetId: "asc" }],
    }),
    db.portfolioStakePosition.findMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
      orderBy: [{ stakeKey: "asc" }],
    }),
    db.ledgerEntry.findMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      include: { actionGroup: { select: { actionType: true } } },
    }),
  ]);

  const pnlEntries = ledgerEntries.map<PnLEntry>((entry) => ({
    id: entry.id,
    chainId: entry.chainId,
    walletId: entry.walletId,
    assetId: entry.assetId,
    entryType: entry.entryType as PnLEntry["entryType"],
    actionType: (entry.actionType ?? entry.actionGroup?.actionType ?? "TRANSFER") as PnLEntry["actionType"],
    direction: entry.direction as PnLEntry["direction"],
    quantity: toStringValue(entry.quantity),
    occurredAt: entry.occurredAt,
    actionGroupId: entry.actionGroupId,
    txHash: entry.txHash,
    sourceLogKey: entry.sourceLogKey,
  }));

  let totalValue = ZERO;
  let valuedPositions = 0;
  const summaryWarnings = new Set<string>();

  const tokenPositionDtos = await Promise.all(
    tokenBalances.map(async (row) => {
      const resolvedPrice = await resolvePrice({
        chainId: args.wallet.chainId,
        assetId: row.assetId,
        quoteAsset: args.quoteAsset,
        observedAt: args.asOf,
        minimumConfidence: args.minimumConfidence,
      });
      const pricing = toPricingDto(resolvedPrice);
      const valueQuote =
        resolvedPrice.selected && pricing.status === "available"
          ? toOutput(new Decimal(toStringValue(row.balanceQuantity)).mul(resolvedPrice.selected.price))
          : null;
      const valuationStatus = pricing.status;

      if (valueQuote !== null) {
        totalValue = totalValue.plus(valueQuote);
        valuedPositions += 1;
      } else {
        summaryWarnings.add(`pricing-unavailable:${row.assetId}:${valuationStatus}`);
      }

      const pnlResult = await calculatePnl({
        walletId: args.wallet.id,
        chainId: args.wallet.chainId,
        assetId: row.assetId,
        quoteAsset: args.quoteAsset,
        asOf: args.asOf,
        entries: pnlEntries,
        resolvePrice: async (pArgs) =>
          resolvePrice({
            chainId: pArgs.chainId,
            assetId: pArgs.assetId,
            quoteAsset: pArgs.quoteAsset,
            observedAt: pArgs.at,
            minimumConfidence: pArgs.minimumConfidence,
          }),
        minimumConfidence: args.minimumConfidence,
      });
      const pnl = toPnlDto(pnlResult, valuationStatus);
      for (const warning of pnl.warnings) {
        summaryWarnings.add(`pnl-warning:${warning.code}`);
      }

      return {
        assetId: row.assetId,
        assetAddress: row.assetAddress,
        balanceQuantity: toStringValue(row.balanceQuantity),
        decimals: row.decimals,
        updatedFromBlock: bigintToString(row.updatedFromBlock),
        updatedToBlock: bigintToString(row.updatedToBlock),
        pricing,
        valuation: {
          status: valuationStatus,
          valueQuote,
        },
        pnl,
      };
    }),
  );

  const lpDtos = lpPositions.map((row) => ({
    lpAssetId: row.lpAssetId,
    lpTokenAddress: row.lpTokenAddress,
    lpTokenQuantity: toStringValue(row.lpTokenQuantity),
    token0AssetId: row.token0AssetId,
    token0Address: row.token0Address,
    token1AssetId: row.token1AssetId,
    token1Address: row.token1Address,
    token0NetQuantity: nullableToString(row.token0NetQuantity),
    token1NetQuantity: nullableToString(row.token1NetQuantity),
    updatedFromBlock: bigintToString(row.updatedFromBlock),
    updatedToBlock: bigintToString(row.updatedToBlock),
    valuation: {
      status: "unsupported" as const,
      valueQuote: null,
    },
    pnl: unsupportedPnl("LP position PnL is unsupported in this slice."),
    warnings: ["lp-valuation-unsupported-v1"],
  }));

  const stakeDtos = stakePositions.map((row) => ({
    stakeKey: row.stakeKey,
    tokenAssetId: row.tokenAssetId,
    tokenAddress: row.tokenAddress,
    principalQuantity: toStringValue(row.principalQuantity),
    returnedQuantity: toStringValue(row.returnedQuantity),
    yieldQuantity: nullableToString(row.yieldQuantity),
    penaltyQuantity: nullableToString(row.penaltyQuantity),
    status: row.status,
    startBlock: bigintToString(row.startBlock),
    endBlock: bigintToString(row.endBlock),
    valuation: {
      status: "unsupported" as const,
      valueQuote: null,
    },
    pnl: unsupportedPnl("Stake PnL is unsupported in this slice."),
    warnings: ["stake-valuation-unsupported-v1"],
  }));

  const totalPositions = tokenPositionDtos.length + lpDtos.length + stakeDtos.length;
  const unvaluedPositions = totalPositions - valuedPositions;
  const valuationStatus: DashboardStatus =
    totalPositions === 0
      ? "unavailable"
      : valuedPositions === totalPositions
        ? "available"
        : valuedPositions === 0
          ? tokenPositionDtos[0]?.valuation.status ?? "unavailable"
          : "partial";

  return {
    schemaVersion: "v1",
    wallet: args.wallet,
    quoteAsset: args.quoteAsset,
    asOf: args.asOf.toISOString(),
    summary: {
      totalValueQuote: valuedPositions === 0 ? null : toOutput(totalValue),
      valuationStatus,
      valuationCoverage: {
        totalPositions,
        valuedPositions,
        unvaluedPositions,
      },
      warnings: Array.from(summaryWarnings).sort(),
    },
    tokenPositions: tokenPositionDtos,
    lpPositions: lpDtos,
    stakePositions: stakeDtos,
  };
}

function toPricingDto(result: ResolveBestPriceResult): DashboardPricingDto {
  if (result.selected) {
    return {
      status: "available",
      sourceType: result.selected.sourceType,
      sourceId: result.selected.sourceId,
      confidence: result.selected.confidence,
      observedAt: result.selected.observedAt.toISOString(),
      staleAfterSeconds: result.selected.staleAfterSeconds,
      rejectedReasons: result.rejected.map((item) => item.reason),
    };
  }

  const reasons = result.rejected.map((item) => item.reason);
  return {
    status: reasons.includes("STALE")
      ? "stale_price"
      : reasons.includes("LOW_CONFIDENCE")
        ? "low_confidence_price"
        : "unavailable",
    sourceType: null,
    sourceId: null,
    confidence: null,
    observedAt: null,
    staleAfterSeconds: null,
    rejectedReasons: reasons,
  };
}

function toPnlDto(
  result: Awaited<ReturnType<typeof calculateAverageCostPnl>>,
  valuationStatus: DashboardStatus,
): DashboardPnlDto {
  let status: DashboardPnlDto["status"] = "available";
  if (result.warnings.length > 0) {
    if (
      result.warnings.some((warning) =>
        ["COUNTER_ASSET_PRICE_UNAVAILABLE", "INSUFFICIENT_COST_BASIS", "UNSUPPORTED_ACTION_GROUP"].includes(
          warning.code,
        ),
      )
    ) {
      status = "incomplete_basis";
    } else if (
      result.warnings.some((warning) =>
        ["UNSUPPORTED_LP_ACTION", "UNSUPPORTED_STAKE_ACTION"].includes(warning.code),
      )
    ) {
      status = "unsupported";
    } else if (result.warnings.some((warning) => warning.code === "MARK_PRICE_UNAVAILABLE")) {
      status =
        valuationStatus === "stale_price" || valuationStatus === "low_confidence_price"
          ? valuationStatus
          : "unavailable";
    }
  }

  return {
    status,
    holdingsQuantity: result.holdingsQuantity,
    averageCost: result.averageCost,
    realizedPnl: result.realizedPnl,
    unrealizedPnl: result.unrealizedPnl,
    markPrice: result.markPrice,
    totalAcquiredQuantity: result.totalAcquiredQuantity,
    totalDisposedQuantity: result.totalDisposedQuantity,
    warnings: result.warnings,
  };
}

function unsupportedPnl(detail: string): DashboardPnlDto {
  return {
    status: "unsupported",
    holdingsQuantity: null,
    averageCost: null,
    realizedPnl: null,
    unrealizedPnl: null,
    markPrice: null,
    totalAcquiredQuantity: null,
    totalDisposedQuantity: null,
    warnings: [
      {
        code: "UNSUPPORTED_ACTION_GROUP",
        detail,
      } satisfies PnLWarning,
    ],
  };
}

function toStringValue(value: string | { toString(): string }) {
  return typeof value === "string" ? value : value.toString();
}

function nullableToString(value: string | { toString(): string } | null) {
  return value === null ? null : toStringValue(value);
}

function bigintToString(value: bigint | null) {
  return value === null ? null : value.toString();
}

function toOutput(value: Decimal | string) {
  const decimal = typeof value === "string" ? new Decimal(value) : value;
  return decimal.toFixed().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
