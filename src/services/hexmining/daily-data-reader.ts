import "server-only";

import { parseAbi } from "viem";

import { PHEX_ADDRESS } from "@/config/assets";
import type { HexMiningReadClient } from "@/services/hexmining/reader";
import { classifyRpcFailure } from "@/services/rpc/rpc-failure-taxonomy";

const PULSECHAIN_CHAIN_ID = 369;

// Narrow ABI for the daily data reads used by this isolated module only.
const PHEX_DAILY_DATA_ABI = parseAbi([
  "function currentDay() view returns (uint256)",
  "function dailyDataRange(uint256 beginDay, uint256 endDay) view returns (uint256[] list)",
]);

// ─── currentDay read ──────────────────────────────────────────────────────────

export type ReadCurrentDayResult =
  | { ok: true; currentDay: number }
  | { ok: false; code: string };

export async function readCurrentDay(args: {
  publicClient: HexMiningReadClient;
}): Promise<ReadCurrentDayResult> {
  try {
    const day = (await args.publicClient.readContract({
      address: PHEX_ADDRESS as `0x${string}`,
      abi: PHEX_DAILY_DATA_ABI,
      functionName: "currentDay",
    })) as bigint;
    return { ok: true, currentDay: Number(day) };
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    return { ok: false, code: `hexmining-current-day-rpc-${failure.code}` };
  }
}

// ─── dailyDataRange read boundary ─────────────────────────────────────────────

export type DailyDataObservation = {
  chainId: number;
  rangeStartDay: number;
  // Inclusive stored bound — matches the rangeStartDay/rangeEndDay fields in
  // RawHexDailyDataObservation. This is the human-readable day range.
  rangeEndDay: number;
  // End-exclusive RPC argument = rangeEndDay + 1.
  // dailyDataRange(beginDay, endDay) returns data for days [beginDay, endDay).
  // The stored rangeEndDay is inclusive; adding 1 converts it for the contract call.
  rpcEndDay: number;
  observedAtBlock: bigint;
  observedAt: Date;
  rpcEndpointLabel: string | null;
  // Raw viem bigint array from dailyDataRange. Each element is a uint256 packed
  // daily data value. Bigint-safe canonical encoding (§11.8) is applied at the
  // persistence boundary — this module returns the raw viem shape only.
  rawDailyData: readonly bigint[];
  warnings: string[];
};

export type ReadDailyDataRangeResult =
  | { ok: true; currentDay: number; observation: DailyDataObservation }
  | { ok: false; code: string; warnings: string[] };

export type ReadDailyDataRangeArgs = {
  publicClient: HexMiningReadClient;
  // Inclusive stored day range — matches rangeStartDay/rangeEndDay in
  // RawHexDailyDataObservation. The end-exclusive RPC argument is derived
  // internally as rangeEndDay + 1.
  rangeStartDay: number;
  rangeEndDay: number;
  rpcEndpointLabel?: string | null;
  asOf?: Date;
};

/**
 * Reads raw dailyDataRange data from the pHEX contract on PulseChain (chainId 369).
 *
 * Accepts inclusive stored day bounds (rangeStartDay, rangeEndDay) and converts
 * to the end-exclusive contract argument internally:
 *   contract call → dailyDataRange(rangeStartDay, rangeEndDay + 1)
 *
 * Returns the raw viem bigint array without persistence or encoding. The caller
 * is responsible for canonical payload encoding and persistence (Phase 4B wiring PR).
 */
export async function readDailyDataRangeObservation(
  args: ReadDailyDataRangeArgs,
): Promise<ReadDailyDataRangeResult> {
  const { rangeStartDay, rangeEndDay } = args;

  if (rangeStartDay < 0) {
    return {
      ok: false,
      code: "hexmining-invalid-range-negative-start",
      warnings: ["hexmining-invalid-range-negative-start"],
    };
  }
  if (rangeEndDay < 0) {
    return {
      ok: false,
      code: "hexmining-invalid-range-negative-end",
      warnings: ["hexmining-invalid-range-negative-end"],
    };
  }
  if (rangeEndDay < rangeStartDay) {
    return {
      ok: false,
      code: "hexmining-invalid-range-end-before-start",
      warnings: ["hexmining-invalid-range-end-before-start"],
    };
  }

  // Read currentDay first. rangeEndDay must not exceed the current protocol day
  // because future days have no dailyDataRange data (§11.12 AC 7).
  const currentDayResult = await readCurrentDay({ publicClient: args.publicClient });
  if (!currentDayResult.ok) {
    return {
      ok: false,
      code: currentDayResult.code,
      warnings: [currentDayResult.code],
    };
  }
  const { currentDay } = currentDayResult;

  if (rangeEndDay > currentDay) {
    const code = "hexmining-range-exceeds-current-day";
    return { ok: false, code, warnings: [code] };
  }

  const warnings: string[] = [];
  const observedAt = args.asOf ?? new Date();
  const rpcEndpointLabel = args.rpcEndpointLabel ?? null;

  let observedAtBlock: bigint;
  try {
    observedAtBlock = await args.publicClient.getBlockNumber();
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    const code = `hexmining-block-number-rpc-${failure.code}`;
    return { ok: false, code, warnings: [code] };
  }

  // dailyDataRange(beginDay, endDay) is end-exclusive: returns data for days [beginDay, endDay).
  // The stored rangeEndDay is the inclusive last day. Add 1 for the end-exclusive contract arg.
  const rpcEndDay = rangeEndDay + 1;

  let rawDailyData: readonly bigint[];
  try {
    rawDailyData = (await args.publicClient.readContract({
      address: PHEX_ADDRESS as `0x${string}`,
      abi: PHEX_DAILY_DATA_ABI,
      functionName: "dailyDataRange",
      args: [BigInt(rangeStartDay), BigInt(rpcEndDay)],
    })) as bigint[];
  } catch (error) {
    const failure = classifyRpcFailure({ error });
    const code = `hexmining-daily-data-range-rpc-${failure.code}`;
    return { ok: false, code, warnings: [code] };
  }

  return {
    ok: true,
    currentDay,
    observation: {
      chainId: PULSECHAIN_CHAIN_ID,
      rangeStartDay,
      rangeEndDay,
      rpcEndDay,
      observedAtBlock,
      observedAt,
      rpcEndpointLabel,
      rawDailyData,
      warnings,
    },
  };
}
