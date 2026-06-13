/**
 * Gate 10 verification runner — operator utility only.
 *
 * Loads an observation from the database by ID, checks for invalidation,
 * and calls verifyHexMiningYieldEvidence() to produce a sanitized evidence
 * record suitable for Gate 10 submission.
 *
 * Usage:
 *   DATABASE_URL='...' npx tsx --conditions react-server \
 *     scripts/hexmining-gate10-run.ts \
 *     --observationId <cuid> \
 *     --stakeShares <decimal-string>
 *
 * The --conditions react-server flag is required because the verification
 * harness uses the server-only guard, which resolves to a no-op only under
 * the react-server export condition.
 *
 * Output: sanitized JSON to stdout (no canonicalPayload, no credentials).
 *
 * This runner does NOT lift Gate 10. It does NOT expose estimated yield
 * publicly. It is an operator tool for evidence collection only.
 */

import { PrismaClient } from "@prisma/client";

import { createPrismaAdapter } from "@/lib/prisma-adapter";
import { runGate10Verification } from "@/services/hexmining/gate10-runner";

function parseArgs(argv: string[]): { observationId: string; stakeShares: bigint } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length - 1; i++) {
    const flag = argv[i];
    if (flag.startsWith("--")) {
      args[flag.slice(2)] = argv[i + 1] ?? "";
    }
  }
  const { observationId, stakeShares } = args;
  if (!observationId) throw new Error("--observationId is required");
  if (!stakeShares) throw new Error("--stakeShares is required");
  let parsedShares: bigint;
  try {
    parsedShares = BigInt(stakeShares);
  } catch {
    throw new Error(`--stakeShares must be a valid decimal integer string, got: ${stakeShares}`);
  }
  if (parsedShares < 0n) throw new Error("--stakeShares must be non-negative");
  return { observationId, stakeShares: parsedShares };
}

function safeStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));
  const db = new PrismaClient({ adapter: createPrismaAdapter() });
  try {
    const result = await runGate10Verification(input, db);
    if ("error" in result) {
      console.error(`gate10-runner: ${result.error}`, safeStringify(result));
      process.exitCode = 1;
      return;
    }
    console.log(safeStringify(result));
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`gate10-runner error: ${message}`);
  process.exitCode = 1;
});
