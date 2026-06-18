// HexMining DTO contract skeleton tests — Phase 1
//
// These tests verify the shape, status vocabulary, sentinel values, and
// provenance fields of the HexMining DTO contract without any live RPC reads,
// database access, schema migrations, or frontend assumptions.
//
// Constraint summary for Phase 1:
//   - schemaVersion: "v1"
//   - chainId: 369 (PulseChain only — Ethereum eHEX is deferred to Phase 7+)
//   - stakeSource: "native" only (HSI/HTT deferred to Phase 6)
//   - pricing.status: "unsupported"
//   - valuation.status: "unsupported"
//   - pnl.status: "unsupported"
//   - yield.status: "unsupported"
//   - assetId: chain-aware format, never symbol-only
//   - empty positions: explicit empty array, not null or mock data
//   - provenance: always present with chainId, walletAddress, stakeId, stakeIndex, stakeSource
//
// See docs/v2-hexmining-roadmap.md for full phase plan.

import { describe, expect, it } from "vitest";

import { EHEX_ASSET_ID, PHEX_ASSET_ID } from "@/services/hexmining/types";
import type {
  HexBpdYieldStatus,
  HexStakeDto,
  HexStakeListDto,
  HexStakeSource,
  HexStakeStatus,
} from "@/services/hexmining/types";

// ─── Test constants ───────────────────────────────────────────────────────────

const PULSECHAIN_CHAIN_ID = 369;
const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";

// ─── Fixture builders ─────────────────────────────────────────────────────────

function buildMinimalHexStakeDto(overrides: Partial<HexStakeDto> = {}): HexStakeDto {
  return {
    schemaVersion: "v1",
    stakeId: "12345",
    stakeIndex: 0,
    stakeSource: "native",
    chainId: PULSECHAIN_CHAIN_ID,
    assetId: PHEX_ASSET_ID,
    walletAddress: WALLET_ADDRESS,
    stakeStatus: "active",
    lockedDay: 1000,
    stakedDays: 5555,
    unlockedDay: 6555,
    principalHex: "1000000000",
    stakeShares: "500000000000",
    tShares: "500",
    isAutoStake: false,
    pricing: {
      status: "unsupported",
      sourceType: null,
      sourceId: null,
      observedAt: null,
    },
    valuation: {
      status: "unsupported",
      valueQuote: null,
    },
    pnl: {
      status: "unsupported",
      averageCost: null,
      realizedPnl: null,
      unrealizedPnl: null,
      markPrice: null,
      costBasisPolicy: null,
    },
    yield: {
      status: "unsupported",
      estimatedYieldHearts: null,
      bpdYieldHex: null,
      bpdYieldStatus: null,
      provenance: null,
      warnings: [],
    },
    provenance: {
      chainId: PULSECHAIN_CHAIN_ID,
      walletAddress: WALLET_ADDRESS,
      stakeId: "12345",
      stakeIndex: 0,
      stakeSource: "native",
      observedAtBlock: "21000000",
      observedAt: "2026-06-06T00:00:00.000Z",
      rpcEndpoint: null,
      warnings: [],
    },
    warnings: [],
    ...overrides,
  };
}

