/**
 * HexMining HSI live verification — operator utility only.
 *
 * Drives the shipped HSI pipeline (discovery → observation persistence → reader
 * enrichment) against a known PulseChain HSI and prints a factual verification
 * report. It adds NO product functionality, changes NO discovery/reader/
 * persistence logic, and performs NO pricing, valuation, yield, or ROI math.
 *
 * Usage:
 *   DATABASE_URL='...' PULSECHAIN_RPC_URL='https://...' \
 *     npx tsx --conditions react-server \
 *     scripts/hexmining-hsi-live-verification.ts \
 *     --wallet <0x...> \
 *     --hsiManager <0x...> \
 *     --tokenId <decimal> \
 *     [--rpcUrl <url>]        # overrides PULSECHAIN_RPC_URL
 *
 * The --conditions react-server flag is required because the pipeline services
 * use the server-only guard, which resolves to a no-op only under the
 * react-server export condition.
 *
 * Output: JSON verification report to stdout (no credentials, no rpcUrl).
 * Exit code is 0 only when every check passes; 1 otherwise.
 *
 * This script does NOT lift any gate, expose any DTO, or persist anything beyond
 * what discovery/enrichment already persist. It is an operator evidence tool.
 */

import { fileURLToPath } from "url";

import { createPublicClient, http } from "viem";

import { PULSECHAIN_CHAIN } from "@/config/chains";
import type {
  HsiLiveVerificationDeps,
  HsiLiveVerificationInput,
} from "@/services/hexmining/hsi-live-verification-runner";

const PULSECHAIN_CHAIN_ID = 369 as const;

const DECIMAL_UINT_RE = /^(0|[1-9]\d*)$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type ParsedInput = {
  wallet: string;
  hsiManager: string;
  tokenId: string;
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

  const { wallet, hsiManager, tokenId } = args;
  const rpcUrl = args["rpcUrl"] ?? env["PULSECHAIN_RPC_URL"];

  if (!wallet) return { ok: false, error: "--wallet is required" };
  if (!hsiManager) return { ok: false, error: "--hsiManager is required" };
  if (!tokenId) return { ok: false, error: "--tokenId is required" };
  if (!rpcUrl) {
    return {
      ok: false,
      error: "PULSECHAIN_RPC_URL (or --rpcUrl) is required for a live run",
    };
  }
  if (!ADDRESS_RE.test(wallet)) {
    return { ok: false, error: `--wallet must be a 0x-prefixed 20-byte address, got: ${wallet}` };
  }
  if (!ADDRESS_RE.test(hsiManager)) {
    return {
      ok: false,
      error: `--hsiManager must be a 0x-prefixed 20-byte address, got: ${hsiManager}`,
    };
  }
  if (!DECIMAL_UINT_RE.test(tokenId)) {
    return {
      ok: false,
      error: `--tokenId must be a non-negative decimal integer string, got: ${tokenId}`,
    };
  }

  return { ok: true, input: { wallet, hsiManager, tokenId, rpcUrl } };
}

function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

async function main(): Promise<void> {
  const parsed = parseInput(
    process.argv.slice(2),
    process.env as Record<string, string | undefined>,
  );
  if (!parsed.ok) {
    console.error(`hexmining-hsi-live-verification: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }

  // Deferred imports: keep server-env/prisma-adapter out of the module graph
  // until an actual live run is requested (parseInput stays unit-testable).
  const { PrismaClient } = await import("@prisma/client");
  const { createPrismaAdapter } = await import("@/lib/prisma-adapter");
  const { runHsiLiveVerification } = await import(
    "@/services/hexmining/hsi-live-verification-runner"
  );

  const { wallet, hsiManager, tokenId, rpcUrl } = parsed.input;

  const publicClient = createPublicClient({
    chain: PULSECHAIN_CHAIN,
    transport: http(rpcUrl),
  }) as unknown as HsiLiveVerificationDeps["publicClient"];

  const db = new PrismaClient({ adapter: createPrismaAdapter() });

  const input: HsiLiveVerificationInput = {
    chainId: PULSECHAIN_CHAIN_ID,
    walletAddress: wallet,
    hsiManagerAddress: hsiManager,
    expectedHsiTokenId: tokenId,
  };

  try {
    const report = await runHsiLiveVerification(input, {
      publicClient,
      persistenceClient: db as unknown as HsiLiveVerificationDeps["persistenceClient"],
    });
    console.log(safeStringify(report));
    process.exitCode = report.allChecksPassed ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

// Run only when executed directly as CLI, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`hexmining-hsi-live-verification error: ${message}`);
    process.exitCode = 1;
  });
}
