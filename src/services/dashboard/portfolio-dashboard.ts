import "server-only";

import Decimal from "decimal.js";

import { getDb } from "@/lib/db";
import { calculateAverageCostPnl } from "@/services/pnl/average-cost";
import type { PnLEntry, PnLWarning } from "@/services/pnl/types";
import { resolveBestPriceFromStore } from "@/services/pricing/price-resolver";
import type { ResolveBestPriceResult } from "@/services/pricing/types";
import { computeTokenMetadataStatus } from "@/services/dashboard/token-metadata-status";
import type {
  DashboardDbClient,
  DashboardLedgerCoverageDto,
  DashboardMaterializationDto,
  DashboardMaterializationFreshnessDto,
  DashboardMaterializationWarningDto,
  DashboardMetadataProvenanceConfidence,
  DashboardMetadataProvenanceSource,
  DashboardPnlCalculator,
  DashboardPnlCoverageDto,
  DashboardPnlCoverageReason,
  DashboardPnlCoverageSection,
  DashboardPnlDto,
  DashboardPriceResolver,
  DashboardPricingDto,
  DashboardStatus,
  DashboardTokenMetadataProvenanceDto,
  PortfolioDashboardDto,
} from "@/services/dashboard/types";

/**
 * Conservative threshold after which a materialization is considered stale.
 * 15 minutes gives one full sync cycle headroom for most wallets.
 */
const MATERIALIZATION_STALE_AFTER_SECONDS = 15 * 60; // 900 seconds

const ZERO = new Decimal(0);

const PNL_COVERAGE_REASON_ORDER: DashboardPnlCoverageReason[] = [
  "unpriced",
  "insufficient_cost_basis",
  "partial_history",
  "stale_price",
  "source_disabled",
  "unsupported_position_type",
  "missing_disposal_events",
  "missing_native_price_history",
];

