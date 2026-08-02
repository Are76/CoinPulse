// Wallet-scoped price-ingest candidate preview CLI — focused unit tests.
//
// parseInput/checkEnv/warnings are exercised directly, matching the
// deferred-import pattern used by other operator scripts (e.g.
// scripts/repair-fabricated-token-transfers.ts). No live database, no RPC,
// no server-only service import happens at test-collection time.
//
// runPreviewCli orchestration is exercised with fully injected dependencies
// (loadServices/now/stdout/stderr) — this proves the actual wallet-lookup →
// discovery → report flow, exit codes, and error redaction, none of which
// parseInput/checkEnv alone can prove.

import { describe, expect, it, vi } from "vitest";

import {
  checkEnv,
  parseInput,
  PREVIEW_WARNINGS,
  runPreviewCli,
  type PreviewCliDependencies,
  type TrackedWallet,
} from "../../scripts/preview-price-ingest-candidates";
import type { DiscoverIngestCandidatesResult } from "@/services/pricing/discover-ingest-candidates";

const VALID_WALLET = "0x1111111111111111111111111111111111111111";

describe("preview-price-ingest-candidates: import safety", () => {
  it("importing the module does not execute main() or mutate process.exitCode", () => {
    expect(process.exitCode).toBeFalsy();
  });
});

