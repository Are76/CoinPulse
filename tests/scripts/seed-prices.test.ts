// Dev price seed script — focused unit tests.
//
// All RPC and DB dependencies are mocked. No live calls.
//
// Verifies:
//   Import safety:
//     1. Importing the module does not execute main() or mutate process.exitCode.
//     2. buildSeedAssets() can be called without any env vars set.
//
//   buildSeedAssets:
//     3. Returns exactly 3 assets (PLS, pHEX, pDAI).
//     4. All asset IDs are canonical chain:369:... format (not symbol strings).
//     5. All asset IDs are scoped to chainId 369.
//     6. All quote assets are fiat:usd.
//     7. No price field is set on any asset (prices come from ingestion).
//     8. PLS asset uses the zero address and 18 decimals.
//     9. pHEX asset uses 8 decimals.
//    10. pDAI asset uses 18 decimals.
//    11. pHEX and pDAI asset IDs embed the token address (not a symbol).
//
//   checkEnv:
//    12. Returns ok:true when all required vars are present.
//    13. Returns ok:false with DATABASE_URL in missing when DATABASE_URL is absent.
//    14. Returns ok:false with PULSECHAIN_RPC_URL in missing when it is absent.
//    15. Returns ok:false with REDIS_URL in missing when it is absent.
//    16. Returns all missing vars when multiple are absent.
//
//   runDevPriceSeed:
//    17. Returns rpc-unavailable when getBlockNumber throws.
//    18. Does not call ingestion when RPC fails.
//    19. Passes canonical chainId and blockNumber to the injected ingestion fn.
//    20. Passes all 3 assets with canonical IDs to the injected ingestion fn.
//    21. Returns ok:true with the ingestion result on success.
//    22. Partial ingestion result (some failed assets) is still ok:true.
//    23. No hardcoded price value is present in the arguments passed to ingestion.

import { describe, expect, it } from "vitest";

import {
  buildSeedAssets,
  checkEnv,
  runDevPriceSeed,
  type SeedPricesDeps,
} from "../../scripts/seed-prices";
import type { PriceIngestAsset, PriceIngestionResult } from "@/services/pricing/price-ingestion";

// ─── Constants ─────────────────────────────────────────────────────────────────

const PULSECHAIN_CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const CANONICAL_ID_RE = /^chain:369:(erc20:0x[a-f0-9]{40}|native:PLS)$/;

function makeIngestionResult(overrides?: Partial<PriceIngestionResult>): PriceIngestionResult {
  return {
    chainId: PULSECHAIN_CHAIN_ID,
    blockNumber: 20_000_000n,
    observedAt: new Date("2026-06-16T00:00:00.000Z"),
    fetchedCount: 3,
    persistedCount: 3,
    failedCount: 0,
    failedAssets: [],
    ...overrides,
  };
}

// ─── Import safety ─────────────────────────────────────────────────────────────

describe("import safety", () => {
  it("importing the module does not mutate process.exitCode", () => {
    // If main() ran on import (e.g. missing fileURLToPath guard), it would
    // read process.argv, fail env validation, and set process.exitCode = 1.
    expect(process.exitCode).not.toBe(1);
  });

  it("buildSeedAssets() can be called without any env vars", () => {
    expect(() => buildSeedAssets()).not.toThrow();
  });
});

// ─── buildSeedAssets ───────────────────────────────────────────────────────────

describe("buildSeedAssets", () => {
  const assets = buildSeedAssets();

  it("returns exactly 3 assets", () => {
    expect(assets).toHaveLength(3);
  });

  it("all asset IDs are canonical chain:369:... format", () => {
    for (const asset of assets) {
      expect(asset.assetId).toMatch(CANONICAL_ID_RE);
    }
  });

  it("all asset IDs are scoped to chainId 369", () => {
    for (const asset of assets) {
      expect(asset.assetId.startsWith("chain:369:")).toBe(true);
    }
  });

  it("all quote assets are fiat:usd", () => {
    for (const asset of assets) {
      expect(asset.quoteAsset).toBe(QUOTE_ASSET);
    }
  });

  it("no price field is set on any asset (prices come from ingestion)", () => {
    for (const asset of assets) {
      expect(asset).not.toHaveProperty("price");
    }
  });

  it("includes PLS native asset with zero address and 18 decimals", () => {
    const pls = assets.find((a) => a.assetId === "chain:369:native:PLS");
    expect(pls).toBeDefined();
    expect(pls?.tokenAddress).toBe("0x0000000000000000000000000000000000000000");
    expect(pls?.tokenDecimals).toBe(18);
  });

  it("includes pHEX asset with 8 decimals", () => {
    const phex = assets.find((a) =>
      a.assetId.includes("0x2b591e99afe9f32eaa6214f7b7629768c40eeb39"),
    );
    expect(phex).toBeDefined();
    expect(phex?.tokenDecimals).toBe(8);
    expect(phex?.assetId).toMatch(/^chain:369:erc20:0x/);
  });

  it("includes pDAI asset with 18 decimals", () => {
    const pdai = assets.find((a) =>
      a.assetId.includes("0xefd766ccb38eaf1dfd701853bfce31359239f305"),
    );
    expect(pdai).toBeDefined();
    expect(pdai?.tokenDecimals).toBe(18);
    expect(pdai?.assetId).toMatch(/^chain:369:erc20:0x/);
  });

  it("pHEX and pDAI asset IDs embed the token address, not a symbol string", () => {
    const erc20Assets = assets.filter((a) => a.assetId.startsWith("chain:369:erc20:"));
    expect(erc20Assets).toHaveLength(2);
    for (const asset of erc20Assets) {
      expect(asset.assetId).not.toMatch(/phex|hex|dai|pls/i);
      expect(asset.assetId).toMatch(/0x[a-f0-9]{40}/);
    }
  });
});

