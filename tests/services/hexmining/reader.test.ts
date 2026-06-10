import { describe, expect, it, vi } from "vitest";

import { readNativeHexStakes } from "@/services/hexmining/reader";
import type { HexMiningReadClient } from "@/services/hexmining/reader";
import { PHEX_ASSET_ID } from "@/services/hexmining/types";

// ─── Test constants ───────────────────────────────────────────────────────────

const WALLET = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 369;
const DEFAULT_BLOCK = 21_000_000n;
const DEFAULT_CURRENT_DAY = 5_000n;

// Nominal stake: lockedDay=1000, stakedDays=5555
// active when currentDay=5000: 1000 <= 5000 < 1000+5555=6555
const NOMINAL_STAKE = [42n, 100_000_000n, 500_000_000_000n, 1000, 5555, 0, false] as const;

// ─── Client factory ───────────────────────────────────────────────────────────

type MockReadContractArgs = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

function makeDefaultReadContract() {
  return async ({ functionName }: MockReadContractArgs): Promise<unknown> => {
    if (functionName === "stakeCount") return 1n;
    if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
    if (functionName === "stakeLists") return NOMINAL_STAKE;
    throw new Error(`unexpected function: ${functionName}`);
  };
}

function makeClient(opts?: {
  readContract?: (args: MockReadContractArgs) => Promise<unknown>;
  getBlockNumber?: () => Promise<bigint>;
}): HexMiningReadClient {
  return {
    getBlockNumber: vi.fn(opts?.getBlockNumber ?? (async () => DEFAULT_BLOCK)),
    readContract: vi.fn(opts?.readContract ?? makeDefaultReadContract()),
  } as unknown as HexMiningReadClient;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("readNativeHexStakes", () => {
  // ── 1. Empty list ─────────────────────────────────────────────────────────

  it("returns empty complete list when wallet has no active stakes", async () => {
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 0n;
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.stakes).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.isComplete).toBe(true);
    expect(result.warnings.some((w) => w.includes("stake-count"))).toBe(false);
  });

  // ── 2. Nominal read — all fields ──────────────────────────────────────────

  it("reads a single active native pHEX stake and maps all fields", async () => {
    const asOf = new Date("2026-06-06T00:00:00.000Z");
    const client = makeClient();
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      asOf,
    });

    expect(result.stakes).toHaveLength(1);
    const stake = result.stakes[0];

    expect(stake.schemaVersion).toBe("v1");
    expect(stake.stakeId).toBe("42");
    expect(stake.stakeIndex).toBe(0);
    expect(stake.stakeSource).toBe("native");
    expect(stake.chainId).toBe(369);
    expect(stake.assetId).toBe(PHEX_ASSET_ID);
    expect(stake.walletAddress).toBe(WALLET.toLowerCase());
    expect(stake.stakeStatus).toBe("active");
    expect(stake.lockedDay).toBe(1000);
    expect(stake.stakedDays).toBe(5555);
    expect(stake.unlockedDay).toBeNull();
    expect(stake.principalHex).toBe("1.00000000"); // 100_000_000 / 10^8
    expect(stake.stakeShares).toBe("500000000000");
    expect(stake.tShares).toBe("0.5"); // 500_000_000_000 / 1_000_000_000_000
    expect(stake.isAutoStake).toBe(false);
    expect(result.isComplete).toBe(true);
    expect(result.observedAtBlock).toBe(DEFAULT_BLOCK.toString());
    expect(result.observedAt).toBe("2026-06-06T00:00:00.000Z");
  });

  // ── 3. Pending status ─────────────────────────────────────────────────────

  it("derives pending status when lockedDay > currentDay", async () => {
    // lockedDay=6000 > currentDay=5000 → pending
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 1n;
        if (functionName === "currentDay") return 5_000n;
        if (functionName === "stakeLists") return [42n, 100_000_000n, 500_000_000_000n, 6000, 365, 0, false];
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.stakes[0].stakeStatus).toBe("pending");
  });

  // ── 4. Overdue status ─────────────────────────────────────────────────────

  it("derives overdue status when currentDay >= lockedDay + stakedDays", async () => {
    // lockedDay=1000, stakedDays=365, endDay=1365; currentDay=2000 >= 1365 → overdue
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 1n;
        if (functionName === "currentDay") return 2_000n;
        if (functionName === "stakeLists") return [42n, 100_000_000n, 500_000_000_000n, 1000, 365, 0, false];
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.stakes[0].stakeStatus).toBe("overdue");
  });

  // ── 5. stakeCount throws ──────────────────────────────────────────────────

  it("returns isComplete false with classified warning when stakeCount throws", async () => {
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") throw new Error("too many requests");
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.stakes).toEqual([]);
    expect(result.isComplete).toBe(false);
    expect(result.warnings.some((w) => w.startsWith("hexmining-stake-count-rpc-"))).toBe(true);
    // "too many requests" → classifyRpcFailure → rate_limited
    expect(result.warnings).toContain("hexmining-stake-count-rpc-rate_limited");
  });

  // ── 6. currentDay throws ──────────────────────────────────────────────────

  it("returns stakeStatus unknown with warning when currentDay throws", async () => {
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 1n;
        if (functionName === "currentDay") throw new Error("RPC unavailable");
        if (functionName === "stakeLists") return NOMINAL_STAKE;
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.stakes).toHaveLength(1);
    expect(result.stakes[0].stakeStatus).toBe("unknown");
    expect(result.warnings).toContain("hexmining-current-day-unavailable");
    expect(result.isComplete).toBe(true);
  });

  // ── 7. stakeLists fails at one index ──────────────────────────────────────

  it("returns isComplete false and includes successfully read stakes when stakeLists fails at one index", async () => {
    const client = makeClient({
      readContract: async ({ functionName, args: contractArgs }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 2n;
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        if (functionName === "stakeLists") {
          const stakeIndex = (contractArgs as [unknown, bigint])[1];
          if (stakeIndex === 1n) throw new Error("RPC error at index 1");
          return NOMINAL_STAKE;
        }
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.stakes).toHaveLength(1);
    expect(result.stakes[0].stakeIndex).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain("hexmining-read-failed-stake-at-index-1");
  });

  // ── 8. Unsupported chain ──────────────────────────────────────────────────

  it("returns unsupported-chain warning and empty stakes for chainId !== 369, with no contract calls", async () => {
    const readContractMock = vi.fn();
    const getBlockNumberMock = vi.fn();
    const client: HexMiningReadClient = {
      getBlockNumber: getBlockNumberMock as unknown as () => Promise<bigint>,
      readContract: readContractMock as unknown as HexMiningReadClient["readContract"],
    };
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: 1,
    });
    expect(result.stakes).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain("hexmining-unsupported-chain-1");
    expect(readContractMock).not.toHaveBeenCalled();
    expect(getBlockNumberMock).not.toHaveBeenCalled();
  });

  // ── 9. assetId is PHEX_ASSET_ID ───────────────────────────────────────────

  it("stake assetId is PHEX_ASSET_ID and never a bare symbol", async () => {
    const client = makeClient();
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    const { assetId } = result.stakes[0];
    expect(assetId).toBe(PHEX_ASSET_ID);
    expect(assetId).not.toBe("HEX");
    expect(assetId).not.toBe("pHEX");
    expect(assetId).not.toBe("eHEX");
    expect(assetId).toMatch(/^chain:\d+:erc20:0x/);
  });

  // ── 10. stakeId serialized as string ─────────────────────────────────────

  it("serializes stakeId as string", async () => {
    const UINT40_MAX = 1_099_511_627_775n;
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 1n;
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        if (functionName === "stakeLists") return [UINT40_MAX, 100_000_000n, 500_000_000_000n, 1000, 5555, 0, false];
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(typeof result.stakes[0].stakeId).toBe("string");
    expect(result.stakes[0].stakeId).toBe("1099511627775");
  });

  // ── 11. stakeShares serialized as string ──────────────────────────────────

  it("serializes stakeShares as string", async () => {
    const LARGE_SHARES = 4_722_366_482_869_645_213_695n; // uint72 max
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 1n;
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        if (functionName === "stakeLists") return [42n, 100_000_000n, LARGE_SHARES, 1000, 5555, 0, false];
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(typeof result.stakes[0].stakeShares).toBe("string");
    expect(result.stakes[0].stakeShares).toBe("4722366482869645213695");
    // 4722366482869645213695 / 1e12 = 4722366482.869645213695 → 6dp ROUND_HALF_UP
    expect(result.stakes[0].tShares).toBe("4722366482.869645");
  });

  // ── 12. Unsupported sentinels ─────────────────────────────────────────────

  it("pricing, valuation, pnl, and yield are all status unsupported with null fields", async () => {
    const client = makeClient();
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    const stake = result.stakes[0];

    expect(stake.pricing.status).toBe("unsupported");
    expect(stake.pricing.sourceType).toBeNull();
    expect(stake.pricing.sourceId).toBeNull();
    expect(stake.pricing.observedAt).toBeNull();

    expect(stake.valuation.status).toBe("unsupported");
    expect(stake.valuation.valueQuote).toBeNull();

    expect(stake.pnl.status).toBe("unsupported");
    expect(stake.pnl.averageCost).toBeNull();
    expect(stake.pnl.realizedPnl).toBeNull();
    expect(stake.pnl.unrealizedPnl).toBeNull();
    expect(stake.pnl.markPrice).toBeNull();
    expect(stake.pnl.costBasisPolicy).toBeNull();

    expect(stake.yield.status).toBe("unsupported");
    expect(stake.yield.estimatedYieldHex).toBeNull();
    expect(stake.yield.bpdYieldHex).toBeNull();
    expect(stake.yield.bpdYieldStatus).toBeNull();
  });

  // ── 13. Provenance completeness ───────────────────────────────────────────

  it("provenance carries chainId, walletAddress, stakeId, stakeIndex, stakeSource, observedAtBlock, observedAt", async () => {
    const asOf = new Date("2026-06-06T00:00:00.000Z");
    const client = makeClient();
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      asOf,
    });
    const { provenance } = result.stakes[0];

    expect(provenance.chainId).toBe(369);
    expect(provenance.walletAddress).toBe(WALLET.toLowerCase());
    expect(provenance.stakeId).toBe("42");
    expect(provenance.stakeIndex).toBe(0);
    expect(provenance.stakeSource).toBe("native");
    expect(provenance.observedAtBlock).toBe(DEFAULT_BLOCK.toString());
    expect(provenance.observedAt).toBe("2026-06-06T00:00:00.000Z");
    expect(provenance.rpcEndpoint).toBeNull();
    expect(Array.isArray(provenance.warnings)).toBe(true);
  });

  // ── 14. getBlockNumber throws ────────────────────────────────────────────

  it("returns observedAtBlock null with warning when getBlockNumber throws", async () => {
    const client = makeClient({
      getBlockNumber: async () => {
        throw new Error("getBlockNumber timeout");
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.observedAtBlock).toBeNull();
    expect(result.warnings).toContain("hexmining-provenance-block-unavailable");
    // Stakes are still read despite block number failure
    expect(result.stakes).toHaveLength(1);
    expect(result.isComplete).toBe(true);
    // Per-stake provenance uses "unknown" sentinel (type requires string, not null)
    expect(result.stakes[0].provenance.observedAtBlock).toBe("unknown");
  });

  // ── 15. Multiple stakes in stakeIndex order ───────────────────────────────

  it("returns stakes sorted by stakeIndex ascending for multiple stakes", async () => {
    let stakeListsCallCount = 0;
    const client = makeClient({
      readContract: async ({ functionName }: MockReadContractArgs) => {
        if (functionName === "stakeCount") return 3n;
        if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
        if (functionName === "stakeLists") {
          const idx = stakeListsCallCount++;
          return [BigInt(idx + 10), 100_000_000n, 500_000_000_000n, 1000, 5555, 0, false];
        }
        throw new Error(`unexpected function: ${functionName}`);
      },
    });
    const result = await readNativeHexStakes({
      publicClient: client,
      walletAddress: WALLET,
      chainId: CHAIN_ID,
    });
    expect(result.stakes).toHaveLength(3);
    expect(result.stakes[0].stakeIndex).toBe(0);
    expect(result.stakes[1].stakeIndex).toBe(1);
    expect(result.stakes[2].stakeIndex).toBe(2);
    expect(result.isComplete).toBe(true);
  });

  // ── Yield gate — gated estimator result preserved at reader layer ──────────

  describe("yield gate — reader output never exposes estimated yield", () => {
    // 16. BPD-era stake: elapsed range spans protocol day 353 (Big Pay Day).
    // Reader has no estimator connection — yield must remain unsupported regardless.
    it("yield gate preserved for BPD-era stake whose elapsed range spans protocol day 353", async () => {
      const client = makeClient({
        readContract: async ({ functionName }: MockReadContractArgs) => {
          if (functionName === "stakeCount") return 1n;
          if (functionName === "currentDay") return 400n;
          // lockedDay=300, stakedDays=200 → elapsed range [300, 399] includes BPD day 353
          if (functionName === "stakeLists")
            return [42n, 100_000_000n, 500_000_000_000n, 300, 200, 0, false];
          throw new Error(`unexpected function: ${functionName}`);
        },
      });
      const result = await readNativeHexStakes({
        publicClient: client,
        walletAddress: WALLET,
        chainId: CHAIN_ID,
      });
      const stake = result.stakes[0];
      expect(stake.yield.status).toBe("unsupported");
      expect(stake.yield.estimatedYieldHex).toBeNull();
      expect(stake.yield.bpdYieldHex).toBeNull();
      expect(stake.yield.bpdYieldStatus).toBeNull();
    });

    // 17. Overdue stake: elapsed days are fully resolved but yield must stay gated.
    it("yield gate preserved for overdue stake where currentDay exceeds locked end day", async () => {
      const client = makeClient({
        readContract: async ({ functionName }: MockReadContractArgs) => {
          if (functionName === "stakeCount") return 1n;
          if (functionName === "currentDay") return 2000n;
          // overdue: currentDay(2000) >= lockedDay(1000) + stakedDays(365) = 1365
          if (functionName === "stakeLists")
            return [42n, 100_000_000n, 500_000_000_000n, 1000, 365, 0, false];
          throw new Error(`unexpected function: ${functionName}`);
        },
      });
      const result = await readNativeHexStakes({
        publicClient: client,
        walletAddress: WALLET,
        chainId: CHAIN_ID,
      });
      expect(result.stakes[0].stakeStatus).toBe("overdue");
      const stake = result.stakes[0];
      expect(stake.yield.status).toBe("unsupported");
      expect(stake.yield.estimatedYieldHex).toBeNull();
      expect(stake.yield.bpdYieldHex).toBeNull();
      expect(stake.yield.bpdYieldStatus).toBeNull();
    });

    // 18. currentDay unavailable: stakeStatus unknown, but yield gate must still hold.
    it("yield gate preserved when currentDay is unavailable and stakeStatus is unknown", async () => {
      const client = makeClient({
        readContract: async ({ functionName }: MockReadContractArgs) => {
          if (functionName === "stakeCount") return 1n;
          if (functionName === "currentDay") throw new Error("RPC unavailable");
          if (functionName === "stakeLists") return NOMINAL_STAKE;
          throw new Error(`unexpected function: ${functionName}`);
        },
      });
      const result = await readNativeHexStakes({
        publicClient: client,
        walletAddress: WALLET,
        chainId: CHAIN_ID,
      });
      expect(result.stakes[0].stakeStatus).toBe("unknown");
      const stake = result.stakes[0];
      expect(stake.yield.status).toBe("unsupported");
      expect(stake.yield.estimatedYieldHex).toBeNull();
      expect(stake.yield.bpdYieldHex).toBeNull();
      expect(stake.yield.bpdYieldStatus).toBeNull();
    });

    // 19. Multi-stake: yield gate preserved across every stake in the list.
    it("yield gate preserved for every stake in a multi-stake response", async () => {
      let callCount = 0;
      const client = makeClient({
        readContract: async ({ functionName }: MockReadContractArgs) => {
          if (functionName === "stakeCount") return 3n;
          if (functionName === "currentDay") return DEFAULT_CURRENT_DAY;
          if (functionName === "stakeLists") {
            const idx = callCount++;
            return [BigInt(idx + 10), 100_000_000n, 500_000_000_000n, 1000, 5555, 0, false];
          }
          throw new Error(`unexpected function: ${functionName}`);
        },
      });
      const result = await readNativeHexStakes({
        publicClient: client,
        walletAddress: WALLET,
        chainId: CHAIN_ID,
      });
      expect(result.stakes).toHaveLength(3);
      for (const stake of result.stakes) {
        expect(stake.yield.status).toBe("unsupported");
        expect(stake.yield.estimatedYieldHex).toBeNull();
        expect(stake.yield.bpdYieldHex).toBeNull();
        expect(stake.yield.bpdYieldStatus).toBeNull();
      }
    });

    // 20. Regression: serialized yield block must not contain "estimated" or non-null estimatedYieldHex.
    it("regression: serialized stake yield block contains no estimated status and no non-null estimatedYieldHex", async () => {
      const client = makeClient();
      const result = await readNativeHexStakes({
        publicClient: client,
        walletAddress: WALLET,
        chainId: CHAIN_ID,
      });
      const stake = result.stakes[0];
      const yieldSerialized = JSON.stringify(stake.yield);
      expect(yieldSerialized).not.toContain('"estimated"');
      expect(yieldSerialized).not.toContain('"evidence_available"');
      const parsed = JSON.parse(yieldSerialized) as { estimatedYieldHex: unknown };
      expect(parsed.estimatedYieldHex).toBeNull();
    });
  });
});
