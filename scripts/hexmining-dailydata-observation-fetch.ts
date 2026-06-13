/**
 * HexMining dailyData observation fetch — operator utility only.
 *
 * Fetches and persists one raw HexMining dailyData observation for Gate 10
 * preparation. Does not execute Gate 10 verification, does not select
 * stakeShares, does not lift any verification gate.
 *
 * Usage:
 *   DATABASE_URL='...' npx tsx --conditions react-server \
 *     scripts/hexmining-dailydata-observation-fetch.ts \
 *     --rangeStartDay <day> \
 *     --rangeEndDay <day> \
 *     --rpcEndpointLabel <label> \
 *     --rpcUrl <url>
 *
 * The --conditions react-server flag is required because the observation
 * service uses the server-only guard, which resolves to a no-op only under
 * the react-server export condition.
 *
 * Output: sanitized JSON to stdout (no canonicalPayload, no rpcUrl,
 * no credentials).
 *
 * This script does NOT lift Gate 10. It is an operator tool for evidence
 * collection only.
 */

import { createPublicClient, http } from "viem";

import { PULSECHAIN_CHAIN } from "@/config/chains";
import type { HexMiningReadClient } from "@/services/hexmining/reader";
import {
  acquireAndPersistHexDailyDataObservation,
  DAILY_DATA_PAYLOAD_VERSION,
  type AcquireAndPersistHexDailyDataResult,
} from "@/services/hexmining/daily-data-observation-service";

// ─── parseInput ───────────────────────────────────────────────────────────────

export type ParsedInput = {
  rangeStartDay: number;
  rangeEndDay: number;
  rpcEndpointLabel: string;
  rpcUrl: string;
};

export type ParseResult = { ok: true; input: ParsedInput } | { ok: false; error: string };

export function parseInput(
  argv: string[],
  env: Record<string, string | undefined>,
): ParseResult {
  if (!env["DATABASE_URL"]) {
    return { ok: false, error: "DATABASE_URL environment variable is required" };
  }

  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) continue;

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      return { ok: false, error: `${flag} requires a value` };
    }

    args[flag.slice(2)] = value;
    i += 1;
  }

  const { rangeStartDay: startStr, rangeEndDay: endStr, rpcEndpointLabel, rpcUrl } = args;

  if (!startStr) return { ok: false, error: "--rangeStartDay is required" };
  if (!endStr) return { ok: false, error: "--rangeEndDay is required" };
  if (!rpcEndpointLabel) return { ok: false, error: "--rpcEndpointLabel is required" };
  if (!rpcUrl) return { ok: false, error: "--rpcUrl is required" };

  const startDay = Number(startStr);
  const endDay = Number(endStr);

  if (!Number.isInteger(startDay) || startDay < 0) {
    return {
      ok: false,
      error: `--rangeStartDay must be a non-negative integer, got: ${startStr}`,
    };
  }
  if (!Number.isInteger(endDay) || endDay < 0) {
    return {
      ok: false,
      error: `--rangeEndDay must be a non-negative integer, got: ${endStr}`,
    };
  }
  if (endDay < startDay) {
    return {
      ok: false,
      error: `--rangeEndDay (${endDay}) must be >= --rangeStartDay (${startDay})`,
    };
  }

  return {
    ok: true,
    input: { rangeStartDay: startDay, rangeEndDay: endDay, rpcEndpointLabel, rpcUrl },
  };
}

// ─── runHexMiningDailyDataObservationFetch ────────────────────────────────────

export type ObservationFetchInput = {
  rangeStartDay: number;
  rangeEndDay: number;
  rpcEndpointLabel: string;
};

export type ObservationFetchDeps = {
  publicClient: HexMiningReadClient;
  acquireAndPersist?: (
    args: Parameters<typeof acquireAndPersistHexDailyDataObservation>[0],
    deps?: Parameters<typeof acquireAndPersistHexDailyDataObservation>[1],
  ) => Promise<AcquireAndPersistHexDailyDataResult>;
};

export type ObservationFetchResult =
  | {
      ok: true;
      status: "persisted";
      observationId: string;
      chainId: 369;
      rangeStartDay: number;
      rangeEndDay: number;
      observedAtBlock: string;
      observedAt: string;
      rpcEndpointLabel: string;
      payloadVersion: typeof DAILY_DATA_PAYLOAD_VERSION;
      warnings: string[];
    }
  | { ok: false; code: string; warnings: string[] };

export async function runHexMiningDailyDataObservationFetch(
  input: ObservationFetchInput,
  deps: ObservationFetchDeps,
): Promise<ObservationFetchResult> {
  const acquireFn = deps.acquireAndPersist ?? acquireAndPersistHexDailyDataObservation;

  const result = await acquireFn({
    publicClient: deps.publicClient,
    rangeStartDay: input.rangeStartDay,
    rangeEndDay: input.rangeEndDay,
    rpcEndpointLabel: input.rpcEndpointLabel,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, warnings: result.warnings };
  }

  return {
    ok: true,
    status: "persisted",
    observationId: result.observationId,
    chainId: 369,
    rangeStartDay: result.rangeStartDay,
    rangeEndDay: result.rangeEndDay,
    observedAtBlock: result.observedAtBlock,
    observedAt: result.observedAt,
    rpcEndpointLabel: input.rpcEndpointLabel,
    payloadVersion: DAILY_DATA_PAYLOAD_VERSION,
    warnings: result.warnings,
  };
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function main(): Promise<void> {
  const parsed = parseInput(
    process.argv.slice(2),
    process.env as Record<string, string | undefined>,
  );
  if (!parsed.ok) {
    console.error(`hexmining-dailydata-fetch: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }

  const { rangeStartDay, rangeEndDay, rpcEndpointLabel, rpcUrl } = parsed.input;

  const publicClient = createPublicClient({
    chain: PULSECHAIN_CHAIN,
    transport: http(rpcUrl),
  }) as unknown as HexMiningReadClient;

  const result = await runHexMiningDailyDataObservationFetch(
    { rangeStartDay, rangeEndDay, rpcEndpointLabel },
    { publicClient },
  );

  if (!result.ok) {
    console.error(`hexmining-dailydata-fetch: ${result.code}`, safeStringify(result));
    process.exitCode = 1;
    return;
  }

  console.log(safeStringify(result));
}

main().catch((err) => {
  const errorType = err instanceof Error ? err.name : "UnknownError";
  console.error(`hexmining-dailydata-fetch error: ${errorType}`);
  process.exitCode = 1;
});