// ─── checkEnv ──────────────────────────────────────────────────────────────────

describe("checkEnv", () => {
  const FULL_ENV = {
    DATABASE_URL: "postgresql://localhost/coinpulse",
    REDIS_URL: "redis://localhost:6379",
    PULSECHAIN_RPC_URL: "http://localhost:8545",
  };

  it("returns ok:true when all required vars are present", () => {
    expect(checkEnv(FULL_ENV)).toEqual({ ok: true });
  });

  it("returns ok:false with DATABASE_URL in missing when absent", () => {
    const env = { REDIS_URL: FULL_ENV.REDIS_URL, PULSECHAIN_RPC_URL: FULL_ENV.PULSECHAIN_RPC_URL };
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain("DATABASE_URL");
  });

  it("returns ok:false with PULSECHAIN_RPC_URL in missing when absent", () => {
    const env = { DATABASE_URL: FULL_ENV.DATABASE_URL, REDIS_URL: FULL_ENV.REDIS_URL };
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain("PULSECHAIN_RPC_URL");
  });

  it("returns ok:false with REDIS_URL in missing when absent", () => {
    const env = { DATABASE_URL: FULL_ENV.DATABASE_URL, PULSECHAIN_RPC_URL: FULL_ENV.PULSECHAIN_RPC_URL };
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain("REDIS_URL");
  });

  it("includes all missing vars when multiple are absent", () => {
    const result = checkEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("DATABASE_URL");
      expect(result.missing).toContain("REDIS_URL");
      expect(result.missing).toContain("PULSECHAIN_RPC_URL");
    }
  });
});

// ─── runDevPriceSeed ───────────────────────────────────────────────────────────

describe("runDevPriceSeed", () => {
  it("returns rpc-unavailable when getBlockNumber throws", async () => {
    const deps: SeedPricesDeps = {
      publicClient: {
        getBlockNumber: async () => {
          throw new Error("connection refused");
        },
      } as never,
      runIngestion: async () => {
        throw new Error("should not be reached");
      },
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("rpc-unavailable");
      expect(result.detail).toContain("connection refused");
    }
  });

  it("does not call ingestion when RPC fails", async () => {
    let ingestionCalled = false;
    const deps: SeedPricesDeps = {
      publicClient: {
        getBlockNumber: async () => {
          throw new Error("timeout");
        },
      } as never,
      runIngestion: async () => {
        ingestionCalled = true;
        return makeIngestionResult();
      },
    };

    await runDevPriceSeed(deps);
    expect(ingestionCalled).toBe(false);
  });

  it("passes canonical chainId and live blockNumber to the ingestion fn", async () => {
    let capturedArgs: Parameters<NonNullable<SeedPricesDeps["runIngestion"]>>[0] | undefined;

    const deps: SeedPricesDeps = {
      publicClient: { getBlockNumber: async () => 20_000_001n } as never,
      runIngestion: async (args) => {
        capturedArgs = args;
        return makeIngestionResult({ blockNumber: args.blockNumber });
      },
    };

    await runDevPriceSeed(deps);
    expect(capturedArgs?.chainId).toBe(PULSECHAIN_CHAIN_ID);
    expect(capturedArgs?.blockNumber).toBe(20_000_001n);
  });

  it("passes all 3 assets with canonical IDs to ingestion", async () => {
    let capturedAssets: readonly { assetId: string }[] = [];

    const deps: SeedPricesDeps = {
      publicClient: { getBlockNumber: async () => 100n } as never,
      runIngestion: async (args) => {
        capturedAssets = args.assets;
        return makeIngestionResult();
      },
    };

    await runDevPriceSeed(deps);
    expect(capturedAssets).toHaveLength(3);
    for (const asset of capturedAssets) {
      expect(asset.assetId).toMatch(CANONICAL_ID_RE);
    }
  });

  it("returns ok:true with the ingestion result on full success", async () => {
    const expectedResult = makeIngestionResult();
    const deps: SeedPricesDeps = {
      publicClient: { getBlockNumber: async () => 999n } as never,
      runIngestion: async () => expectedResult,
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.fetchedCount).toBe(3);
      expect(result.result.persistedCount).toBe(3);
      expect(result.result.failedCount).toBe(0);
    }
  });

  it("partial ingestion result (some failed assets) is still ok:true", async () => {
    const deps: SeedPricesDeps = {
      publicClient: { getBlockNumber: async () => 500n } as never,
      runIngestion: async () =>
        makeIngestionResult({
          fetchedCount: 2,
          persistedCount: 2,
          failedCount: 1,
          failedAssets: ["chain:369:native:PLS"],
        }),
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.failedCount).toBe(1);
      expect(result.result.failedAssets).toContain("chain:369:native:PLS");
    }
  });

  it("no hardcoded price value is present in args passed to ingestion", async () => {
    let capturedAssets: readonly PriceIngestAsset[] = [];

    const deps: SeedPricesDeps = {
      publicClient: { getBlockNumber: async () => 1n } as never,
      runIngestion: async (args) => {
        capturedAssets = args.assets;
        return makeIngestionResult();
      },
    };

    await runDevPriceSeed(deps);
    // Each asset contains only identity/routing fields — never a price value
    for (const asset of capturedAssets) {
      expect(asset).not.toHaveProperty("price");
      expect(asset).not.toHaveProperty("priceUsd");
    }
  });
});
