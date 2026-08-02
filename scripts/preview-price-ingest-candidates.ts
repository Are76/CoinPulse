/**
 * Wallet-scoped price-ingestion candidate preview — operator utility only.
 *
 * Produces a read-only, advisory report of assets that could later be
 * submitted manually to the existing:
 *
 *     POST /api/prices/ingest
 *
 * Candidates are discovered from current non-zero canonical
 * `PortfolioTokenBalance` rows for exactly one already-tracked wallet on
 * chainId 369. A listed asset is a *candidate* for a later, manually
 * operator-reviewed pricing attempt — it is not a claim that the asset is
 * priceable or has a verified USD price.
 *
 * This script and the service it calls are STRICTLY READ-ONLY:
 *   - no RPC calls
 *   - no call to runPriceIngestion
 *   - no PriceObservation writes
 *   - no Token/PortfolioTokenBalance mutation
 *   - no SyncRun creation, no operation lock, no rebuild trigger
 *
 * Usage:
 *   npm run preview:price-ingest-candidates -- --wallet 0x... --chain-id 369
 *
 * Required environment variables:
 *   DATABASE_URL  PostgreSQL connection string
 *   REDIS_URL     Redis connection string (required by server-env)
 *
 * Run directly with tsx (the --conditions react-server flag is required
 * because the discovery service uses the server-only guard):
 *   npx tsx --conditions react-server scripts/preview-price-ingest-candidates.ts \
 *     --wallet 0x... --chain-id 369
 *
 * Exit behaviour:
 *   - Exits 0 on a successful report, including zero eligible candidates.
 *   - Exits 1 on invalid arguments, missing environment, unsupported chain,
 *     invalid wallet address, an untracked wallet, or a database read failure.
 *   - Never prints connection strings or other environment values.
 */

import { fileURLToPath } from "url";

// Type-only import: erased at compile time, so it does not load the
// server-only module graph and does not affect the deferred-import pattern.
import type {
  DiscoverIngestCandidatesResult,
  EligibleIngestCandidate,
  ExcludedIngestCandidate,
} from "@/services/pricing/discover-ingest-candidates";

const PULSECHAIN_CHAIN_ID = 369 as const;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const REQUIRED_ENV_VARS = ["DATABASE_URL", "REDIS_URL"] as const;

export const PREVIEW_CLI_USAGE =
  "Usage: preview-price-ingest-candidates --wallet <0x...40hex> --chain-id 369";

// ─── CLI argument parsing ──────────────────────────────────────────────────────

export type ParsedInput = {
  wallet: string;
  chainId: number;
};

export type ParseResult = { ok: true; input: ParsedInput } | { ok: false; error: string };

export function parseInput(argv: readonly string[]): ParseResult {
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
  const chainIdRaw = args["chain-id"];

  if (!wallet) return { ok: false, error: "--wallet is required" };
  if (!ADDRESS_RE.test(wallet)) {
    return { ok: false, error: `--wallet must be a 0x-prefixed 20-byte address, got: ${wallet}` };
  }

  if (!chainIdRaw) return { ok: false, error: "--chain-id is required" };
  const chainId = Number(chainIdRaw);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return { ok: false, error: `--chain-id must be a positive integer, got: ${chainIdRaw}` };
  }
  if (chainId !== PULSECHAIN_CHAIN_ID) {
    return {
      ok: false,
      error: `--chain-id must be ${PULSECHAIN_CHAIN_ID} (PulseChain); this preview supports chainId ${PULSECHAIN_CHAIN_ID} only`,
    };
  }

  return { ok: true, input: { wallet: wallet.toLowerCase(), chainId } };
}

// ─── Env validation ────────────────────────────────────────────────────────────

export type EnvCheckResult = { ok: true } | { ok: false; missing: readonly string[] };

