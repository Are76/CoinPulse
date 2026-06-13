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

import { fileURLToPath } from "url";

import { createPublicClient, http } from "viem";

import { PULSECHAIN_CHAIN } from "@/config/chains";
import type { HexMiningReadClient } from "@/services/hexmining/reader";
// Type-only import — erased at runtime. Does not load server-env or prisma-adapter.
import type { acquireAndPersistHexDailyDataObservation } from "@/services/hexmining/daily-data-observation-service";

// Avoids loading the service module (and transitively server-env/REDIS_URL)
// at import time. Matches DAILY_DATA_PAYLOAD_VERSION from the service.
const PAYLOAD_VERSION = "v1" as const;

const PULSECHAIN_CHAIN_ID = 369 as const;

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

// publicClient is extended with getChainId so the runner can verify the remote
// chain before persisting. The real viem PublicClient satisfies this shape.
export type ObservationFetchDeps = {
  publicClient: HexMiningReadClient & { getChainId(): Promise<number> };
  acquireAndPersist?: typeof acquireAndPersistHexDailyDataObservation;
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
      payloadVersion: typeof PAYLOAD_VERSION;
      warnings: string[];
    }
  | { ok: false; code: string; warnings: string[] };

export async function runHexMiningDailyDataObservationFetch(
  input: ObservationFetchInput,
  deps: ObservationFetchDeps,
): Promise<ObservationFetchResult> {
  // Verify the remote RPC endpoint is PulseChain before any persist operation.
  // viem's chain config does not prove the remote endpoint; getChainId() does.
  let remoteChainId: number;
  try {
    remoteChainId = await deps.publicClient.getChainId();
  } catch {
    return { ok: false, code: "chain-id-unavailable", warnings: ["chain-id-unavailable"] };
  }

  if (remoteChainId !== PULSECHAIN_CHAIN_ID) {
    return { ok: false, code: "wrong-chain", warnings: ["wrong-chain"] };
  }

  // Defer the env-dependent service import until after parseInput validation and
  // chain verification have both succeeded. The dynamic import loads server-env
  // (REDIS_URL) and prisma-adapter — importing the module must not do this.
  // When deps.acquireAndPersist is injected (e.g. in tests), the dynamic import
  // is never executed and no env-dependent modules are loaded.
  const acquireFn =
    deps.acquireAndPersist ??
    (await import("@/services/hexmining/daily-data-observation-service"))
      .acquireAndPersistHexDailyDataObservation;

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
    chainId: PULSECHAIN_CHAIN_ID,
    rangeStartDay: result.rangeStartDay,
    rangeEndDay: result.rangeEndDay,
    observedAtBlock: result.observedAtBlock,
    observedAt: result.observedAt,
    rpcEndpointLabel: input.rpcEndpointLabel,
    payloadVersion: PAYLOAD_VERSION,
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
  }) as unknown as ObservationFetchDeps["publicClient"];

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

// Run only when executed directly as CLI, not when imported by tests or tooling.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const errorType = err instanceof Error ? err.name : "UnknownError";
    console.error(`hexmining-dailydata-fetch error: ${errorType}`);
    process.exitCode = 1;
  });
}
