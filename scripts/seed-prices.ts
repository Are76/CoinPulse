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
 *   - Exits 1 if environment is invalid, RPC is unreachable, wrong chain,
 *     or zero prices were fetched.
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

// ─── RPC error sanitizer ───────────────────────────────────────────────────────

/**
 * Strips the RPC URL and any embedded credentials or API keys from an error
 * message so they are never written to stderr or structured error fields.
 */
export function sanitizeRpcError(rpcUrl: string, message: string): string {
  if (!rpcUrl) return message;
  let sanitized = message;
  // Replace the full URL first — covers the most common case.
  sanitized = sanitized.split(rpcUrl).join("[RPC_URL]");
  try {
    const parsed = new URL(rpcUrl);
    // Strip username and password individually.
    if (parsed.username) {
      sanitized = sanitized.split(decodeURIComponent(parsed.username)).join("[REDACTED]");
      sanitized = sanitized.split(parsed.username).join("[REDACTED]");
    }
    if (parsed.password) {
      sanitized = sanitized.split(decodeURIComponent(parsed.password)).join("[REDACTED]");
      sanitized = sanitized.split(parsed.password).join("[REDACTED]");
    }
    // Strip each query-param value (API keys, tokens, etc.).
    parsed.searchParams.forEach((value) => {
      if (value) {
        sanitized = sanitized.split(decodeURIComponent(value)).join("[REDACTED]");
        sanitized = sanitized.split(value).join("[REDACTED]");
      }
    });
    // Also strip the credential-bearing URL variant (with auth but without query).
    if (parsed.username || parsed.password) {
      const withCreds = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.host}${parsed.pathname}`;
      sanitized = sanitized.split(withCreds).join("[RPC_URL]");
    }
  } catch {
    // URL parse failed — full-URL replacement above is the best we can do.
  }
  return sanitized;
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
  /** RPC URL string used only for error sanitization — never used for requests. */
  rpcUrl?: string;
  runIngestion?: (args: IngestionArgs) => Promise<PriceIngestionResult>;
};

export type SeedPricesResult =
  | { ok: true; result: PriceIngestionResult }
  | { ok: false; code: string; detail: string };

export async function runDevPriceSeed(
  deps: SeedPricesDeps,
): Promise<SeedPricesResult> {
  const sanitize = (msg: string) => sanitizeRpcError(deps.rpcUrl ?? "", msg);

  // Verify the RPC endpoint is PulseChain (chainId 369) before doing anything.
  let chainId: number;
  try {
    chainId = await deps.publicClient.getChainId();
  } catch (err) {
    return {
      ok: false,
      code: "rpc-unavailable",
      detail: sanitize(err instanceof Error ? err.message : String(err)),
    };
  }

  if (chainId !== PULSECHAIN_REFERENCE.id) {
    return {
      ok: false,
      code: "wrong-chain",
      detail: `Expected chainId ${PULSECHAIN_REFERENCE.id} (PulseChain) but RPC reported chainId ${chainId}`,
    };
  }

  let blockNumber: bigint;
  try {
    blockNumber = await deps.publicClient.getBlockNumber();
  } catch (err) {
    return {
      ok: false,
      code: "rpc-unavailable",
      detail: sanitize(err instanceof Error ? err.message : String(err)),
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
      detail: sanitize(err instanceof Error ? err.message : String(err)),
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

  let result: SeedPricesResult;
  try {
    result = await runDevPriceSeed({ publicClient, rpcUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`seed-prices error: ${sanitizeRpcError(rpcUrl, message)}`);
    process.exitCode = 1;
    return;
  }

  if (!result.ok) {
    console.error(`seed-prices: ${result.code} — ${result.detail}`);
    if (result.code === "wrong-chain") {
      console.error("Prices were not persisted. Verify PULSECHAIN_RPC_URL points to PulseChain (chainId 369).");
    } else {
      console.error(
        "Prices were not persisted. Check PULSECHAIN_RPC_URL and try again.",
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(safeStringify(result.result));

  if (result.result.fetchedCount === 0) {
    console.error(
      "seed-prices: no prices were fetched or persisted. Check RPC connectivity and try again.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`seed-prices error: ${message}`);
    process.exitCode = 1;
  });
}