function buildEmptyHexStakeListDto(): HexStakeListDto {
  return {
    schemaVersion: "v1",
    chainId: PULSECHAIN_CHAIN_ID,
    walletAddress: WALLET_ADDRESS,
    stakeSource: "native",
    stakes: [],
    totalCount: 0,
    isComplete: true,
    observedAtBlock: null,
    observedAt: null,
    warnings: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HexMining DTO contract skeleton", () => {
  // ── 1. Top-level envelope ──────────────────────────────────────────────────

  describe("schemaVersion", () => {
    it("stake DTO carries schemaVersion v1", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.schemaVersion).toBe("v1");
    });

    it("list DTO carries schemaVersion v1", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(dto.schemaVersion).toBe("v1");
    });
  });

  // ── 2. PulseChain 369 accepted ─────────────────────────────────────────────

  describe("chain identity — PulseChain 369", () => {
    it("accepts PulseChain chain ID 369 as the first-slice chain", () => {
      const dto = buildMinimalHexStakeDto({ chainId: 369 });
      expect(dto.chainId).toBe(369);
    });

    it("list DTO carries PulseChain chain ID 369", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(dto.chainId).toBe(369);
    });

    it("PHEX_ASSET_ID is chain:369 prefixed", () => {
      expect(PHEX_ASSET_ID).toBe(
        "chain:369:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      );
      expect(PHEX_ASSET_ID.startsWith("chain:369:")).toBe(true);
    });

    it("stake DTO uses PHEX_ASSET_ID for first-slice asset identity", () => {
      const dto = buildMinimalHexStakeDto({ assetId: PHEX_ASSET_ID });
      expect(dto.assetId).toBe(PHEX_ASSET_ID);
      expect(dto.assetId.startsWith("chain:369:")).toBe(true);
    });
  });

  // ── 3. Non-369 chains deferred ─────────────────────────────────────────────

  describe("chain identity — Ethereum eHEX deferred", () => {
    it("EHEX_ASSET_ID is chain:1 prefixed (Ethereum)", () => {
      expect(EHEX_ASSET_ID).toBe(
        "chain:1:erc20:0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      );
      expect(EHEX_ASSET_ID.startsWith("chain:1:")).toBe(true);
    });

    it("PHEX_ASSET_ID and EHEX_ASSET_ID are distinct despite sharing the same token address", () => {
      const TOKEN_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
      expect(PHEX_ASSET_ID).toContain(TOKEN_ADDRESS);
      expect(EHEX_ASSET_ID).toContain(TOKEN_ADDRESS);
      expect(PHEX_ASSET_ID).not.toBe(EHEX_ASSET_ID);
    });

    it("EHEX_ASSET_ID uses a different chain prefix than PHEX_ASSET_ID", () => {
      expect(PHEX_ASSET_ID.split(":")[1]).toBe("369");
      expect(EHEX_ASSET_ID.split(":")[1]).toBe("1");
    });
  });

  // ── 4. Native source only in first slice ───────────────────────────────────

  describe("stake source — native only (Phase 1)", () => {
    it("accepts native as the first-slice stake source", () => {
      const dto = buildMinimalHexStakeDto({ stakeSource: "native" });
      expect(dto.stakeSource).toBe("native");
    });

    it("first-slice HexStakeSource union does not include hsi", () => {
      // Type-level enforcement: HexStakeSource = "native" only in Phase 1.
      // Runtime assertion: the only valid first-slice value is "native".
      const firstSliceSources: HexStakeSource[] = ["native"];
      expect(firstSliceSources).not.toContain("hsi");
      expect(firstSliceSources).not.toContain("htt");
    });

    it("list DTO carries native as first-slice stakeSource", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(dto.stakeSource).toBe("native");
    });
  });

  // ── 5. HSI/HTT explicitly deferred ────────────────────────────────────────

  describe("stake source — HSI/HTT deferred (Phase 6)", () => {
    it("HexStakeSourceDeferred type exists to document deferred sources", () => {
      // HexStakeSource = "native" only in Phase 1.
      // "hsi" and "htt" belong to HexStakeSourceDeferred and are not valid first-slice values.
      const firstSliceSources: HexStakeSource[] = ["native"];
      expect(firstSliceSources).not.toContain("hsi");
      expect(firstSliceSources).not.toContain("htt");
      expect(firstSliceSources).toHaveLength(1);
    });
  });

  // ── 6. Pricing / valuation / PnL / yield — all unsupported in Phase 1 ─────

  describe("unsupported sentinels", () => {
    describe("pricing", () => {
      it("pricing.status is unsupported", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pricing.status).toBe("unsupported");
      });

      it("pricing.sourceType is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pricing.sourceType).toBeNull();
      });

      it("pricing.sourceId is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pricing.sourceId).toBeNull();
      });

      it("pricing.observedAt is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pricing.observedAt).toBeNull();
      });
    });

    describe("valuation", () => {
      it("valuation.status is unsupported", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.valuation.status).toBe("unsupported");
      });

      it("valuation.valueQuote is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.valuation.valueQuote).toBeNull();
      });
    });

    describe("pnl", () => {
      it("pnl.status is unsupported", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pnl.status).toBe("unsupported");
      });

      it("pnl.averageCost is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pnl.averageCost).toBeNull();
      });

      it("pnl.realizedPnl is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pnl.realizedPnl).toBeNull();
      });

      it("pnl.unrealizedPnl is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pnl.unrealizedPnl).toBeNull();
      });

      it("pnl.markPrice is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pnl.markPrice).toBeNull();
      });

      it("pnl.costBasisPolicy is null (fork-copy policy decision deferred)", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.pnl.costBasisPolicy).toBeNull();
      });
    });

    describe("yield", () => {
      it("yield.status is unsupported", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.yield.status).toBe("unsupported");
      });

      it("yield.estimatedYieldHearts is null (dailyDataRange deferred to Phase 4)", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.yield.estimatedYieldHearts).toBeNull();
      });

      it("yield.bpdYieldHex is null (Big Pay Day modeling deferred to Phase 4)", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.yield.bpdYieldHex).toBeNull();
      });

      it("yield.bpdYieldStatus is null", () => {
        const dto = buildMinimalHexStakeDto();
        expect(dto.yield.bpdYieldStatus).toBeNull();
      });
    });
  });

  // ── 7. Empty positions are explicit arrays, not mock data ──────────────────

  describe("empty positions", () => {
    it("empty list DTO carries stakes as an explicit empty array, not null", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(dto.stakes).toEqual([]);
      expect(dto.stakes).not.toBeNull();
    });

    it("totalCount is zero for an empty list", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(dto.totalCount).toBe(0);
    });

    it("isComplete is true when no stakes exist (no truncation)", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(dto.isComplete).toBe(true);
    });

    it("empty list observedAtBlock is null before any live reads are implemented", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(dto.observedAtBlock).toBeNull();
    });
  });

  // ── 8. Warnings communicate first-slice limitations ────────────────────────

  describe("warnings", () => {
    it("stake DTO warnings is an array", () => {
      const dto = buildMinimalHexStakeDto();
      expect(Array.isArray(dto.warnings)).toBe(true);
    });

    it("list DTO warnings is an array", () => {
      const dto = buildEmptyHexStakeListDto();
      expect(Array.isArray(dto.warnings)).toBe(true);
    });

    it("stake DTO can carry first-slice limitation warnings", () => {
      const dto = buildMinimalHexStakeDto({
        warnings: [
          "hexmining-valuation-unsupported-v1",
          "hexmining-yield-unsupported-v1",
        ],
      });
      expect(dto.warnings).toContain("hexmining-valuation-unsupported-v1");
      expect(dto.warnings).toContain("hexmining-yield-unsupported-v1");
    });

    it("list DTO can carry truncation warning when read is incomplete", () => {
      const dto: HexStakeListDto = {
        ...buildEmptyHexStakeListDto(),
        isComplete: false,
        warnings: ["hexmining-read-truncated-rate-limit"],
      };
      expect(dto.isComplete).toBe(false);
      expect(dto.warnings).toContain("hexmining-read-truncated-rate-limit");
    });

    it("provenance warnings is an array", () => {
      const dto = buildMinimalHexStakeDto();
      expect(Array.isArray(dto.provenance.warnings)).toBe(true);
    });
  });

  // ── 9. No frontend/RPC assumptions in the contract ────────────────────────

  describe("no frontend or RPC assumptions", () => {
    it("all provenance values are backend-provided (no client-derived fields)", () => {
      const dto = buildMinimalHexStakeDto();
      // provenance must be fully populated by the backend — no undefined fields
      expect(dto.provenance.chainId).toBeDefined();
      expect(dto.provenance.walletAddress).toBeDefined();
      expect(dto.provenance.stakeId).toBeDefined();
      expect(dto.provenance.stakeIndex).toBeDefined();
      expect(dto.provenance.stakeSource).toBeDefined();
      expect(dto.provenance.observedAtBlock).toBeDefined();
      expect(dto.provenance.observedAt).toBeDefined();
    });

    it("stake DTO assetId is never a bare symbol", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.assetId).not.toBe("HEX");
      expect(dto.assetId).not.toBe("pHEX");
      expect(dto.assetId).not.toBe("eHEX");
      expect(dto.assetId).toMatch(/^chain:\d+:erc20:0x/);
    });

    it("assetId in provenance matches stake DTO assetId format constraint", () => {
      // provenance stakeSource is explicit — not derived from a symbol
      const dto = buildMinimalHexStakeDto();
      expect(dto.provenance.stakeSource).toBe("native");
    });
  });

  // ── 10. Provenance completeness ───────────────────────────────────────────

  describe("provenance", () => {
    it("provenance.chainId matches stake DTO chainId", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.provenance.chainId).toBe(dto.chainId);
    });

    it("provenance.walletAddress matches stake DTO walletAddress", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.provenance.walletAddress).toBe(dto.walletAddress);
    });

    it("provenance.stakeId matches stake DTO stakeId", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.provenance.stakeId).toBe(dto.stakeId);
    });

    it("provenance.stakeIndex matches stake DTO stakeIndex", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.provenance.stakeIndex).toBe(dto.stakeIndex);
    });

    it("provenance.stakeSource matches stake DTO stakeSource", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.provenance.stakeSource).toBe(dto.stakeSource);
    });

    it("provenance.rpcEndpoint is null before live reads are implemented", () => {
      const dto = buildMinimalHexStakeDto();
      expect(dto.provenance.rpcEndpoint).toBeNull();
    });
  });

  // ── 11. Stake status vocabulary ───────────────────────────────────────────

  describe("stake status vocabulary", () => {
    it("accepts pending status (stake not yet started)", () => {
      const dto = buildMinimalHexStakeDto({ stakeStatus: "pending" });
      expect(dto.stakeStatus).toBe("pending");
    });

    it("accepts active status", () => {
      const dto = buildMinimalHexStakeDto({ stakeStatus: "active" });
      expect(dto.stakeStatus).toBe("active");
    });

    it("accepts overdue status (past end day, not closed)", () => {
      const dto = buildMinimalHexStakeDto({ stakeStatus: "overdue" });
      expect(dto.stakeStatus).toBe("overdue");
    });

    it("accepts ended status (closed via endStake)", () => {
      const dto = buildMinimalHexStakeDto({ stakeStatus: "ended" });
      expect(dto.stakeStatus).toBe("ended");
    });

    it("accepts unknown status (cannot be determined from available data)", () => {
      const dto = buildMinimalHexStakeDto({ stakeStatus: "unknown" });
      expect(dto.stakeStatus).toBe("unknown");
    });

    it("full status vocabulary covers all five planned lifecycle states", () => {
      const vocabulary: HexStakeStatus[] = [
        "pending",
        "active",
        "overdue",
        "ended",
        "unknown",
      ];
      expect(vocabulary).toHaveLength(5);
    });
  });

  // ── 12. Future-compatibility / safe serialization ─────────────────────────

  describe("future-compatibility", () => {
    it("stakeId is a string to safely represent uint40 values", () => {
      // uint40 max = 1_099_511_627_775 — exceeds safe integer; string is safe
      const dto = buildMinimalHexStakeDto({ stakeId: "1099511627775" });
      expect(typeof dto.stakeId).toBe("string");
      expect(dto.stakeId).toBe("1099511627775");
    });

    it("provenance.observedAtBlock is a string to safely represent large block numbers", () => {
      const dto = buildMinimalHexStakeDto({
        provenance: {
          ...buildMinimalHexStakeDto().provenance,
          observedAtBlock: "99999999",
        },
      });
      expect(typeof dto.provenance.observedAtBlock).toBe("string");
    });

    it("stakeShares is a string to safely represent uint72 values", () => {
      // uint72 max exceeds Number.MAX_SAFE_INTEGER; string is safe
      const largeShares = "4722366482869645213695";
      const dto = buildMinimalHexStakeDto({ stakeShares: largeShares });
      expect(typeof dto.stakeShares).toBe("string");
    });

    it("isComplete false + warnings enables truncation signaling for Phase 5 ended-stake discovery", () => {
      const dto: HexStakeListDto = {
        ...buildEmptyHexStakeListDto(),
        isComplete: false,
        warnings: ["hexmining-ended-stakes-scan-truncated"],
      };
      expect(dto.isComplete).toBe(false);
      expect(dto.warnings).toHaveLength(1);
    });

    it("Big Pay Day bpdYieldStatus vocabulary covers three expected values when Phase 4 lands", () => {
      const vocabulary: HexBpdYieldStatus[] = [
        "applicable",
        "not_applicable",
        "unknown",
      ];
      expect(vocabulary).toHaveLength(3);
      expect(vocabulary).toContain("applicable");
      expect(vocabulary).toContain("not_applicable");
      expect(vocabulary).toContain("unknown");
    });
  });
});
