import "server-only";

import { parseAbi, type PublicClient } from "viem";

import { PHEX_ADDRESS, PHEX_DECIMALS } from "@/config/assets";
import { Decimal } from "@/lib/decimal";
import { PHEX_ASSET_ID } from "@/services/hexmining/types";
import type {
  HexBpdYieldStatus,
  HexStakeDto,
  HexStakeListDto,
  HexStakeStatus,
  HexStakeYieldDto,
  HexStakeYieldProvenance,
} from "@/services/hexmining/types";
import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";
import type { HexMiningYieldEstimateResult } from "@/services/hexmining/yield-estimator";

const PULSECHAIN_CHAIN_ID = 369;
const HEX_BPD_DAY = 353;

const PHEX_READ_ABI = parseAbi([
  "function stakeCount(address stakerAddr) view returns (uint256)",
  "function stakeLists(address stakerAddr, uint256 stakeIndex) view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)",
  "function currentDay() view returns (uint256)",
]);

export type HexMiningReadClient = Pick<PublicClient, "readContract" | "getBlockNumber">;

// Injectable yield estimator dep — accepts per-stake args and returns a yield estimate.
// chainId is always 369 at this call site (chain guard has already run).
export type EstimateYieldDep = (args: {
  chainId: number;
  stakeId: string;
  stakeShares: bigint;
  lockedDay: number;
  stakedDays: number;
  currentDay: number;
  rangeStartDay: number;
  rangeEndDay: number;
}) => Promise<HexMiningYieldEstimateResult>;

export type ReadNativeHexStakesArgs = {
  publicClient: HexMiningReadClient;
  walletAddress: string;
  chainId: number;
  asOf?: Date;
  // When provided, the reader calls this for each stake and assembles HexStakeYieldDto.
  // When absent, yield remains status: "unsupported" (gate not wired).
  estimateYield?: EstimateYieldDep;
};

