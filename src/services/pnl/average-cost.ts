import "server-only";

import Decimal from "decimal.js";

import type {
  AverageCostPnlResult,
  CalculateAverageCostPnlArgs,
  PnLEngine,
  PnLEntry,
  PnLWarning,
} from "@/services/pnl/types";

const ZERO = new Decimal(0);
const TARGET_ACQUISITION_TYPES = new Set(["RECEIVE", "SWAP_IN"]);
const TARGET_DISPOSITION_TYPES = new Set(["SEND", "SWAP_OUT"]);
const LP_ACTION_TYPES = new Set(["LP_ADD", "LP_REMOVE"]);
const STAKE_ACTION_TYPES = new Set(["HEX_STAKE_START", "HEX_STAKE_END", "HEX_STAKE_LOCK"]);

export const averageCostEngine: PnLEngine = {
  calculate: calculateAverageCostPnl,
};

export async function calculateAverageCostPnl(
  args: CalculateAverageCostPnlArgs,
): Promise<AverageCostPnlResult> {
  const warnings: PnLWarning[] = [];
  const priceCache = new Map<string, Promise<Decimal | null>>();

  let holdingsQuantity = ZERO;
  let carryingCost = ZERO;
  let realizedPnl = ZERO;
  let totalAcquiredQuantity = ZERO;
  let totalDisposedQuantity = ZERO;

  const relevantEntries = args.entries
    .filter((entry) => entry.walletId === args.walletId && entry.chainId === args.chainId)
    .sort((left, right) => {
      const occurredDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
      if (occurredDelta !== 0) {
        return occurredDelta;
      }

      return left.id.localeCompare(right.id);
    });

  const groups = new Map<string, PnLEntry[]>();
  for (const entry of relevantEntries) {
    const entries = groups.get(entry.actionGroupId);
    if (entries) {
      entries.push(entry);
    } else {
      groups.set(entry.actionGroupId, [entry]);
    }
  }

  for (const groupEntries of groups.values()) {
    groupEntries.sort((left, right) => left.id.localeCompare(right.id));
    const targetEntries = groupEntries.filter((entry) => entry.assetId === args.assetId);
    if (targetEntries.length === 0) {
      continue;
    }

    if (groupEntries.some((entry) => LP_ACTION_TYPES.has(entry.actionType))) {
      warnings.push({
        code: "UNSUPPORTED_LP_ACTION",
        actionGroupId: groupEntries[0]?.actionGroupId,
        assetId: args.assetId,
        detail: "LP action groups are skipped for average-cost PnL in v1.",
      });
      continue;
    }

    if (groupEntries.some((entry) => STAKE_ACTION_TYPES.has(entry.actionType))) {
      warnings.push({
        code: "UNSUPPORTED_STAKE_ACTION",
        actionGroupId: groupEntries[0]?.actionGroupId,
        assetId: args.assetId,
        detail: "Stake action groups are skipped for average-cost PnL in v1.",
      });
      continue;
    }

    if (targetEntries.every((entry) => entry.entryType === "INTERNAL_TRANSFER")) {
      continue;
    }

    const targetInEntries = targetEntries.filter(
      (entry) => entry.direction === "IN" && TARGET_ACQUISITION_TYPES.has(entry.entryType),
    );
    const targetOutEntries = targetEntries.filter(
      (entry) => entry.direction === "OUT" && TARGET_DISPOSITION_TYPES.has(entry.entryType),
    );
    const targetFeeEntries = targetEntries.filter((entry) => entry.entryType === "FEE");

    if (targetInEntries.length > 0 && targetOutEntries.length === 0 && targetFeeEntries.length === 0) {
      const acquiredQuantity = sumQuantities(targetInEntries);
      const acquisitionCost = await resolveGroupValue({
        entries: groupEntries.filter(
          (entry) =>
            entry.assetId !== args.assetId &&
            entry.direction === "OUT" &&
            entry.entryType !== "FEE" &&
            entry.entryType !== "INTERNAL_TRANSFER",
        ),
        at: targetInEntries[0].occurredAt,
        chainId: args.chainId,
        quoteAsset: args.quoteAsset,
        minimumConfidence: args.minimumConfidence,
        priceCache,
        resolvePrice: args.resolvePrice,
      });

      if (acquisitionCost === null) {
        warnings.push({
          code: "COUNTER_ASSET_PRICE_UNAVAILABLE",
          actionGroupId: groupEntries[0].actionGroupId,
          assetId: args.assetId,
          detail: "Acquisition counter-asset price could not be resolved.",
        });
        continue;
      }

      const nonTargetFeeCost = await resolveGroupValue({
        entries: groupEntries.filter(
          (entry) =>
            entry.assetId !== args.assetId &&
            entry.direction === "OUT" &&
            entry.entryType === "FEE",
        ),
        at: targetInEntries[0].occurredAt,
        chainId: args.chainId,
        quoteAsset: args.quoteAsset,
        minimumConfidence: args.minimumConfidence,
        priceCache,
        resolvePrice: args.resolvePrice,
      });

      if (nonTargetFeeCost === null) {
        warnings.push({
          code: "COUNTER_ASSET_PRICE_UNAVAILABLE",
          actionGroupId: groupEntries[0].actionGroupId,
          assetId: args.assetId,
          detail: "Fee asset price could not be resolved for acquisition.",
        });
        continue;
      }

      holdingsQuantity = holdingsQuantity.add(acquiredQuantity);
      carryingCost = carryingCost.add(acquisitionCost).add(nonTargetFeeCost);
      totalAcquiredQuantity = totalAcquiredQuantity.add(acquiredQuantity);
      continue;
    }

    if (targetOutEntries.length > 0 && targetInEntries.length === 0) {
      const disposedQuantity = sumQuantities(targetOutEntries).add(sumQuantities(targetFeeEntries));
      if (disposedQuantity.gt(holdingsQuantity)) {
        warnings.push({
          code: "INSUFFICIENT_COST_BASIS",
          actionGroupId: groupEntries[0].actionGroupId,
          assetId: args.assetId,
          detail: "Disposition exceeds tracked holdings and was skipped.",
        });
        continue;
      }

      const proceeds = await resolveGroupValue({
        entries: groupEntries.filter(
          (entry) =>
            entry.assetId !== args.assetId &&
            entry.direction === "IN" &&
            entry.entryType !== "INTERNAL_TRANSFER",
        ),
        at: targetOutEntries[0].occurredAt,
        chainId: args.chainId,
        quoteAsset: args.quoteAsset,
        minimumConfidence: args.minimumConfidence,
        priceCache,
        resolvePrice: args.resolvePrice,
      });

      if (proceeds === null) {
        warnings.push({
          code: "COUNTER_ASSET_PRICE_UNAVAILABLE",
          actionGroupId: groupEntries[0].actionGroupId,
          assetId: args.assetId,
          detail: "Disposition proceeds could not be resolved.",
        });
        continue;
      }

      const nonTargetFeeCost = await resolveGroupValue({
        entries: groupEntries.filter(
          (entry) =>
            entry.assetId !== args.assetId &&
            entry.direction === "OUT" &&
            entry.entryType === "FEE",
        ),
        at: targetOutEntries[0].occurredAt,
        chainId: args.chainId,
        quoteAsset: args.quoteAsset,
        minimumConfidence: args.minimumConfidence,
        priceCache,
        resolvePrice: args.resolvePrice,
      });

      if (nonTargetFeeCost === null) {
        warnings.push({
          code: "COUNTER_ASSET_PRICE_UNAVAILABLE",
          actionGroupId: groupEntries[0].actionGroupId,
          assetId: args.assetId,
          detail: "Fee asset price could not be resolved for disposition.",
        });
        continue;
      }

      const averageCost = holdingsQuantity.eq(ZERO) ? ZERO : carryingCost.div(holdingsQuantity);
      const costOfDisposed = averageCost.mul(disposedQuantity);

      holdingsQuantity = holdingsQuantity.sub(disposedQuantity);
      carryingCost = carryingCost.sub(costOfDisposed);
      realizedPnl = realizedPnl.add(proceeds.sub(nonTargetFeeCost).sub(costOfDisposed));
      totalDisposedQuantity = totalDisposedQuantity.add(disposedQuantity);
      continue;
    }

    warnings.push({
      code: "UNSUPPORTED_ACTION_GROUP",
      actionGroupId: groupEntries[0].actionGroupId,
      assetId: args.assetId,
      detail: "Action group could not be classified for average-cost PnL.",
    });
  }

  const averageCost = holdingsQuantity.eq(ZERO) ? ZERO : carryingCost.div(holdingsQuantity);
  const markPrice = await resolveMarkPrice(args, priceCache);
  if (markPrice === null) {
    warnings.push({
      code: "MARK_PRICE_UNAVAILABLE",
      assetId: args.assetId,
      detail: "Resolved mark price was stale, low-confidence, or unavailable.",
    });
  }
  const unrealizedPnl =
    markPrice === null ? null : markPrice.sub(averageCost).mul(holdingsQuantity);

  return {
    walletId: args.walletId,
    chainId: args.chainId,
    assetId: args.assetId,
    quoteAsset: args.quoteAsset,
    holdingsQuantity: toOutputString(holdingsQuantity),
    averageCost: toOutputString(averageCost),
    realizedPnl: toOutputString(realizedPnl),
    unrealizedPnl: unrealizedPnl ? toOutputString(unrealizedPnl) : null,
    markPrice: markPrice ? toOutputString(markPrice) : null,
    totalAcquiredQuantity: toOutputString(totalAcquiredQuantity),
    totalDisposedQuantity: toOutputString(totalDisposedQuantity),
    warnings,
  };
}