const PNL_COVERAGE_SECTION_ORDER: DashboardPnlCoverageSection[] = [
  "summary",
  "tokens",
  "lpPositions",
  "stakePositions",
];

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

  const [tokenBalances, lpPositions, stakePositions, materializationState, ledgerEntries] = await Promise.all([
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
    db.portfolioMaterializationState?.findUnique({
      where: {
        walletId_chainId: {
          walletId: args.wallet.id,
          chainId: args.wallet.chainId,
        },
      },
    }) ?? Promise.resolve(null),
    db.ledgerEntry.findMany({
      where: { walletId: args.wallet.id, chainId: args.wallet.chainId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      include: { actionGroup: { select: { actionType: true } } },
    }),
  ]);

  const tokenMetadataRows = tokenBalances.length === 0 || !db.token
    ? []
    : await db.token.findMany({
        where: { chainId: args.wallet.chainId, assetId: { in: tokenBalances.map((row) => row.assetId) } },
        select: {
          assetId: true,
          decimalsSource: true,
          metadataSources: {
            select: { sourceKind: true, observedAt: true, decimals: true },
            orderBy: [{ observedAt: "desc" }],
          },
        },
      });
  const tokenMetadataByAssetId = new Map(tokenMetadataRows.map((row) => [row.assetId, row]));

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
        metadataProvenance: toTokenMetadataProvenanceDto(tokenMetadataByAssetId.get(row.assetId) ?? null, args.asOf),
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
  const materialization = toMaterializationDto(tokenBalances, materializationState, args.asOf);
  const ledgerCoverage = computeLedgerCoverage(materializationState);

  return {
    schemaVersion: "v1",
    wallet: args.wallet,
    quoteAsset: args.quoteAsset,
    asOf: args.asOf.toISOString(),
    materialization,
    ledgerCoverage,
    pnlCoverage: buildInitialPnlCoverage({
      tokenPositions: tokenPositionDtos,
      lpPositions: lpDtos,
      stakePositions: stakeDtos,
      asOf: args.asOf,
    }),
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

/**
 * Deterministically selects the latest metadata source from an unsorted array.
 * Null/undefined observedAt is treated as oldest (epoch 0).
 * Equal timestamps are tie-broken alphabetically by sourceKind for stability.
 */
function selectLatestMetadataSource(
  sources: Array<{ sourceKind: string; observedAt: Date | null; decimals?: number | null }>,
): { sourceKind: string; observedAt: Date | null; decimals?: number | null } | null {
  if (sources.length === 0) return null;
  return sources.reduce((best, candidate) => {
    const bestMs = best.observedAt?.getTime() ?? 0;
    const candidateMs = candidate.observedAt?.getTime() ?? 0;
    if (candidateMs > bestMs) return candidate;
    if (candidateMs < bestMs) return best;
    return candidate.sourceKind < best.sourceKind ? candidate : best;
  });
}

function toTokenMetadataProvenanceDto(
  token: {
    decimalsSource: string | null;
    metadataSources?: Array<{ sourceKind: string; observedAt: Date | null; decimals?: number | null }>;
  } | null,
  asOf: Date,
): DashboardTokenMetadataProvenanceDto {
  if (!token) {
    return UNKNOWN_METADATA_PROVENANCE;
  }

  const latestSource = selectLatestMetadataSource(token.metadataSources ?? []);
  const sourceEvidence = latestSource?.sourceKind ?? token.decimalsSource ?? null;
  if (!sourceEvidence) {
    return UNKNOWN_METADATA_PROVENANCE;
  }

  const source = mapTokenMetadataSource(sourceEvidence);
  if (source === "unknown") {
    return UNKNOWN_METADATA_PROVENANCE;
  }

  const { status, conflictReason } = computeTokenMetadataStatus({
    source,
    latestObservedAt: latestSource?.observedAt ?? null,
    asOf,
    allSources: token.metadataSources ?? [],
  });

  return {
    status,
    source,
    observedAt: latestSource?.observedAt?.toISOString() ?? null,
    confidence: mapTokenMetadataConfidence(sourceEvidence),
    conflictReason,
  };
}

const UNKNOWN_METADATA_PROVENANCE: DashboardTokenMetadataProvenanceDto = {
  status: "unknown",
  source: "unknown",
  observedAt: null,
  confidence: "unknown",
  conflictReason: null,
};

function mapTokenMetadataSource(sourceEvidence: string): DashboardMetadataProvenanceSource {
  const upper = sourceEvidence.toUpperCase();

  if (upper === "RPC") {
    return "chain";
  }
  if (upper === "MANUAL" || upper.startsWith("MANUAL")) {
    return "manual";
  }
  if (upper === "SEED" || upper.startsWith("SEED:")) {
    return "derived";
  }

  return "unknown";
}

function mapTokenMetadataConfidence(sourceEvidence: string): DashboardMetadataProvenanceConfidence {
  const upper = sourceEvidence.toUpperCase();

  if (upper === "RPC") {
    return "medium";
  }
  if (upper === "MANUAL" || upper.startsWith("MANUAL")) {
    return "medium";
  }
  if (upper === "SEED" || upper.startsWith("SEED:")) {
    return "low";
  }

  return "unknown";
}

function buildInitialPnlCoverage(args: {
  tokenPositions: Array<{ pricing: DashboardPricingDto; pnl: DashboardPnlDto }>;
  lpPositions: Array<{ pnl: DashboardPnlDto }>;
  stakePositions: Array<{ pnl: DashboardPnlDto }>;
  asOf: Date;
}): DashboardPnlCoverageDto {
  const reasons = new Set<DashboardPnlCoverageReason>();
  const affectedSections = new Set<DashboardPnlCoverageSection>();

  let pricedPositionsCount = 0;
  let unpricedPositionsCount = 0;
  let unsupportedPositionsCount = 0;
  let incompleteBasisPositionsCount = 0;
  let stalePricePositionsCount = 0;
  let sourceDisabledPositionsCount = 0;

  for (const position of args.tokenPositions) {
    if (position.pnl.status === "available") {
      pricedPositionsCount += 1;
    }

    const warningCodes = position.pnl.warnings.map((warning) => warning.code);
    const hasUnpricedPnl =
      position.pnl.status === "unavailable" ||
      warningCodes.includes("MARK_PRICE_UNAVAILABLE") ||
      position.pricing.status === "unavailable" ||
      position.pricing.status === "low_confidence_price";
    if (hasUnpricedPnl) {
      unpricedPositionsCount += 1;
      reasons.add("unpriced");
      affectedSections.add("tokens");
    }

    const hasIncompleteBasis =
      position.pnl.status === "incomplete_basis" ||
      warningCodes.includes("INSUFFICIENT_COST_BASIS") ||
      warningCodes.includes("COUNTER_ASSET_PRICE_UNAVAILABLE") ||
      warningCodes.includes("UNSUPPORTED_ACTION_GROUP");
    if (hasIncompleteBasis) {
      incompleteBasisPositionsCount += 1;
      reasons.add("insufficient_cost_basis");
      affectedSections.add("tokens");
    }

    if (position.pnl.status === "unsupported") {
      unsupportedPositionsCount += 1;
      reasons.add("unsupported_position_type");
      affectedSections.add("tokens");
    }

    const hasStalePrice =
      position.pnl.status === "stale_price" ||
      position.pricing.status === "stale_price" ||
      position.pricing.rejectedReasons.includes("STALE");
    if (hasStalePrice) {
      stalePricePositionsCount += 1;
      reasons.add("stale_price");
      affectedSections.add("tokens");
    }

    if (position.pricing.rejectedReasons.includes("SOURCE_DISABLED")) {
      sourceDisabledPositionsCount += 1;
      reasons.add("source_disabled");
      affectedSections.add("tokens");
    }
  }

  for (const position of args.lpPositions) {
    if (position.pnl.status === "unsupported") {
      unsupportedPositionsCount += 1;
      reasons.add("unsupported_position_type");
      affectedSections.add("lpPositions");
    }
  }

  for (const position of args.stakePositions) {
    if (position.pnl.status === "unsupported") {
      unsupportedPositionsCount += 1;
      reasons.add("unsupported_position_type");
      affectedSections.add("stakePositions");
    }
  }

  if (reasons.size > 0) {
    affectedSections.add("summary");
  }

  const totalPositions = args.tokenPositions.length + args.lpPositions.length + args.stakePositions.length;
  const affectedPositionsCount =
    unpricedPositionsCount +
    unsupportedPositionsCount +
    incompleteBasisPositionsCount +
    stalePricePositionsCount +
    sourceDisabledPositionsCount;

  const status: DashboardPnlCoverageDto["status"] =
    totalPositions === 0
      ? "unknown"
      : affectedPositionsCount === 0
        ? "valued"
        : unsupportedPositionsCount === totalPositions
          ? "unsupported"
          : pricedPositionsCount > 0
            ? "partial"
            : "unavailable";

  return {
    status,
    reasons: PNL_COVERAGE_REASON_ORDER.filter((reason) => reasons.has(reason)),
    affectedSections: PNL_COVERAGE_SECTION_ORDER.filter((section) => affectedSections.has(section)),
    pricedPositionsCount,
    unpricedPositionsCount,
    unsupportedPositionsCount,
    incompleteBasisPositionsCount,
    stalePricePositionsCount,
    sourceDisabledPositionsCount,
    asOf: args.asOf.toISOString(),
  };
}

function toMaterializationDto(
  tokenBalances: Awaited<ReturnType<DashboardDbClient["portfolioTokenBalance"]["findMany"]>>,
  materializationState: Awaited<
    ReturnType<NonNullable<DashboardDbClient["portfolioMaterializationState"]>["findUnique"]>
  >,
  asOf: Date,
): DashboardMaterializationDto {
  const negativeBalances = tokenBalances
    .filter((row) => isNegativeDecimal(toStringValue(row.balanceQuantity)))
    .map((row) => ({
      assetId: row.assetId,
      assetAddress: row.assetAddress,
      balanceQuantity: toStringValue(row.balanceQuantity),
      decimals: row.decimals,
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));

  const warnings = mergeMaterializationWarnings(
    normalizePersistedWarnings(materializationState?.warningDetails),
    negativeBalances.map((negativeBalance) => ({
      code: "negative_token_balance" as const,
      message: `Negative materialized token balance for ${negativeBalance.assetId}: ${negativeBalance.balanceQuantity}`,
    })),
  );

  return {
    status: materializationState?.status ?? null,
    completedSuccessfully: materializationState?.completedSuccessfully ?? null,
    lastAttemptedAt: materializationState?.lastAttemptedAt?.toISOString() ?? null,
    latestMaterializedAt: materializationState?.latestMaterializedAt?.toISOString() ?? null,
    updatedFromBlock: bigintToString(materializationState?.updatedFromBlock ?? null),
    updatedToBlock: bigintToString(materializationState?.updatedToBlock ?? null),
    sourceLedgerFromBlock: bigintToString(materializationState?.sourceLedgerFromBlock ?? null),
    sourceLedgerToBlock: bigintToString(materializationState?.sourceLedgerToBlock ?? null),
    warningCount: warnings.length,
    warnings,
    errorMessage: materializationState?.errorMessage ?? null,
    hasNegativeBalances: negativeBalances.length > 0,
    negativeBalances,
    freshness: computeMaterializationFreshness(materializationState, asOf),
  };
}

function computeMaterializationFreshness(
  materializationState: Awaited<
    ReturnType<NonNullable<DashboardDbClient["portfolioMaterializationState"]>["findUnique"]>
  >,
  now: Date,
): DashboardMaterializationFreshnessDto {
  if (!materializationState) {
    return {
      status: "unknown",
      reason: "No materialization record exists.",
      lastMaterializedAt: null,
      staleAfterSeconds: null,
    };
  }

  if (materializationState.status === "FAILED" && !materializationState.latestMaterializedAt) {
    return {
      status: "unknown",
      reason: materializationState.errorMessage
        ? `Materialization failed: ${materializationState.errorMessage}`
        : "Materialization failed with no prior successful run.",
      lastMaterializedAt: null,
      staleAfterSeconds: MATERIALIZATION_STALE_AFTER_SECONDS,
    };
  }

  const lastMaterializedAt = materializationState.latestMaterializedAt;
  if (!lastMaterializedAt) {
    return {
      status: "unknown",
      reason: "No successful materialization timestamp recorded.",
      lastMaterializedAt: null,
      staleAfterSeconds: MATERIALIZATION_STALE_AFTER_SECONDS,
    };
  }

  const ageSeconds = (now.getTime() - lastMaterializedAt.getTime()) / 1000;

  if (
    materializationState.status === "FAILED" &&
    ageSeconds > MATERIALIZATION_STALE_AFTER_SECONDS
  ) {
    return {
      status: "stale",
      reason: materializationState.errorMessage
        ? `Materialization failed: ${materializationState.errorMessage}`
        : "Materialization failed and last successful run is older than threshold.",
      lastMaterializedAt: lastMaterializedAt.toISOString(),
      staleAfterSeconds: MATERIALIZATION_STALE_AFTER_SECONDS,
    };
  }

  if (ageSeconds > MATERIALIZATION_STALE_AFTER_SECONDS) {
    return {
      status: "stale",
      reason: `Last materialization is older than ${MATERIALIZATION_STALE_AFTER_SECONDS} seconds.`,
      lastMaterializedAt: lastMaterializedAt.toISOString(),
      staleAfterSeconds: MATERIALIZATION_STALE_AFTER_SECONDS,
    };
  }

  return {
    status: "fresh",
    reason: null,
    lastMaterializedAt: lastMaterializedAt.toISOString(),
    staleAfterSeconds: MATERIALIZATION_STALE_AFTER_SECONDS,
  };
}

function computeLedgerCoverage(
  materializationState: Awaited<
    ReturnType<NonNullable<DashboardDbClient["portfolioMaterializationState"]>["findUnique"]>
  >,
): DashboardLedgerCoverageDto {
  if (!materializationState) {
    return {
      status: "unknown",
      fromBlock: null,
      toBlock: null,
      sourceFamilies: [],
      reason: "No materialization record exists.",
    };
  }

  const fromBlock = bigintToString(materializationState.sourceLedgerFromBlock);
  const toBlock = bigintToString(materializationState.sourceLedgerToBlock);

  if (fromBlock !== null && toBlock !== null) {
    return {
      status: "covered",
      fromBlock,
      toBlock,
      sourceFamilies: [],
      reason: null,
    };
  }

  if (fromBlock !== null || toBlock !== null) {
    return {
      status: "partial",
      fromBlock,
      toBlock,
      sourceFamilies: [],
      reason: "Only a partial block range is recorded in persisted materialization state.",
    };
  }

  return {
    status: "unknown",
    fromBlock: null,
    toBlock: null,
    sourceFamilies: [],
    reason: "No block range recorded in persisted materialization state.",
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

function normalizePersistedWarnings(value: unknown): DashboardMaterializationWarningDto[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap<DashboardMaterializationWarningDto>((item) => {
      if (typeof item !== "string") {
        return [];
      }

      if (item.startsWith("negative-token-balance:")) {
        const prefix = "negative-token-balance:";
        const remainder = item.slice(prefix.length);
        const separatorIndex = remainder.lastIndexOf(":");
        if (separatorIndex === -1) {
          return [];
        }

        const assetId = remainder.slice(0, separatorIndex);
        const balanceQuantity = remainder.slice(separatorIndex + 1);
        return [
          {
            code: "negative_token_balance",
            message: `Negative materialized token balance for ${assetId}: ${balanceQuantity}`,
          },
        ];
      }

      return [
        {
          code: "generic_persisted_warning",
          message: item,
        },
      ];
    })
    .sort((left, right) => left.message.localeCompare(right.message));
}

function mergeMaterializationWarnings(
  persistedWarnings: DashboardMaterializationWarningDto[],
  derivedWarnings: DashboardMaterializationWarningDto[],
) {
  const merged = new Map<string, DashboardMaterializationWarningDto>();
  for (const warning of [...persistedWarnings, ...derivedWarnings]) {
    merged.set(`${warning.code}:${warning.message}`, warning);
  }

  return Array.from(merged.values()).sort((left, right) => left.message.localeCompare(right.message));
}

function isNegativeDecimal(value: string) {
  return value.trim().startsWith("-") && value.trim() !== "-0" && value.trim() !== "-0.0";
}

function toOutput(value: Decimal | string) {
  const decimal = typeof value === "string" ? new Decimal(value) : value;
  return decimal.toFixed().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
