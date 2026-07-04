/**
 * HexMining native active-stake live verification — operator utility only.
 *
 * The native-HEX counterpart of scripts/hexmining-hsi-live-verification.ts.
 * Drives the existing native stake read path (stakeCount → stakeLists) against a
 * known PulseChain wallet and prints a factual presence/consistency report. It
 * adds NO product functionality, persists NOTHING, and performs NO pricing,
 * valuation, yield, ROI, APR/APY, or PnL math.
 *
 * Usage:
 *   PULSECHAIN_RPC_URL='https://...' \
 *     npx tsx --conditions react-server \
 *     scripts/hexmining-native-stake-live-verification.ts \
 *     --wallet <0x...> \
 *     [--hexAddress <0x...>]   # defaults to the canonical pHEX address
 *     [--rpcUrl <url>]         # overrides PULSECHAIN_RPC_URL
 *
 * The --conditions react-server flag is required because the runner uses the
 * server-only guard, which resolves to a no-op only under that export condition.
 *
 * Output: JSON verification report to stdout (no credentials, no rpcUrl).
 * Exit code is 0 only when every check passes; 1 otherwise.
 *
 * This script reads on-chain only. It does NOT touch the database, lift any
 * gate, expose any DTO, or persist anything. It is an operator evidence tool.
 */

import { fileURLToPath } from "url";

import { createPublicClient, http } from "viem";

import { PHEX_ADDRESS } from "@/config/assets";
import { PULSECHAIN_CHAIN } from "@/config/chains";
import type {
  NativeStakeLiveVerificationDeps,
  NativeStakeLiveVerificationInput,
} from "@/services/hexmining/native-stake-live-verification-runner";

const PULSECHAIN_CHAIN_ID = 369 as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type ParsedInput = {
  wallet: string;
  hexAddress: string;
  rpcUrl: string;
};

export type ParseResult = { ok: true; input: ParsedInput } | { ok: false; error: string };

export function parseInput(
  argv: string[],
  env: Record<string, string | undefined>,
): ParseResult {
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

  const { wallet } = args;
  const hexAddress = args["hexAddress"] ?? PHEX_ADDRESS;
  const rpcUrl = args["rpcUrl"] ?? env["PULSECHAIN_RPC_URL"];

  if (!wallet) return { ok: false, error: "--wallet is required" };
  if (!rpcUrl) {
    return {
      ok: false,
      error: "PULSECHAIN_RPC_URL (or --rpcUrl) is required for a live run",
    };
  }
  if (!ADDRESS_RE.test(wallet)) {
    return { ok: false, error: `--wallet must be a 0x-prefixed 20-byte address, got: ${wallet}` };
  }
  if (!ADDRESS_RE.test(hexAddress)) {
    return {
      ok: false,
      error: `--hexAddress must be a 0x-prefixed 20-byte address, got: ${hexAddress}`,
    };
  }

  return { ok: true, input: { wallet, hexAddress, rpcUrl } };
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
    console.error(`hexmining-native-stake-live-verification: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }

  // Deferred import: keep the server-only runner out of the module graph until an
  // actual live run is requested (parseInput stays trivially importable).
  const { runNativeStakeLiveVerification } = await import(
    "@/services/hexmining/native-stake-live-verification-runner"
  );

  const { wallet, hexAddress, rpcUrl } = parsed.input;

  const publicClient = createPublicClient({
    chain: PULSECHAIN_CHAIN,
    transport: http(rpcUrl),
  }) as unknown as NativeStakeLiveVerificationDeps["publicClient"];

  const input: NativeStakeLiveVerificationInput = {
    chainId: PULSECHAIN_CHAIN_ID,
    walletAddress: wallet,
    hexAddress,
  };

  const report = await runNativeStakeLiveVerification(input, { publicClient });
  console.log(safeStringify(report));
  process.exitCode = report.allChecksPassed ? 0 : 1;
}

// Run only when executed directly as CLI, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`hexmining-native-stake-live-verification error: ${message}`);
    process.exitCode = 1;
  });
}
