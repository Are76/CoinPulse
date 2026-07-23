/**
 * HexMining ended-stake historical-state recovery — operator utility only.
 *
 * Recovers lockedDay/stakeShares for native PulseChain (pHEX) ended-stake
 * observations that have no transaction-backed RawStakeAction START evidence, by
 * reading the HEX contract's own historical state (stakeLists) pinned to
 * endBlockNumber-1 for each stake, and upgrading the existing
 * RawEndedHexStakeObservation row in place. It never scans transaction history,
 * never fabricates a RawStakeAction row, and never creates a new observation row
 * — see src/services/hexmining/ended-stake-historical-state-recovery.ts and
 * src/services/hexmining/ended-stake-observation-store.ts's
 * enrichEndedHexStakeObservation for the underlying atomic, identity-bound,
 * create-free write path.
 *
 * Usage (dry-run, the safe default — no writes):
 *   PULSECHAIN_RPC_URL='https://...' \
 *     npx tsx --conditions react-server \
 *     scripts/hexmining-ended-stake-historical-state-recovery.ts \
 *     --wallet <0x...>
 *
 * Usage (execute — writes to the database):
 *   PULSECHAIN_RPC_URL='https://...' \
 *     npx tsx --conditions react-server \
 *     scripts/hexmining-ended-stake-historical-state-recovery.ts \
 *     --wallet <0x...> --execute
 *
 * Flags:
 *   --wallet <0x...>      required
 *   --chain-id <id>       optional, defaults to 369 (PulseChain); only 369 is supported
 *   --execute             optional; without it, the run is a dry-run: every RPC
 *                         read and evidence validation still happens, but no
 *                         database write occurs
 *   --rpc-url <url>       optional, overrides PULSECHAIN_RPC_URL
 *   --evidence-dir <path> optional; when set, appends the JSON report as one
 *                         line to <dir>/ended-stake-historical-state-recovery-evidence.jsonl
 *
 * The --conditions react-server flag is required because the service and store
 * modules use the server-only guard, which resolves to a no-op only under that
 * export condition.
 *
 * Output: JSON report to stdout. RPC URL and DATABASE_URL values are never
 * printed — only their presence is implied by a successful run. Exit code: 0 on
 * a clean run with zero failures, 1 on any RPC/validation/mutation failure
 * category, 2 on a hard input/setup error (bad flags, unsupported chain).
 */

import { fileURLToPath } from "url";
import { mkdir, appendFile } from "fs/promises";
import path from "path";

import { createPublicClient, http } from "viem";

import { PULSECHAIN_CHAIN } from "@/config/chains";
import type {
  RecoverEndedHexStakeHistoricalStateDeps,
  RecoverEndedHexStakeHistoricalStateInput,
  RecoverEndedHexStakeHistoricalStateResult,
} from "@/services/hexmining/ended-stake-historical-state-recovery";

const PULSECHAIN_CHAIN_ID = 369 as const;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_EVIDENCE_DIR =
  "operator-evidence/hexmining-ended-stake-historical-state-recovery";

// ─── parseInput ───────────────────────────────────────────────────────────────

export type ParsedInput = {
  wallet: string;
  chainId: number;
  execute: boolean;
  rpcUrl: string | undefined;
  evidenceDir: string | null;
};

export type ParseResult = { ok: true; input: ParsedInput } | { ok: false; error: string };

export function parseInput(
  argv: string[],
  env: Record<string, string | undefined>,
): ParseResult {
  const args: Record<string, string> = {};
  let execute = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) continue;
    if (flag === "--execute") {
      execute = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      return { ok: false, error: `${flag} requires a value` };
    }
    args[flag.slice(2)] = value;
    i += 1;
  }

  const wallet = args["wallet"];
  const chainIdRaw = args["chain-id"] ?? String(PULSECHAIN_CHAIN_ID);
  const rpcUrl = args["rpc-url"] ?? env["PULSECHAIN_RPC_URL"];
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
      error: `--chain-id must be ${PULSECHAIN_CHAIN_ID} (PulseChain); this recovery supports native pHEX on PulseChain only`,
    };
  }

  if (!rpcUrl) {
    return {
      ok: false,
      error: "PULSECHAIN_RPC_URL (or --rpc-url) is required — RPC reads are pinned per stake",
    };
  }

  return {
    ok: true,
    input: { wallet: wallet.toLowerCase(), chainId, execute, rpcUrl, evidenceDir },
  };
}

// ─── Output ─────────────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

export function resultExitCode(result: RecoverEndedHexStakeHistoricalStateResult): number {
  if (!result.ok) return 2;
  return result.totalFailures > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const parsed = parseInput(
    process.argv.slice(2),
    process.env as Record<string, string | undefined>,
  );
  if (!parsed.ok) {
    console.error(`hexmining-ended-stake-historical-state-recovery: ${parsed.error}`);
    process.exitCode = 2;
    return;
  }

  // Deferred import: keep the server-only service/store modules out of the
  // module graph until a run is actually requested.
  const { recoverEndedHexStakeHistoricalState } = await import(
    "@/services/hexmining/ended-stake-historical-state-recovery"
  );

  const { wallet, chainId, execute, rpcUrl, evidenceDir } = parsed.input;

  const publicClient = createPublicClient({
    chain: PULSECHAIN_CHAIN,
    transport: http(rpcUrl),
  }) as unknown as RecoverEndedHexStakeHistoricalStateDeps["publicClient"];

  const input: RecoverEndedHexStakeHistoricalStateInput = {
    chainId,
    walletAddress: wallet,
    dryRun: !execute,
  };

  const result = await recoverEndedHexStakeHistoricalState(input, { publicClient });

  const json = safeStringify(result);
  console.log(json);

  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    const filePath = path.join(
      evidenceDir,
      "ended-stake-historical-state-recovery-evidence.jsonl",
    );
    await appendFile(filePath, `${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`, "utf8");
  }

  process.exitCode = resultExitCode(result);
}

// Run only when executed directly as CLI, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`hexmining-ended-stake-historical-state-recovery error: ${message}`);
    process.exitCode = 1;
  });
}

export { DEFAULT_EVIDENCE_DIR };
