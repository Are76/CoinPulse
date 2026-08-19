/**
 * Historical canonical raw-transfer provenance repair — operator utility only.
 *
 * PR #376 started persisting exact RawTokenTransfer evidence for SWAP, LP,
 * and currently-supported transfer-derived STAKE actions
 * (RawDexSwapTransferEvidence / RawLpActionTransferEvidence /
 * RawStakeActionTransferEvidence, plus rawTransferEvidenceStatus). It did
 * not backfill historical rows — those remain rawTransferEvidenceStatus ===
 * null. PR #377 only suppresses generic TRANSFER shadows when
 * rawTransferEvidenceStatus === "RECORDED", so historical actions never
 * suppress their TRANSFER shadow until repaired.
 *
 * This script re-derives that historical evidence using ONLY already
 * persisted canonical PostgreSQL rows — never RPC — by reusing the exact
 * same deterministic evidence-selection functions the live producers
 * (dex-sync.ts / lp-sync.ts / stake-sync.ts) use. An action is repaired
 * only when that exact reused function can unambiguously reconstruct the
 * same RawTokenTransfer membership the live producer would have selected,
 * and only when the recomputed leg amount/asset still matches what was
 * persisted on the action at original ingestion time. Anything ambiguous is
 * left unresolved (rawTransferEvidenceStatus stays null) — never guessed
 * from txHash, symbol, amount, or direction alone.
 *
 * See docs/canonical-raw-transfer-provenance-repair.md for the full
 * deterministic-repair boundary, family classification, and safety model.
 *
 * Usage (dry-run is the default and never mutates):
 *   npm run repair:canonical-provenance -- --chain-id 369 --family SWAP
 *
 * Apply mode requires an explicit chain scope and family:
 *   npm run repair:canonical-provenance -- --chain-id 369 --family SWAP --apply
 *
 * Optional wallet scope and bounded batch size (default 100, hard cap 500):
 *   npm run repair:canonical-provenance -- --chain-id 369 --family LP \
 *     --wallet 0x... --max-actions 200
 *
 * Resume a bounded scan using the cursor from a previous run's report:
 *   npm run repair:canonical-provenance -- --chain-id 369 --family STAKE \
 *     --cursor <nextCursorId>
 *
 * Required environment variables:
 *   DATABASE_URL  PostgreSQL connection string
 *   REDIS_URL     Redis connection string (required by server-env)
 *
 * Run directly with tsx (the --conditions react-server flag is required
 * because the service uses the server-only guard):
 *   npx tsx --conditions react-server scripts/repair-canonical-provenance.ts \
 *     --chain-id 369 --family SWAP
 *
 * Exit behaviour:
 *   - Exits 0 and prints a JSON report on success (including "found nothing").
 *   - Exits 1 on invalid arguments or missing environment, before any DB access.
 *   - Never prints connection strings.
 *
 * This script never rebuilds the ledger and never touches PnL. Provenance
 * repair, ledger rebuild, and PnL are kept as separate, separately approved
 * operator actions.
 */

import { fileURLToPath } from "url";

// ─── CLI argument parsing ──────────────────────────────────────────────────

const FAMILIES = ["SWAP", "LP", "STAKE"] as const;
type Family = (typeof FAMILIES)[number];

export const REPAIR_MAX_ACTIONS_HARD_CAP = 500;
export const REPAIR_DEFAULT_MAX_ACTIONS = 100;

export type ProvenanceRepairCliOptions = {
  apply: boolean;
  chainId: number;
  family: Family;
  walletAddress?: string;
  maxActions?: number;
  cursorId?: string;
};

export type ProvenanceRepairCliParseResult =
  | { ok: true; options: ProvenanceRepairCliOptions }
  | { ok: false; error: string };

export const PROVENANCE_REPAIR_CLI_USAGE = [
  "Usage: repair-canonical-provenance --chain-id <id> --family <SWAP|LP|STAKE>",
  "         [--wallet <0x...>] [--max-actions <n>] [--cursor <id>] [--apply]",
  "",
  "  Dry-run is the default and never mutates rows.",
  "  --chain-id and --family are always required.",
  "  --max-actions defaults to 100 and is hard-capped at " +
    `${REPAIR_MAX_ACTIONS_HARD_CAP}.`,
  "  Only ACTIVE actions with rawTransferEvidenceStatus === null are ever",
  "  scanned; RECORDED and VERIFIED_EMPTY rows are never touched.",
].join("\n");