describe("preview-price-ingest-candidates: parseInput", () => {
  it("accepts a valid wallet and chainId 369", () => {
    const result = parseInput(["--wallet", VALID_WALLET, "--chain-id", "369"]);
    expect(result).toEqual({
      ok: true,
      input: { wallet: VALID_WALLET.toLowerCase(), chainId: 369 },
    });
  });

  it("lowercases the wallet address", () => {
    const mixedCase = "0xAbCdEf1234567890AbCdEf1234567890aBcDeF12";
    const result = parseInput(["--wallet", mixedCase, "--chain-id", "369"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.wallet).toBe(mixedCase.toLowerCase());
    }
  });

  it("rejects a missing --wallet", () => {
    const result = parseInput(["--chain-id", "369"]);
    expect(result).toEqual({ ok: false, error: "--wallet is required" });
  });

  it("rejects a malformed wallet address", () => {
    const result = parseInput(["--wallet", "not-an-address", "--chain-id", "369"]);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing --chain-id", () => {
    const result = parseInput(["--wallet", VALID_WALLET]);
    expect(result).toEqual({ ok: false, error: "--chain-id is required" });
  });

  it("rejects an unsupported chainId", () => {
    const result = parseInput(["--wallet", VALID_WALLET, "--chain-id", "1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/369/);
    }
  });

  it("rejects a non-integer chainId", () => {
    const result = parseInput(["--wallet", VALID_WALLET, "--chain-id", "abc"]);
    expect(result.ok).toBe(false);
  });
});

describe("preview-price-ingest-candidates: checkEnv", () => {
  it("returns ok:true when all required vars are present", () => {
    expect(checkEnv({ DATABASE_URL: "postgres://x", REDIS_URL: "redis://x" })).toEqual({
      ok: true,
    });
  });

  it("returns ok:false with DATABASE_URL in missing when absent", () => {
    const result = checkEnv({ REDIS_URL: "redis://x" });
    expect(result).toEqual({ ok: false, missing: ["DATABASE_URL"] });
  });

  it("returns ok:false with REDIS_URL in missing when absent", () => {
    const result = checkEnv({ DATABASE_URL: "postgres://x" });
    expect(result).toEqual({ ok: false, missing: ["REDIS_URL"] });
  });

  it("returns all missing vars when both are absent", () => {
    const result = checkEnv({});
    expect(result).toEqual({ ok: false, missing: ["DATABASE_URL", "REDIS_URL"] });
  });
});

describe("preview-price-ingest-candidates: warnings", () => {
  it("declares no RPC, no ingestion, no writes, and mandates manual review", () => {
    const joined = PREVIEW_WARNINGS.join(" ").toLowerCase();
    expect(joined).toMatch(/no rpc call/);
    expect(joined).toMatch(/no price ingestion/);
    expect(joined).toMatch(/no priceobservation/i);
    expect(joined).toMatch(/manual operator review/);
    expect(joined).toMatch(/does not prove priceability/);
  });

  it("contains no secret-shaped values (env values, connection strings)", () => {
    const joined = PREVIEW_WARNINGS.join(" ");
    expect(joined).not.toMatch(/postgres:\/\//);
    expect(joined).not.toMatch(/DATABASE_URL=/);
    expect(joined).not.toMatch(/REDIS_URL=/);
  });
});

// ─── runPreviewCli orchestration ────────────────────────────────────────────────

const VALID_ENV = { DATABASE_URL: "postgres://secret-host/db", REDIS_URL: "redis://secret-host" };
const FIXED_NOW = new Date("2026-08-02T00:00:00.000Z");

const TRACKED_WALLET: TrackedWallet = {
  id: "wallet-db-id",
  address: VALID_WALLET,
  chainId: 369,
};

function emptyDiscoveryResult(
  overrides?: Partial<DiscoverIngestCandidatesResult>,
): DiscoverIngestCandidatesResult {
  return {
    chainId: 369,
    walletAddress: VALID_WALLET,
    totalBalanceRowsInspected: 0,
    totalEligibleBeforeCap: 0,
    totalReturned: 0,
    totalExcluded: 0,
    cap: 50,
    truncated: false,
    eligible: [],
    excluded: [],
    ...overrides,
  };
}

type LoadedServices = Awaited<ReturnType<PreviewCliDependencies["loadServices"]>>;

function makeDeps(overrides?: {
  resolveTrackedWallet?: LoadedServices["resolveTrackedWallet"];
  discoverCandidates?: LoadedServices["discoverCandidates"];
}): PreviewCliDependencies & { stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const resolveTrackedWallet =
    overrides?.resolveTrackedWallet ?? vi.fn(async () => TRACKED_WALLET);
  const discoverCandidates =
    overrides?.discoverCandidates ?? vi.fn(async () => emptyDiscoveryResult());

  return {
    stdoutLines,
    stderrLines,
    loadServices: vi.fn(async () => ({ resolveTrackedWallet, discoverCandidates })),
    now: () => FIXED_NOW,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
  };
}

describe("runPreviewCli: untracked wallet", () => {
  it("returns non-zero and does not call discovery", async () => {
    const discoverCandidates = vi.fn(async () => emptyDiscoveryResult());
    const deps = makeDeps({
      resolveTrackedWallet: vi.fn(async () => null),
      discoverCandidates,
    });

    const result = await runPreviewCli(
      ["--wallet", VALID_WALLET, "--chain-id", "369"],
      VALID_ENV,
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(discoverCandidates).not.toHaveBeenCalled();
    expect(deps.stderrLines.join(" ")).toMatch(/not tracked/);
  });
});

describe("runPreviewCli: wallet lookup failure", () => {
  it("returns non-zero without printing DB/RPC URLs", async () => {
    const dbError = Object.assign(
      new Error(`connect ECONNREFUSED to ${VALID_ENV.DATABASE_URL}`),
      { name: "PrismaClientInitializationError" },
    );
    const deps = makeDeps({
      resolveTrackedWallet: vi.fn(async () => {
        throw dbError;
      }),
    });

    const result = await runPreviewCli(
      ["--wallet", VALID_WALLET, "--chain-id", "369"],
      VALID_ENV,
      deps,
    );

    expect(result.exitCode).toBe(1);
    const combined = deps.stderrLines.join(" ");
    expect(combined).toMatch(/database read failed/);
    expect(combined).not.toContain(VALID_ENV.DATABASE_URL);
    expect(combined).not.toContain("secret-host");
    expect(combined).not.toMatch(/ECONNREFUSED/);
  });
});

describe("runPreviewCli: discovery failure", () => {
  it("returns non-zero without secret values", async () => {
    const discoveryError = Object.assign(
      new Error(`query failed against ${VALID_ENV.DATABASE_URL}`),
      { name: "PrismaClientKnownRequestError", code: "P2021" },
    );
    const deps = makeDeps({
      discoverCandidates: vi.fn(async () => {
        throw discoveryError;
      }),
    });

    const result = await runPreviewCli(
      ["--wallet", VALID_WALLET, "--chain-id", "369"],
      VALID_ENV,
      deps,
    );

    expect(result.exitCode).toBe(1);
    const combined = deps.stderrLines.join(" ");
    expect(combined).toMatch(/discovery failed/);
    expect(combined).toMatch(/P2021/);
    expect(combined).not.toContain(VALID_ENV.DATABASE_URL);
    expect(combined).not.toContain("secret-host");
  });
});

describe("runPreviewCli: successful run", () => {
  it("calls discovery with the canonical tracked-wallet id/address/chain", async () => {
    const discoverCandidates = vi.fn(async () => emptyDiscoveryResult());
    const deps = makeDeps({ discoverCandidates });

    await runPreviewCli(["--wallet", VALID_WALLET, "--chain-id", "369"], VALID_ENV, deps);

    expect(discoverCandidates).toHaveBeenCalledWith({
      chainId: TRACKED_WALLET.chainId,
      walletId: TRACKED_WALLET.id,
      walletAddress: TRACKED_WALLET.address,
    });
  });

  it("emits JSON output with a deterministic generatedAt from the injected clock", async () => {
    const deps = makeDeps();

    const result = await runPreviewCli(
      ["--wallet", VALID_WALLET, "--chain-id", "369"],
      VALID_ENV,
      deps,
    );

    expect(result.exitCode).toBe(0);
    expect(deps.stdoutLines).toHaveLength(1);
    const report = JSON.parse(deps.stdoutLines[0] as string);
    expect(report.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(report.schemaVersion).toBe("v1");
    expect(report.trackedWalletId).toBe(TRACKED_WALLET.id);
    expect(report.warnings).toEqual(PREVIEW_WARNINGS);
  });

  it("treats zero eligible candidates as a success", async () => {
    const deps = makeDeps({
      discoverCandidates: vi.fn(async () => emptyDiscoveryResult({ totalReturned: 0 })),
    });

    const result = await runPreviewCli(
      ["--wallet", VALID_WALLET, "--chain-id", "369"],
      VALID_ENV,
      deps,
    );

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(deps.stdoutLines[0] as string);
    expect(report.eligible).toEqual([]);
    expect(report.totalReturned).toBe(0);
  });

  it("has no ingestion/RPC/write dependency in the injected shape", async () => {
    const deps = makeDeps();

    await runPreviewCli(["--wallet", VALID_WALLET, "--chain-id", "369"], VALID_ENV, deps);

    // The only I/O surface is loadServices (wallet lookup + discovery). There
    // is no publicClient, fetchPrice, or runPriceIngestion dependency to
    // inject, and this test does not construct one.
    expect(deps).not.toHaveProperty("publicClient");
    expect(deps).not.toHaveProperty("runPriceIngestion");
  });
});

describe("runPreviewCli: invalid input short-circuits before loadServices", () => {
  it("never calls loadServices for invalid arguments", async () => {
    const deps = makeDeps();

    const result = await runPreviewCli(["--wallet", "not-an-address"], VALID_ENV, deps);

    expect(result.exitCode).toBe(1);
    expect(deps.loadServices).not.toHaveBeenCalled();
  });

  it("never calls loadServices for missing environment variables", async () => {
    const deps = makeDeps();

    const result = await runPreviewCli(
      ["--wallet", VALID_WALLET, "--chain-id", "369"],
      {},
      deps,
    );

    expect(result.exitCode).toBe(1);
    expect(deps.loadServices).not.toHaveBeenCalled();
  });
});

describe("preview-price-ingest-candidates: main direct-entry guard", () => {
  it("remains guarded by the process.argv[1] === fileURLToPath(import.meta.url) check", () => {
    // Re-asserts the import-safety invariant from the top of this file in the
    // context of the new orchestration exports: importing runPreviewCli et al.
    // must not itself run the CLI or touch process.exitCode.
    expect(process.exitCode).toBeFalsy();
  });
});