async function resolveMarkPrice(
  args: CalculateAverageCostPnlArgs,
  priceCache: Map<string, Promise<Decimal | null>>,
) {
  const markPrice = await resolveAssetPrice({
    chainId: args.chainId,
    assetId: args.assetId,
    quoteAsset: args.quoteAsset,
    at: args.asOf,
    minimumConfidence: args.minimumConfidence,
    priceCache,
    resolvePrice: args.resolvePrice,
  });

  if (markPrice === null) {
    return null;
  }

  return markPrice;
}

async function resolveGroupValue(args: {
  entries: readonly PnLEntry[];
  at: Date;
  chainId: number;
  quoteAsset: string;
  minimumConfidence?: string;
  priceCache: Map<string, Promise<Decimal | null>>;
  resolvePrice: CalculateAverageCostPnlArgs["resolvePrice"];
}) {
  let total = ZERO;

  for (const entry of args.entries) {
    const price = await resolveAssetPrice({
      chainId: args.chainId,
      assetId: entry.assetId,
      quoteAsset: args.quoteAsset,
      at: args.at,
      minimumConfidence: args.minimumConfidence,
      priceCache: args.priceCache,
      resolvePrice: args.resolvePrice,
    });

    if (price === null) {
      return null;
    }

    total = total.add(new Decimal(entry.quantity).mul(price));
  }

  return total;
}

async function resolveAssetPrice(args: {
  chainId: number;
  assetId: string;
  quoteAsset: string;
  at: Date;
  minimumConfidence?: string;
  priceCache: Map<string, Promise<Decimal | null>>;
  resolvePrice: CalculateAverageCostPnlArgs["resolvePrice"];
}) {
  const key = [
    args.chainId,
    args.assetId,
    args.quoteAsset,
    args.at.toISOString(),
    args.minimumConfidence ?? "",
  ].join(":");

  let pending = args.priceCache.get(key);
  if (!pending) {
    pending = args.resolvePrice({
      chainId: args.chainId,
      assetId: args.assetId,
      quoteAsset: args.quoteAsset,
      at: args.at,
      minimumConfidence: args.minimumConfidence,
    }).then((result) => (result.selected ? new Decimal(result.selected.price) : null));
    args.priceCache.set(key, pending);
  }

  return pending;
}

function sumQuantities(entries: readonly Pick<PnLEntry, "quantity">[]) {
  return entries.reduce((total, entry) => total.add(entry.quantity), ZERO);
}

function toOutputString(value: Decimal) {
  return value.toFixed().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
