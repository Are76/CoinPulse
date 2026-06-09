import "server-only";

import { parseAbi, type PublicClient } from "viem";

import { PHEX_ADDRESS, PHEX_DECIMALS } from "@/config/assets";
import { Decimal } from "@/lib/decimal";
import type { EvidenceWithCanonicalPayload } from "@/services/hexmining/observation-evidence-provider";
import { PHEX_ASSET_ID } from "@/services/hexmining/types";
import type { HexStakeDto, HexStakeListDto, HexStakeStatus, HexStakeYieldDto } from "@/services/hexmining/types";
import { estimateHexMiningYield } from "@/services/hexmining/yield-estimator";
import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";

const PULSECHAIN_CHAIN_ID = 369;

const PHEX_READ_ABI = parseAbi([
  "function stakeCount(address stakerAddr) view returns (uint256)",
  "function stakeLists(address stakerAddr, uint256 stakeIndex) view returns (uint40 stakeId, uint72 stakedHearts, uint72 stakeShares, uint16 lockedDay, uint16 stakedDays, uint16 unlockedDay, bool isAutoStake)",
  "function currentDay() view returns (uint256)",
]);

export type HexMiningReadClient = Pick<PublicClient, "readContract" | "getBlockNumber">;

export type ReadNativeHexStakesArgs = {
  publicClient: HexMiningReadClient;
  walletAddress: string;
  chainId: number;
  asOf?: Date;
  fetchYieldEvidence?: (args: {
    chainId: number;
    rangeStartDay: number;
    rangeEndDay: number;
  }) => Promise<EvidenceWithCanonicalPayload | null>;
};

async function resolveYieldDto(
  fetchYieldEvidence: ReadNativeHexStakesArgs["fetchYieldEvidence"],
  stakeShares: bigint,
  lockedDay: number,
  stakedDays: number,
  stakeIdStr: string,
  chainId: number,
  currentDay: bigint | null,
): Promise<{ dto: HexStakeYieldDto; warnings: string[] }> {
  if (!fetchYieldEvidence) {
    return {
      dto: { status: "unsupported", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null },
      warnings: [],
    };
  }

  if (currentDay === null) {
    return {
      dto: { status: "unavailable", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null },
      warnings: ["hexmining-yield-unavailable-no-current-day"],
    };
  }

  // Pending stake: no elapsed days yet, yield is not calculable
  if (currentDay < BigInt(lockedDay)) {
    return {
      dto: { status: "unavailable", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null },
      warnings: [],
    };
  }

  const rangeStartDay = lockedDay;
  const rangeEndDay = Math.min(Number(currentDay), lockedDay + stakedDays - 1);

  const result = await estimateHexMiningYield(
    {
      chainId,
      stakeId: stakeIdStr,
      stakeShares,
      lockedDay,
      stakedDays,
      currentDay: Number(currentDay),
      rangeStartDay,
      rangeEndDay,
    },
    { fetchEvidence: fetchYieldEvidence },
  );

  if (result.status === "estimated") {
    return {
      dto: {
        status: "estimated",
        estimatedYieldHex: result.yieldHex,
        bpdYieldStatus: "unknown",
        bpdYieldHex: null,
      },
      warnings: result.warnings,
    };
  }

  return {
    dto: { status: "unavailable", estimatedYieldHex: null, bpdYieldHex: null, bpdYieldStatus: null },
    warnings: result.warnings,
  };
}

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

      const yieldData = await resolveYieldDto(
        args.fetchYieldEvidence,
        stakeShares,
        lockedDay,
        stakedDays,
        stakeId.toString(),
        PULSECHAIN_CHAIN_ID,
        currentDay,
      );

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
        yield: yieldData.dto,
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
        warnings: ["hexmining-valuation-unsupported-v1", ...yieldData.warnings],
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
