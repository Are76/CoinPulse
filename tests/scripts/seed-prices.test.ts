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
//    17. Returns rpc-unavailable when getChainId throws.
//    18. Does not call ingestion when RPC fails.
//    19. Returns wrong-chain error when chainId is not 369.
//    20. Does not call getBlockNumber or ingestion when chainId is wrong.
//    21. getChainId is called before getBlockNumber and ingestion.
//    22. Correct chain (369) proceeds to getBlockNumber and ingestion.
//    23. Returns rpc-unavailable when getBlockNumber throws (after correct chain).
//    24. Passes canonical chainId and blockNumber to the injected ingestion fn.
//    25. Passes all 3 assets with canonical IDs to the injected ingestion fn.
//    26. Returns ok:true with the ingestion result on success.
//    27. Partial ingestion result (some failed assets) is still ok:true.
//    28. No hardcoded price value is present in the arguments passed to ingestion.
//
//   sanitizeRpcError:
//    29. Replaces the full RPC URL in the error message.
//    30. Strips username from credential-bearing URLs.
//    31. Strips password from credential-bearing URLs.
//    32. Strips query-param values (API keys) from error messages.
//    33. rpc-unavailable detail does not expose credentials or API keys.
//    34. wrong-chain detail never contains the RPC URL or credentials.

import { describe, expect, it } from "vitest";

import {
  buildSeedAssets,
  checkEnv,
  runDevPriceSeed,
  sanitizeRpcError,
  type SeedPricesDeps,
} from "../../scripts/seed-prices";
import type { PriceIngestAsset, PriceIngestionResult } from "@/services/pricing/price-ingestion";

// ─── Constants ─────────────────────────────────────────────────────────────────

const PULSECHAIN_CHAIN_ID = 369;
const QUOTE_ASSET = "fiat:usd";
const CANONICAL_ID_RE = /^chain:369:(erc20:0x[a-f0-9]{40}|native:0x0000000000000000000000000000000000000000)$/;

/** A URL that embeds credentials and an API key query param. */
const SECRET_RPC_URL = "https://user:pass@example.com/rpc?apikey=SECRET";

function makeIngestionResult(overrides?: Partial<PriceIngestionResult>): PriceIngestionResult {
  return {
    chainId: PULSECHAIN_CHAIN_ID,
    blockNumber: 20_000_000n,
    observedAt: new Date("2026-06-16T00:00:00.000Z"),
    fetchedCount: 3,
    persistedCount: 3,
    failedCount: 0,
    failedAssets: [],
    skippedCount: 0,
    skippedAssets: [],
    ...overrides,
  };
}

const PULSECHAIN_CHAIN_ID_HEX = "0x171"; // 369 in hex
const WRONG_CHAIN_ID_HEX = "0x1"; // 1 (Ethereum Mainnet) in hex

/** Minimal publicClient mock for happy-path tests (correct chain). */
function makeOkClient(blockNumber = 20_000_001n) {
  return {
    request: async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return PULSECHAIN_CHAIN_ID_HEX;
      throw new Error(`unmocked request method: ${method}`);
    },
    getBlockNumber: async () => blockNumber,
  } as never;
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
    const pls = assets.find((a) => a.assetId === "chain:369:native:0x0000000000000000000000000000000000000000");
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

// ─── sanitizeRpcError ──────────────────────────────────────────────────────────

describe("sanitizeRpcError", () => {
  it("replaces the full RPC URL in the error message", () => {
    const result = sanitizeRpcError(SECRET_RPC_URL, `Failed to connect: ${SECRET_RPC_URL}`);
    expect(result).not.toContain(SECRET_RPC_URL);
    expect(result).toContain("[RPC_URL]");
  });

  it("strips the username from the error message", () => {
    const result = sanitizeRpcError(SECRET_RPC_URL, `Auth failed for user at example.com`);
    expect(result).not.toContain("user");
  });

  it("strips the password from the error message", () => {
    const result = sanitizeRpcError(SECRET_RPC_URL, `Bad credentials: pass`);
    expect(result).not.toContain("pass");
  });

  it("strips query-param values (API keys) from the error message", () => {
    const result = sanitizeRpcError(SECRET_RPC_URL, `Unauthorized apikey=SECRET rejected`);
    expect(result).not.toContain("SECRET");
    expect(result).not.toContain("apikey=SECRET");
  });

  it("returns the message unchanged when rpcUrl is empty", () => {
    expect(sanitizeRpcError("", "some error")).toBe("some error");
  });

  it("handles a URL with no credentials or query params without throwing", () => {
    expect(() =>
      sanitizeRpcError("http://localhost:8545", "connection refused"),
    ).not.toThrow();
  });
});

// ─── runDevPriceSeed ───────────────────────────────────────────────────────────

