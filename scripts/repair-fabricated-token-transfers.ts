/**
 * Fabricated RawTokenTransfer repair — operator utility only.
 *
 * Before PR #326/#327 the transfer decoder could decode non-Transfer events
 * (e.g. the HEX StakeStart event) into RawTokenTransfer rows. Those
 * fabricated rows are still ACTIVE and poison downstream transfer-shape
 * checks (e.g. `ambiguous-start-transfer-shape` stake-sync skips).
 *
 * This script compares each ACTIVE RawTokenTransfer against its exact
 * backing RawLog (matched on chainId + txHash + logIndex + blockHash) and
 * marks a row REORGED only when the backing RawLog is ACTIVE and its topic0
 * is definitively not the ERC-20 Transfer signature. Nothing is deleted.
 *
 * Usage (dry-run is the default and never mutates):
 *   npm run repair:fabricated-transfers -- --chain-id 369
 *
 * Apply mode requires an explicit chain scope:
 *   npm run repair:fabricated-transfers -- --chain-id 369 --apply
 *
 * Exact single-row targeting (all identity flags required together):
 *   npm run repair:fabricated-transfers -- --chain-id 369 \
 *     --tx-hash 0x... --log-index 40 --block-hash 0x... --apply
 *
 * Required environment variables:
 *   DATABASE_URL  PostgreSQL connection string
 *   REDIS_URL     Redis connection string (required by server-env)
 *
 * Run directly with tsx (the --conditions react-server flag is required
 * because the service uses the server-only guard):
 *   npx tsx --conditions react-server scripts/repair-fabricated-token-transfers.ts --chain-id 369
 *
 * Exit behaviour:
 *   - Exits 0 and prints a JSON report on success (including "found nothing").
 *   - Exits 1 on invalid arguments or missing environment, before any DB access.
 *   - Never prints connection strings.
 */

import { fileURLToPath } from "url";

// ─── CLI argument parsing ──────────────────────────────────────────────────────

export type RepairCliOptions = {
  apply: boolean;
  chainId?: number;
  identity?: {
    txHash: string;
    logIndex: number;
    blockHash: string;
  };
};

export type RepairCliParseResult =
  | { ok: true; options: RepairCliOptions }
  | { ok: false; error: string };

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export const REPAIR_CLI_USAGE = [
  "Usage: repair-fabricated-token-transfers [--chain-id <id>] [--apply]",
  "         [--tx-hash <0x..64 hex> --log-index <n> --block-hash <0x..64 hex>]",
  "",
  "  Dry-run is the default and never mutates rows.",
  "  --apply requires --chain-id (mutations must be chain-scoped).",
  "  Identity flags must be provided all together with --chain-id, or not at all.",
].join("\n");

export function parseRepairCliArgs(argv: readonly string[]): RepairCliParseResult {
  let apply = false;
  let chainId: number | undefined;
  let txHash: string | undefined;
  let logIndex: number | undefined;
  let blockHash: string | undefined;

  const readValue = (flag: string, index: number): string | null => {
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
      const value = readValue(arg, index);
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

    if (arg === "--tx-hash") {
      const value = readValue(arg, index);
      if (value === null || !HASH_PATTERN.test(value)) {
        return { ok: false, error: "--tx-hash must be a 0x-prefixed 32-byte hex hash." };
      }
      txHash = value.toLowerCase();
      index += 1;
      continue;
    }

    if (arg === "--log-index") {
      const value = readValue(arg, index);
      if (value === null) {
        return { ok: false, error: "--log-index requires a value." };
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { ok: false, error: "--log-index must be a non-negative integer." };
      }
      logIndex = parsed;
      index += 1;
      continue;
    }

    if (arg === "--block-hash") {
      const value = readValue(arg, index);
      if (value === null || !HASH_PATTERN.test(value)) {
        return { ok: false, error: "--block-hash must be a 0x-prefixed 32-byte hex hash." };
      }
      blockHash = value.toLowerCase();
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  const identityFlagsProvided = [txHash, logIndex, blockHash].filter(
    (value) => value !== undefined,
  ).length;

  if (identityFlagsProvided > 0 && identityFlagsProvided < 3) {
    return {
      ok: false,
      error:
        "Partial identity targeting is ambiguous: --tx-hash, --log-index, and --block-hash must be provided together.",
    };
  }

  if (identityFlagsProvided === 3 && chainId === undefined) {
    return {
      ok: false,
      error:
        "Exact identity targeting requires --chain-id: the unique raw identity is chainId + txHash + logIndex + blockHash.",
    };
  }

  if (apply && chainId === undefined) {
    return {
      ok: false,
      error: "--apply requires --chain-id: mutations must not be globally unscoped.",
    };
  }

  return {
    ok: true,
    options: {
      apply,
      ...(chainId === undefined ? {} : { chainId }),
      ...(identityFlagsProvided === 3
        ? {
            identity: {
              txHash: txHash as string,
              logIndex: logIndex as number,
              blockHash: blockHash as string,
            },
          }
        : {}),
    },
  };
}

// ─── Env validation ────────────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = ["DATABASE_URL", "REDIS_URL"] as const;

export type EnvCheckResult =
  | { ok: true }
  | { ok: false; missing: readonly string[] };

export function checkEnv(env: Record<string, string | undefined>): EnvCheckResult {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
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
  const parsed = parseRepairCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`repair-fabricated-token-transfers: ${parsed.error}`);
    console.error(REPAIR_CLI_USAGE);
    process.exitCode = 1;
    return;
  }

  const envCheck = checkEnv(process.env as Record<string, string | undefined>);
  if (!envCheck.ok) {
    console.error(
      `repair-fabricated-token-transfers: missing required environment variables: ${envCheck.missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  // Deferred import so argument/env validation always runs first and the
  // server-only service module never loads for an invalid invocation.
  const { repairFabricatedTokenTransfers } = await import(
    "@/services/ingestion/fabricated-transfer-repair"
  );

  const report = await repairFabricatedTokenTransfers(parsed.options);

  console.log(safeStringify(report));

  if (!report.apply && report.provenFabricatedTransfers > 0) {
    console.error(
      `dry-run: ${report.provenFabricatedTransfers} provably fabricated row(s) found; re-run with --apply --chain-id <id> to invalidate them.`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`repair-fabricated-token-transfers error: ${message}`);
    process.exitCode = 1;
  });
}