export async function readNativeHexStakes(args: ReadNativeHexStakesArgs): Promise<HexStakeListDto> {
  const observedAt = (args.asOf ?? new Date()).toISOString();
  const walletAddress = args.walletAddress.toLowerCase();
  const listWarnings: string[] = [];

  if (args.chainId !== PULSECHAIN_CHAIN_ID) {
    return {
      schemaVersion: "v1",
      chainId: args.chainId,
      walletAddress,
      stakeSource: "native",
      stakes: [],
      totalCount: 0,
      isComplete: false,
      observedAtBlock: null,
      observedAt,
      warnings: [`hexmining-unsupported-chain-${args.chainId}`],
    };
  }

  let observedAtBlock: string | null = null;

  try {
    const blockNumber = await args.publicClient.getBlockNumber();
    observedAtBlock = blockNumber.toString();
  } catch {
    listWarnings.push("hexmining-provenance-block-unavailable");
  }

  let stakeCount: bigint;

  try {
    stakeCount = (await args.publicClient.readContract({
      address: PHEX_ADDRESS as `0x${string}`,
      abi: PHEX_READ_ABI,
      functionName: "stakeCount",
      args: [walletAddress as `0x${string}`],
    })) as bigint;
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    listWarnings.push(`hexmining-stake-count-rpc-${failure.code}`);
    return {
      schemaVersion: "v1",
      chainId: PULSECHAIN_CHAIN_ID,
      walletAddress,
      stakeSource: "native",
      stakes: [],
      totalCount: 0,
      isComplete: false,
      observedAtBlock,
      observedAt,
      warnings: listWarnings,
    };
  }

  if (stakeCount === 0n) {
    return {
      schemaVersion: "v1",
      chainId: PULSECHAIN_CHAIN_ID,
      walletAddress,
      stakeSource: "native",
      stakes: [],
      totalCount: 0,
      isComplete: true,
      observedAtBlock,
      observedAt,
      warnings: listWarnings,
    };
  }

  let currentDay: bigint | null = null;

  try {
    currentDay = (await args.publicClient.readContract({
      address: PHEX_ADDRESS as `0x${string}`,
      abi: PHEX_READ_ABI,
      functionName: "currentDay",
    })) as bigint;
  } catch {
    listWarnings.push("hexmining-current-day-unavailable");
  }

  const stakes: HexStakeDto[] = [];
  let isComplete = true;

  for (let index = 0n; index < stakeCount; index += 1n) {
    try {
      const raw = (await args.publicClient.readContract({
        address: PHEX_ADDRESS as `0x${string}`,
        abi: PHEX_READ_ABI,
        functionName: "stakeLists",
        args: [walletAddress as `0x${string}`, index],
      })) as readonly [number, bigint, bigint, number, number, number, boolean];

      const stakeId = raw[0];
      const stakedHearts = raw[1];
      const stakeShares = raw[2];
      const lockedDay = Number(raw[3]);
      const stakedDays = Number(raw[4]);
      const unlockedDayRaw = Number(raw[5]);
      const isAutoStake = raw[6];

      const yieldDto = await assembleYield({
        estimateYield: args.estimateYield,
        chainId: PULSECHAIN_CHAIN_ID,
        stakeId: stakeId.toString(),
        stakeShares,
        lockedDay,
        stakedDays,
        currentDay,
      });

      stakes.push({
        schemaVersion: "v1",
        stakeId: stakeId.toString(),
        stakeIndex: Number(index),
        stakeSource: "native",
        chainId: PULSECHAIN_CHAIN_ID,
        assetId: PHEX_ASSET_ID,
        walletAddress,
        stakeStatus: deriveStakeStatus(currentDay, lockedDay, stakedDays),
        lockedDay,
        stakedDays,
        unlockedDay: unlockedDayRaw === 0 ? null : unlockedDayRaw,
        principalHex: scalePrincipalHex(stakedHearts),
        stakeShares: stakeShares.toString(),
        tShares: scaleTShares(stakeShares),
        isAutoStake,
        pricing: { status: "unsupported", sourceType: null, sourceId: null, observedAt: null },
        valuation: { status: "unsupported", valueQuote: null },
        pnl: {
          status: "unsupported",
          averageCost: null,
          realizedPnl: null,
          unrealizedPnl: null,
          markPrice: null,
          costBasisPolicy: null,
        },
        yield: yieldDto,
        provenance: {
          chainId: PULSECHAIN_CHAIN_ID,
          walletAddress,
          stakeId: stakeId.toString(),
          stakeIndex: Number(index),
          stakeSource: "native",
          observedAtBlock: observedAtBlock ?? "unknown",
          observedAt,
          rpcEndpoint: null,
          warnings: [],
        },
        warnings: ["hexmining-valuation-unsupported-v1"],
      });
    } catch {
      isComplete = false;
      listWarnings.push(`hexmining-read-failed-stake-at-index-${Number(index)}`);
    }
  }

  return {
    schemaVersion: "v1",
    chainId: PULSECHAIN_CHAIN_ID,
    walletAddress,
    stakeSource: "native",
    stakes,
    totalCount: stakes.length,
    isComplete,
    observedAtBlock,
    observedAt,
    warnings: listWarnings,
  };
}

// ─── Yield assembly ───────────────────────────────────────────────────────────

type AssembleYieldArgs = {
  estimateYield: EstimateYieldDep | undefined;
  chainId: number;
  stakeId: string;
  stakeShares: bigint;
  lockedDay: number;
  stakedDays: number;
  currentDay: bigint | null;
};

async function assembleYield(args: AssembleYieldArgs): Promise<HexStakeYieldDto> {
  if (!args.estimateYield) {
    return { status: "unsupported", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null, provenance: null, warnings: [] };
  }

  if (args.currentDay === null) {
    const bpdStatus = deriveBpdYieldStatus(args.lockedDay, args.stakedDays, []);
    return {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldStatus: bpdStatus === "applicable" ? "unknown" : bpdStatus,
      bpdYieldHex: null,
      provenance: null,
      warnings: ["hexmining-current-day-unavailable"],
    };
  }

  const currentDayNum = Number(args.currentDay);

  // Pending stakes have no elapsed days — avoid passing an inverted range to the evidence provider.
  if (currentDayNum <= args.lockedDay) {
    const bpdStatus = deriveBpdYieldStatus(args.lockedDay, args.stakedDays, []);
    return {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldStatus: bpdStatus === "applicable" ? "unknown" : bpdStatus,
      bpdYieldHex: null,
      provenance: null,
      warnings: ["hexmining-yield-no-elapsed-days"],
    };
  }

  const elapsedEndDay = Math.min(currentDayNum - 1, args.lockedDay + args.stakedDays - 1);

  let result: HexMiningYieldEstimateResult;
  try {
    result = await args.estimateYield({
      chainId: args.chainId,
      stakeId: args.stakeId,
      stakeShares: args.stakeShares,
      lockedDay: args.lockedDay,
      stakedDays: args.stakedDays,
      currentDay: currentDayNum,
      rangeStartDay: args.lockedDay,
      rangeEndDay: elapsedEndDay,
    });
  } catch {
    const bpdStatus = deriveBpdYieldStatus(args.lockedDay, args.stakedDays, []);
    return {
      status: "unavailable",
      estimatedYieldHex: null,
      bpdYieldStatus: bpdStatus === "applicable" ? "unknown" : bpdStatus,
      bpdYieldHex: null,
      provenance: null,
      warnings: ["hexmining-yield-estimator-threw"],
    };
  }

  return mapEstimateToYieldDto(result, args.lockedDay, args.stakedDays);
}