export function checkEnv(env: Record<string, string | undefined>): EnvCheckResult {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── Report assembly ───────────────────────────────────────────────────────────

export const PREVIEW_WARNINGS = [
  "No RPC call was made to produce this report.",
  "No price ingestion was executed and no POST /api/prices/ingest call was made.",
  "No PriceObservation record was written.",
  "Candidate inclusion does not prove priceability or a verified USD price.",
  "Manual operator review is required before submitting any candidate to POST /api/prices/ingest.",
] as const;

export type PreviewReport = {
  schemaVersion: "v1";
  generatedAt: string;
  chainId: number;
  walletAddress: string;
  trackedWalletId: string;
  totalBalanceRowsInspected: number;
  totalEligibleBeforeCap: number;
  totalReturned: number;
  totalExcluded: number;
  cap: number;
  truncated: boolean;
  eligible: EligibleIngestCandidate[];
  excluded: ExcludedIngestCandidate[];
  warnings: readonly string[];
};

function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

/** Never includes err.message — Prisma errors can embed connection strings. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? `${err.name} (${code})` : err.name;
}

// ─── Orchestration (testable) ──────────────────────────────────────────────────

export type TrackedWallet = { id: string; address: string; chainId: number };

export type PreviewCliDependencies = {
  /**
   * Deferred loader for server-only services. Only called after argument
   * and environment validation both pass, so an invalid invocation never
   * loads the server-only module graph.
   */
  loadServices: () => Promise<{
    resolveTrackedWallet: (args: {
      walletAddress: string;
      chainId: number;
    }) => Promise<TrackedWallet | null>;
    discoverCandidates: (args: {
      chainId: number;
      walletId: string;
      walletAddress: string;
    }) => Promise<DiscoverIngestCandidatesResult>;
  }>;
  now: () => Date;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type PreviewCliRunResult = { exitCode: number };

export async function runPreviewCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  deps: PreviewCliDependencies,
): Promise<PreviewCliRunResult> {
  const parsed = parseInput(argv);
  if (!parsed.ok) {
    deps.stderr(`preview-price-ingest-candidates: ${parsed.error}`);
    deps.stderr(PREVIEW_CLI_USAGE);
    return { exitCode: 1 };
  }

  const envCheck = checkEnv(env);
  if (!envCheck.ok) {
    deps.stderr(
      `preview-price-ingest-candidates: missing required environment variables: ${envCheck.missing.join(", ")}`,
    );
    return { exitCode: 1 };
  }

  const { wallet, chainId } = parsed.input;
  const { resolveTrackedWallet, discoverCandidates } = await deps.loadServices();

  let trackedWallet: TrackedWallet | null;
  try {
    trackedWallet = await resolveTrackedWallet({ walletAddress: wallet, chainId });
  } catch (err) {
    deps.stderr(
      `preview-price-ingest-candidates: database read failed while resolving wallet — ${describeError(err)}`,
    );
    return { exitCode: 1 };
  }

  if (!trackedWallet) {
    deps.stderr(
      `preview-price-ingest-candidates: wallet ${wallet} is not tracked on chainId ${chainId}. Import it first via POST /api/wallets/import.`,
    );
    return { exitCode: 1 };
  }

  let result: DiscoverIngestCandidatesResult;
  try {
    result = await discoverCandidates({
      chainId: trackedWallet.chainId,
      walletId: trackedWallet.id,
      walletAddress: trackedWallet.address,
    });
  } catch (err) {
    deps.stderr(`preview-price-ingest-candidates: discovery failed — ${describeError(err)}`);
    return { exitCode: 1 };
  }

  const report: PreviewReport = {
    schemaVersion: "v1",
    generatedAt: deps.now().toISOString(),
    chainId: result.chainId,
    walletAddress: result.walletAddress,
    trackedWalletId: trackedWallet.id,
    totalBalanceRowsInspected: result.totalBalanceRowsInspected,
    totalEligibleBeforeCap: result.totalEligibleBeforeCap,
    totalReturned: result.totalReturned,
    totalExcluded: result.totalExcluded,
    cap: result.cap,
    truncated: result.truncated,
    eligible: result.eligible,
    excluded: result.excluded,
    warnings: PREVIEW_WARNINGS,
  };

  deps.stdout(safeStringify(report));
  return { exitCode: 0 };
}

// ─── CLI entrypoint ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const result = await runPreviewCli(
    process.argv.slice(2),
    process.env as Record<string, string | undefined>,
    {
      loadServices: async () => {
        const { resolveTrackedWalletByAddress } = await import("@/services/api/wallets");
        const { discoverPriceIngestCandidates } = await import(
          "@/services/pricing/discover-ingest-candidates"
        );
        return {
          resolveTrackedWallet: resolveTrackedWalletByAddress,
          discoverCandidates: discoverPriceIngestCandidates,
        };
      },
      now: () => new Date(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    },
  );
  process.exitCode = result.exitCode;
}

// Run only when executed directly as CLI, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`preview-price-ingest-candidates error: ${message}`);
    process.exitCode = 1;
  });
}
