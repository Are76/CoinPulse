/**
 * Dev price seed — operator utility only.
 *
 * Fetches live on-chain spot prices for a small default asset set
 * (PLS, pHEX, pDAI) via the existing PulseX ingestion pipeline and
 * persists them as PriceObservation records. Designed for local dev only.
 *
 * Usage:
 *   DATABASE_URL='...' REDIS_URL='...' PULSECHAIN_RPC_URL='...' \
 *     npx tsx --conditions react-server scripts/seed-prices.ts
 *
 * Or via npm script (requires env vars in shell or .env.local):
 *   npm run prices:seed
 *
 * Required environment variables:
 *   DATABASE_URL        PostgreSQL connection string
 *   REDIS_URL           Redis connection string (required by server-env)
 *   PULSECHAIN_RPC_URL  PulseChain JSON-RPC HTTP endpoint
 *
 * The --conditions react-server flag is required because the ingestion
 * service uses the server-only guard, which is a no-op under that condition.
 *
 * Exit behaviour:
 *   - Exits 0 on full or partial success (prints JSON summary to stdout).
 *   - Exits 1 if environment is invalid or RPC is unreachable.
 *   - Never persists fabricated or hardcoded price values.
 *   - Never bypasses the existing pricing ingestion service.
 */

import { fileURLToPath } from "url";

import { createPublicClient, http, type PublicClient } from "viem";

import { PULSECHAIN_CHAIN, PULSECHAIN_REFERENCE } from "@/config/chains";
import type {
  PriceIngestAsset,
  PriceIngestionResult,
} from "@/services/pricing/price-ingestion";

// ─── Canonical asset set ───────────────────────────────────────────────────────

const PHEX_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39" as const;
const PDAI_ADDRESS = "0xefd766ccb38eaf1dfd701853bfce31359239f305" as const;
const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const QUOTE_ASSET = "fiat:usd" as const;

/**
 * Returns the default asset set to seed: PLS, pHEX, pDAI.
 *
 * Identity is always canonical assetId (chainId + tokenAddress).
 * No price values are included here — prices are derived by the
 * existing ingestion service via live on-chain PulseX pool reads.
 */
export function buildSeedAssets(): readonly PriceIngestAsset[] {
  return [
    {
      assetId: PULSECHAIN_REFERENCE.nativeAssetId,
      tokenAddress: NATIVE_ADDRESS,
      tokenDecimals: 18,
      quoteAsset: QUOTE_ASSET,
    },
    {
      assetId: `chain:${PULSECHAIN_REFERENCE.id}:erc20:${PHEX_ADDRESS}`,
      tokenAddress: PHEX_ADDRESS,
      tokenDecimals: 8,
      quoteAsset: QUOTE_ASSET,
    },
    {
      assetId: `chain:${PULSECHAIN_REFERENCE.id}:erc20:${PDAI_ADDRESS}`,
      tokenAddress: PDAI_ADDRESS,
      tokenDecimals: 18,
      quoteAsset: QUOTE_ASSET,
    },
  ] as const;
}

// ─── Env validation ────────────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = ["DATABASE_URL", "REDIS_URL", "PULSECHAIN_RPC_URL"] as const;

export type EnvCheckResult =
  | { ok: true }
  | { ok: false; missing: readonly string[] };

export function checkEnv(env: Record<string, string | undefined>): EnvCheckResult {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── Core seed logic ───────────────────────────────────────────────────────────

type IngestionArgs = {
  chainId: number;
  blockNumber: bigint;
  observedAt: Date;
  assets: readonly PriceIngestAsset[];
};

export type SeedPricesDeps = {
  publicClient: PublicClient;
  runIngestion?: (args: IngestionArgs) => Promise<PriceIngestionResult>;
};

export type SeedPricesResult =
  | { ok: true; result: PriceIngestionResult }
  | { ok: false; code: string; detail: string };

export async function runDevPriceSeed(
  deps: SeedPricesDeps,
): Promise<SeedPricesResult> {
  let blockNumber: bigint;
  try {
    blockNumber = await deps.publicClient.getBlockNumber();
  } catch (err) {
    return {
      ok: false,
      code: "rpc-unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const observedAt = new Date();
  const assets = buildSeedAssets();

  // Defer the server-only service import until after env validation and RPC
  // verification have both passed. When deps.runIngestion is injected (e.g.
  // in tests), the dynamic import is never executed.
  const ingestionFn: (args: IngestionArgs) => Promise<PriceIngestionResult> =
    deps.runIngestion ??
    (async (args) => {
      const { runPriceIngestion } = await import(
        "@/services/pricing/price-ingestion"
      );
      return runPriceIngestion(args, { publicClient: deps.publicClient });
    });

  try {
    const result = await ingestionFn({
      chainId: PULSECHAIN_REFERENCE.id,
      blockNumber,
      observedAt,
      assets,
    });
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      code: "ingestion-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

async function main(): Promise<void> {
  const envCheck = checkEnv(process.env as Record<string, string | undefined>);
  if (!envCheck.ok) {
    console.error(
      `seed-prices: missing required environment variables: ${envCheck.missing.join(", ")}`,
    );
    console.error(
      "See .env.example for setup guidance. Run `npm run validate:env` to check all vars.",
    );
    process.exitCode = 1;
    return;
  }

  const rpcUrl = process.env["PULSECHAIN_RPC_URL"] as string;

  const publicClient = createPublicClient({
    chain: PULSECHAIN_CHAIN,
    transport: http(rpcUrl),
  });

  const result = await runDevPriceSeed({ publicClient });

  if (!result.ok) {
    console.error(`seed-prices: ${result.code} — ${result.detail}`);
    console.error(
      "Prices were not persisted. Check PULSECHAIN_RPC_URL and try again.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(safeStringify(result.result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`seed-prices error: ${message}`);
    process.exitCode = 1;
  });
}