describe("runDevPriceSeed", () => {
  // Chain ID verification
  it("returns rpc-unavailable when eth_chainId request throws", async () => {
    const deps: SeedPricesDeps = {
      publicClient: {
        request: async () => { throw new Error("connection refused"); },
        getBlockNumber: async () => { throw new Error("should not be reached"); },
      } as never,
      runIngestion: async () => { throw new Error("should not be reached"); },
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
        request: async () => { throw new Error("timeout"); },
        getBlockNumber: async () => 1n,
      } as never,
      runIngestion: async () => {
        ingestionCalled = true;
        return makeIngestionResult();
      },
    };

    await runDevPriceSeed(deps);
    expect(ingestionCalled).toBe(false);
  });

  it("returns wrong-chain error when chainId is not 369", async () => {
    const deps: SeedPricesDeps = {
      publicClient: {
        request: async () => WRONG_CHAIN_ID_HEX,
        getBlockNumber: async () => { throw new Error("should not be reached"); },
      } as never,
      runIngestion: async () => { throw new Error("should not be reached"); },
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("wrong-chain");
      expect(result.detail).toContain("369");
      expect(result.detail).toContain("1"); // Ethereum Mainnet chainId
    }
  });

  it("does not call getBlockNumber or ingestion when chainId is wrong", async () => {
    let blockNumberCalled = false;
    let ingestionCalled = false;

    const deps: SeedPricesDeps = {
      publicClient: {
        request: async () => WRONG_CHAIN_ID_HEX,
        getBlockNumber: async () => { blockNumberCalled = true; return 1n; },
      } as never,
      runIngestion: async () => { ingestionCalled = true; return makeIngestionResult(); },
    };

    await runDevPriceSeed(deps);
    expect(blockNumberCalled).toBe(false);
    expect(ingestionCalled).toBe(false);
  });

  it("eth_chainId RPC call is made before getBlockNumber and ingestion", async () => {
    const callOrder: string[] = [];

    const deps: SeedPricesDeps = {
      publicClient: {
        request: async ({ method }: { method: string }) => {
          if (method === "eth_chainId") { callOrder.push("eth_chainId"); return PULSECHAIN_CHAIN_ID_HEX; }
          throw new Error(`unmocked: ${method}`);
        },
        getBlockNumber: async () => { callOrder.push("getBlockNumber"); return 1n; },
      } as never,
      runIngestion: async () => { callOrder.push("ingestion"); return makeIngestionResult(); },
    };

    await runDevPriceSeed(deps);
    expect(callOrder[0]).toBe("eth_chainId");
    expect(callOrder.indexOf("eth_chainId")).toBeLessThan(callOrder.indexOf("getBlockNumber"));
    expect(callOrder.indexOf("eth_chainId")).toBeLessThan(callOrder.indexOf("ingestion"));
  });

  it("correct chain (369) proceeds to getBlockNumber and ingestion", async () => {
    let blockNumberCalled = false;
    let ingestionCalled = false;

    const deps: SeedPricesDeps = {
      publicClient: {
        request: async () => PULSECHAIN_CHAIN_ID_HEX,
        getBlockNumber: async () => { blockNumberCalled = true; return 1n; },
      } as never,
      runIngestion: async () => { ingestionCalled = true; return makeIngestionResult(); },
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(true);
    expect(blockNumberCalled).toBe(true);
    expect(ingestionCalled).toBe(true);
  });

  it("returns rpc-unavailable when getBlockNumber throws (after correct chain)", async () => {
    const deps: SeedPricesDeps = {
      publicClient: {
        request: async () => PULSECHAIN_CHAIN_ID_HEX,
        getBlockNumber: async () => { throw new Error("timeout after chain check"); },
      } as never,
      runIngestion: async () => { throw new Error("should not be reached"); },
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("rpc-unavailable");
      expect(result.detail).toContain("timeout after chain check");
    }
  });

  it("passes canonical chainId and live blockNumber to the ingestion fn", async () => {
    let capturedArgs: Parameters<NonNullable<SeedPricesDeps["runIngestion"]>>[0] | undefined;

    const deps: SeedPricesDeps = {
      publicClient: makeOkClient(20_000_001n),
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
      publicClient: makeOkClient(100n),
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
      publicClient: makeOkClient(999n),
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
      publicClient: makeOkClient(500n),
      runIngestion: async () =>
        makeIngestionResult({
          fetchedCount: 2,
          persistedCount: 2,
          failedCount: 1,
          failedAssets: ["chain:369:native:0x0000000000000000000000000000000000000000"],
        }),
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.failedCount).toBe(1);
      expect(result.result.failedAssets).toContain("chain:369:native:0x0000000000000000000000000000000000000000");
    }
  });

  it("returns ingestion-failed when runIngestion throws", async () => {
    const deps: SeedPricesDeps = {
      publicClient: makeOkClient(100n),
      runIngestion: async () => {
        throw new Error("db connection refused");
      },
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ingestion-failed");
      expect(result.detail).toContain("db connection refused");
    }
  });

  it("no hardcoded price value is present in args passed to ingestion", async () => {
    let capturedAssets: readonly PriceIngestAsset[] = [];

    const deps: SeedPricesDeps = {
      publicClient: makeOkClient(1n),
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

  // Sanitization
  it("rpc-unavailable detail does not expose credentials or API keys from rpcUrl", async () => {
    const deps: SeedPricesDeps = {
      rpcUrl: SECRET_RPC_URL,
      publicClient: {
        request: async () => { throw new Error(`Failed to fetch: ${SECRET_RPC_URL}`); },
        getBlockNumber: async () => 1n,
      } as never,
      runIngestion: async () => makeIngestionResult(),
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("rpc-unavailable");
      expect(result.detail).not.toContain("user");
      expect(result.detail).not.toContain("pass");
      expect(result.detail).not.toContain("SECRET");
      expect(result.detail).not.toContain("apikey=SECRET");
      expect(result.detail).not.toContain(SECRET_RPC_URL);
    }
  });

  it("wrong-chain detail never contains RPC URL or credentials", async () => {
    const deps: SeedPricesDeps = {
      rpcUrl: SECRET_RPC_URL,
      publicClient: {
        request: async () => WRONG_CHAIN_ID_HEX,
        getBlockNumber: async () => 1n,
      } as never,
      runIngestion: async () => makeIngestionResult(),
    };

    const result = await runDevPriceSeed(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("wrong-chain");
      expect(result.detail).not.toContain(SECRET_RPC_URL);
      expect(result.detail).not.toContain("pass");
      expect(result.detail).not.toContain("SECRET");
    }
  });
});