function mapEstimateToYieldDto(
  result: HexMiningYieldEstimateResult,
  lockedDay: number,
  stakedDays: number,
): HexStakeYieldDto {
  if (result.status === "unsupported") {
    return { status: "unsupported", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null, provenance: null, warnings: [] };
  }

  if (result.status === "estimated") {
    const bpdStatus = deriveBpdYieldStatus(lockedDay, stakedDays, result.warnings);
    const provenance = assembleYieldProvenance(result.provenance);
    if (provenance === null) {
      return {
        status: "unavailable",
        estimatedYieldHex: null,
        bpdYieldStatus: bpdStatus === "applicable" ? "unknown" : bpdStatus,
        bpdYieldHex: null,
        provenance: null,
        warnings: [...result.warnings, "hexmining-yield-estimated-missing-provenance"],
      };
    }
    if (bpdStatus === "applicable" && result.bpdYieldHex !== null) {
      return {
        status: "estimated",
        estimatedYieldHex: result.yieldHex,
        bpdYieldStatus: "applicable",
        bpdYieldHex: result.bpdYieldHex,
        provenance,
        warnings: result.warnings,
      };
    }
    return {
      status: "estimated",
      estimatedYieldHex: result.yieldHex,
      bpdYieldStatus: bpdStatus === "applicable" ? "unknown" : bpdStatus,
      bpdYieldHex: null,
      provenance,
      warnings: result.warnings,
    };
  }

  // evidence_available, insufficient_observations, invalid_observation, unavailable
  // all map to the public "unavailable" status.
  // Normalize "applicable" → "unknown": unavailable yields never carry a concrete bpdYieldHex.
  const bpdStatus = deriveBpdYieldStatus(lockedDay, stakedDays, result.warnings);
  return {
    status: "unavailable",
    estimatedYieldHex: null,
    bpdYieldStatus: bpdStatus === "applicable" ? "unknown" : bpdStatus,
    bpdYieldHex: null,
    provenance: assembleYieldProvenance(result.provenance),
    warnings: result.warnings,
  };
}

function deriveBpdYieldStatus(
  lockedDay: number,
  stakedDays: number,
  warnings: string[],
): HexBpdYieldStatus {
  if (warnings.includes("hexmining-yield-bpd-attribution-unresolved")) return "unknown";
  if (lockedDay <= HEX_BPD_DAY && lockedDay + stakedDays > HEX_BPD_DAY) return "applicable";
  return "not_applicable";
}

function assembleYieldProvenance(
  estimatorProvenance: HexMiningYieldEstimateResult["provenance"],
): HexStakeYieldProvenance | null {
  if (
    estimatorProvenance.observationId === null ||
    estimatorProvenance.rangeStartDay === null ||
    estimatorProvenance.rangeEndDay === null
  ) {
    return null;
  }
  return {
    chainId: estimatorProvenance.chainId,
    sourceFamily: estimatorProvenance.sourceFamily,
    observationId: estimatorProvenance.observationId,
    rangeStartDay: estimatorProvenance.rangeStartDay,
    rangeEndDay: estimatorProvenance.rangeEndDay,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveStakeStatus(
  currentDay: bigint | null,
  lockedDay: number,
  stakedDays: number,
): HexStakeStatus {
  if (currentDay === null) return "unknown";
  const locked = BigInt(lockedDay);
  const staked = BigInt(stakedDays);
  if (locked > currentDay) return "pending";
  if (currentDay >= locked + staked) return "overdue";
  return "active";
}

function scalePrincipalHex(stakedHearts: bigint): string {
  return new Decimal(stakedHearts.toString())
    .div(new Decimal(10).pow(PHEX_DECIMALS))
    .toFixed(PHEX_DECIMALS);
}

function scaleTShares(stakeShares: bigint): string {
  return new Decimal(stakeShares.toString())
    .div(new Decimal("1000000000000"))
    .toDecimalPlaces(6)
    .toString();
}
