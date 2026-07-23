/**
 * HexMining ended-stake API verification — operator utility only.
 *
 * The DB/API counterpart of scripts/hexmining-native-stake-live-verification.ts.
 * Drives the existing backend read path
 *
 *     GET /api/hexmining/ended-stakes → EndedHexStakeListDto
 *
 * against a LOCALLY RUNNING server for a known PulseChain wallet and prints a
 * factual PASS/WARN/FAIL presence/consistency report over the canonical persisted
 * ended-stake observations. It is strictly READ-ONLY: one HTTP GET, no writes, no
 * discovery trigger, no RPC. It performs NO pricing, valuation, yield, ROI,
 * APR/APY, or PnL math.
 *
 * Usage:
 *   npx tsx scripts/hexmining-ended-stake-api-verification.ts \
 *     --wallet <0x...> \
 *     [--base-url <url>]    # defaults to OPERATOR_RUNNER_BASE_URL or http://localhost:3000
 *     [--chain-id <id>]     # defaults to 369 (PulseChain); only 369 is supported
 *     [--evidence-dir <path>]  # when set, appends the report JSON as evidence
 *
 * The verified truth is PostgreSQL, read only through the shipped API DTO. The
 * server (and its DATABASE_URL) must be running for the route to be reachable;
 * this script itself does not open a DB connection and does not read RPC.
 *
 * Output: JSON verification report to stdout. The base URL value, credentials,
 * and environment variable values are never printed. Exit code: 0 on PASS, 2 on
 * WARN (reachable but no clean proof), 1 on FAIL.
 */

import { fileURLToPath } from "url";
import { mkdir, appendFile } from "fs/promises";
import path from "path";

import type {
  EndedStakeApiVerificationDeps,
  EndedStakeApiVerificationInput,
  EndedStakeApiVerificationReport,
} from "@/services/hexmining/ended-stake-api-verification-runner";

const PULSECHAIN_CHAIN_ID = 369 as const;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Literal fallback only. parseInput never reads ambient process.env: the base URL
// is derived strictly from --base-url, the injected env object, then this literal,
// so parsing stays deterministic regardless of the ambient environment. The CLI
// entrypoint (main) explicitly passes process.env in when it wants that source.
const LOCALHOST_BASE_URL = "http://localhost:3000";
const DEFAULT_EVIDENCE_DIR = "operator-evidence/hexmining-ended-stake-api-verification";

// ─── parseInput ───────────────────────────────────────────────────────────────

export type ParsedInput = {
  wallet: string;
  baseUrl: string;
  chainId: number;
  evidenceDir: string | null;
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

  const wallet = args["wallet"];
  const baseUrl = args["base-url"] ?? env["OPERATOR_RUNNER_BASE_URL"] ?? LOCALHOST_BASE_URL;
  const chainIdRaw = args["chain-id"] ?? String(PULSECHAIN_CHAIN_ID);
  const evidenceDir = args["evidence-dir"] ?? null;

  if (!wallet) return { ok: false, error: "--wallet is required" };
  if (!ADDRESS_RE.test(wallet)) {
    return { ok: false, error: `--wallet must be a 0x-prefixed 20-byte address, got: ${wallet}` };
  }

  const chainId = Number(chainIdRaw);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return { ok: false, error: `--chain-id must be a positive integer, got: ${chainIdRaw}` };
  }
  if (chainId !== PULSECHAIN_CHAIN_ID) {
    return {
      ok: false,
      error: `--chain-id must be ${PULSECHAIN_CHAIN_ID} (PulseChain); ended-stake verification supports native pHEX on PulseChain only`,
    };
  }

  return {
    ok: true,
    input: { wallet: wallet.toLowerCase(), baseUrl, chainId, evidenceDir },
  };
}

// ─── Output ─────────────────────────────────────────────────────────────────────

export function classificationExitCode(
  classification: EndedStakeApiVerificationReport["classification"],
): number {
  switch (classification) {
    case "PASS":
      return 0;
    case "WARN":
      return 2;
    case "FAIL":
    default:
      return 1;
  }
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function main(): Promise<void> {
  const parsed = parseInput(
    process.argv.slice(2),
    process.env as Record<string, string | undefined>,
  );
  if (!parsed.ok) {
    console.error(`hexmining-ended-stake-api-verification: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }

  // Deferred import keeps parseInput trivially importable in tests without
  // pulling the runner module graph.
  const { runEndedStakeApiVerification } = await import(
    "@/services/hexmining/ended-stake-api-verification-runner"
  );

  const { wallet, baseUrl, chainId, evidenceDir } = parsed.input;

  const input: EndedStakeApiVerificationInput = {
    chainId,
    walletAddress: wallet,
    baseUrl,
  };

  // Inject global fetch. The runner issues exactly one read-only GET.
  const deps: EndedStakeApiVerificationDeps = {
    fetchImpl: (url, init) => fetch(url, init),
  };

  const report = await runEndedStakeApiVerification(input, deps);

  const json = safeStringify(report);
  console.log(json);

  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    const filePath = path.join(evidenceDir, "ended-stake-api-verification-evidence.jsonl");
    await appendFile(filePath, `${JSON.stringify(report)}\n`, "utf8");
  }

  process.exitCode = classificationExitCode(report.classification);
}

// Run only when executed directly as CLI, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`hexmining-ended-stake-api-verification error: ${message}`);
    process.exitCode = 1;
  });
}

// Default evidence directory, exported so the runbook and tests can reference the
// canonical location without duplicating the string.
export { DEFAULT_EVIDENCE_DIR };