export function parseProvenanceRepairCliArgs(
  argv: readonly string[],
): ProvenanceRepairCliParseResult {
  let apply = false;
  let chainId: number | undefined;
  let family: Family | undefined;
  let walletAddress: string | undefined;
  let maxActions: number | undefined;
  let cursorId: string | undefined;

  const readValue = (index: number): string | null => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return null;
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--chain-id") {
      const value = readValue(index);
      if (value === null) {
        return { ok: false, error: "--chain-id requires a value." };
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: "--chain-id must be a positive integer." };
      }
      chainId = parsed;
      index += 1;
      continue;
    }

    if (arg === "--family") {
      const value = readValue(index);
      if (value === null || !FAMILIES.includes(value.toUpperCase() as Family)) {
        return {
          ok: false,
          error: `--family must be one of ${FAMILIES.join(", ")}.`,
        };
      }
      family = value.toUpperCase() as Family;
      index += 1;
      continue;
    }

    if (arg === "--wallet") {
      const value = readValue(index);
      if (value === null || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        return { ok: false, error: "--wallet must be a 0x-prefixed 20-byte address." };
      }
      walletAddress = value.toLowerCase();
      index += 1;
      continue;
    }

    if (arg === "--max-actions") {
      const value = readValue(index);
      if (value === null) {
        return { ok: false, error: "--max-actions requires a value." };
      }
      const parsed = Number(value);
      if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > REPAIR_MAX_ACTIONS_HARD_CAP
      ) {
        return {
          ok: false,
          error: `--max-actions must be an integer between 1 and ${REPAIR_MAX_ACTIONS_HARD_CAP}.`,
        };
      }
      maxActions = parsed;
      index += 1;
      continue;
    }

    if (arg === "--cursor") {
      const value = readValue(index);
      if (value === null || value.length === 0) {
        return { ok: false, error: "--cursor requires a value." };
      }
      cursorId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (chainId === undefined) {
    return { ok: false, error: "--chain-id is required." };
  }

  if (family === undefined) {
    return { ok: false, error: "--family is required." };
  }

  return {
    ok: true,
    options: {
      apply,
      chainId,
      family,
      ...(walletAddress === undefined ? {} : { walletAddress }),
      ...(maxActions === undefined ? {} : { maxActions }),
      ...(cursorId === undefined ? {} : { cursorId }),
    },
  };
}

// ─── Env validation ─────────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = ["DATABASE_URL", "REDIS_URL"] as const;

export type EnvCheckResult = { ok: true } | { ok: false; missing: readonly string[] };

export function checkEnv(env: Record<string, string | undefined>): EnvCheckResult {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

async function main(): Promise<void> {
  const parsed = parseProvenanceRepairCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`repair-canonical-provenance: ${parsed.error}`);
    console.error(PROVENANCE_REPAIR_CLI_USAGE);
    process.exitCode = 1;
    return;
  }

  const envCheck = checkEnv(process.env as Record<string, string | undefined>);
  if (!envCheck.ok) {
    console.error(
      `repair-canonical-provenance: missing required environment variables: ${envCheck.missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  // Deferred import so argument/env validation always runs first and the
  // server-only service module never loads for an invalid invocation.
  const { repairCanonicalRawTransferProvenance } = await import(
    "@/services/sync/canonical-provenance-repair"
  );

  const { chainId, family, walletAddress, maxActions, cursorId, apply } = parsed.options;
  const report = await repairCanonicalRawTransferProvenance({
    chainId,
    family,
    apply,
    ...(walletAddress === undefined ? {} : { walletAddress }),
    ...(maxActions === undefined ? {} : { maxActions }),
    ...(cursorId === undefined ? {} : { cursorId }),
  });

  console.log(safeStringify(report));

  if (!report.apply && report.deterministicallyRepairable > 0) {
    console.error(
      `dry-run: ${report.deterministicallyRepairable} deterministically repairable action(s) found; re-run with --apply to persist evidence.`,
    );
  }

  if (report.nextCursorId !== null) {
    console.error(
      `bounded batch exhausted its ${maxActions ?? REPAIR_DEFAULT_MAX_ACTIONS}-action cap; re-run with --cursor ${report.nextCursorId} to continue.`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`repair-canonical-provenance error: ${message}`);
    process.exitCode = 1;
  });
}
