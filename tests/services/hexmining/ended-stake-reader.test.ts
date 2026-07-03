// HexMining Phase 5 Slice 3 — ended stake reader tests
//
// Verifies readEndedHexStakes assembles EndedHexStakeListDto from persisted
// RawEndedHexStakeObservation rows with no live DB or RPC:
//
//   1. Returns empty list DTO when no rows exist.
//   2. Maps a complete observation to DTO fields exactly.
//   3. Maps an incomplete observation (isComplete: false, warnings set).
//   4. Preserves null nullable fields as null.
//   5. Filters by chainId and walletAddress (scoped read).
//   6. List isComplete is false when any row is incomplete.
//   7. List isComplete is true when all rows are complete.
//   8. Returns rows in endBlockNumber ascending order (delegated to store).
//   9. bigint fields serialized as decimal strings.

import { describe, expect, it } from "vitest";

import { readEndedHexStakes } from "@/services/hexmining/ended-stake-reader";
import type { EndedHexStakeListDto } from "@/services/hexmining/types";
import type { PersistedEndedHexStakeObservation } from "@/services/hexmining/ended-stake-observation-store";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

function makeMockClient(rows: PersistedEndedHexStakeObservation[]) {
  return {
    rawEndedHexStakeObservation: {
      async findMany(args: {
        where: { chainId: number; walletAddress: string };
        orderBy: unknown[];
      }) {
        return rows
          .filter(
            (r) =>
              r.chainId === args.where.chainId &&
              r.walletAddress === args.where.walletAddress,
          )
          .sort((a, b) => (a.endBlockNumber < b.endBlockNumber ? -1 : a.endBlockNumber > b.endBlockNumber ? 1 : 0));
      },
    },
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OBSERVED_AT = new Date("2026-06-14T12:00:00Z");

const COMPLETE_ROW: PersistedEndedHexStakeObservation = {
  id: "obs-1",
  chainId: 369,
  walletAddress: "0xwallet",
  stakeId: "942663",
  stakeIndex: 0,
  stakedDays: 5555,
  lockedDay: 2310,
  stakeShares: "1414291579679",
  principalHex: "1000000000000000",
  yieldHex: "20589444841",
  penaltyHex: null,
  endTxHash: "0xabc123",
  endBlockNumber: 21000000n,
  startTxHash: "0xdef456",
  startBlockNumber: 18000000n,
  discoveryMethod: "raw_stake_action",
  observedAt: OBSERVED_AT,
  isComplete: true,
  warnings: [],
  createdAt: new Date("2026-06-29T00:00:00Z"),
};

const INCOMPLETE_ROW: PersistedEndedHexStakeObservation = {
  ...COMPLETE_ROW,
  id: "obs-2",
  stakeId: "999999",
  lockedDay: null,
  stakeShares: null,
  stakeIndex: null,
  principalHex: null,
  yieldHex: null,
  startTxHash: null,
  startBlockNumber: null,
  isComplete: false,
  warnings: ["hexmining-ended-stake-lockedday-unknown"],
  endBlockNumber: 22000000n,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("readEndedHexStakes", () => {
  it("returns empty list DTO when no rows exist", async () => {
    const client = makeMockClient([]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.schemaVersion).toBe("v1");
    expect(result.chainId).toBe(369);
    expect(result.walletAddress).toBe("0xwallet");
    expect(result.stakes).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.isComplete).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("maps a complete observation to DTO fields exactly", async () => {
    const client = makeMockClient([COMPLETE_ROW]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.totalCount).toBe(1);
    expect(result.isComplete).toBe(true);

    const stake = result.stakes[0];
    expect(stake.schemaVersion).toBe("v1");
    expect(stake.id).toBe("obs-1");
    expect(stake.chainId).toBe(369);
    expect(stake.walletAddress).toBe("0xwallet");
    expect(stake.stakeId).toBe("942663");
    expect(stake.stakeIndex).toBe(0);
    expect(stake.stakedDays).toBe(5555);
    expect(stake.lockedDay).toBe(2310);
    expect(stake.stakeShares).toBe("1414291579679");
    expect(stake.principalHex).toBe("1000000000000000");
    expect(stake.yieldHex).toBe("20589444841");
    expect(stake.penaltyHex).toBeNull();
    expect(stake.endTxHash).toBe("0xabc123");
    expect(stake.endBlockNumber).toBe("21000000");
    expect(stake.startTxHash).toBe("0xdef456");
    expect(stake.startBlockNumber).toBe("18000000");
    expect(stake.discoveryMethod).toBe("raw_stake_action");
    expect(stake.observedAt).toBe(OBSERVED_AT.toISOString());
    expect(stake.isComplete).toBe(true);
    expect(stake.warnings).toEqual([]);
  });

  it("maps an incomplete observation correctly", async () => {
    const client = makeMockClient([INCOMPLETE_ROW]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.isComplete).toBe(false);
    const stake = result.stakes[0];
    expect(stake.isComplete).toBe(false);
    expect(stake.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });

  it("preserves null nullable fields as null", async () => {
    const client = makeMockClient([INCOMPLETE_ROW]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    const stake = result.stakes[0];
    expect(stake.lockedDay).toBeNull();
    expect(stake.stakeShares).toBeNull();
    expect(stake.stakeIndex).toBeNull();
    expect(stake.principalHex).toBeNull();
    expect(stake.yieldHex).toBeNull();
    expect(stake.startTxHash).toBeNull();
    expect(stake.startBlockNumber).toBeNull();
  });

  it("serializes bigint fields as decimal strings", async () => {
    const client = makeMockClient([COMPLETE_ROW]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    const stake = result.stakes[0];
    expect(typeof stake.endBlockNumber).toBe("string");
    expect(stake.endBlockNumber).toBe("21000000");
    expect(typeof stake.startBlockNumber).toBe("string");
    expect(stake.startBlockNumber).toBe("18000000");
  });

  it("filters by chainId — excludes rows from other chains", async () => {
    const otherChainRow: PersistedEndedHexStakeObservation = {
      ...COMPLETE_ROW,
      id: "obs-other",
      chainId: 1,
    };
    const client = makeMockClient([COMPLETE_ROW, otherChainRow]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.totalCount).toBe(1);
    expect(result.stakes[0].id).toBe("obs-1");
  });

  it("filters by walletAddress — excludes rows for other wallets", async () => {
    const otherWalletRow: PersistedEndedHexStakeObservation = {
      ...COMPLETE_ROW,
      id: "obs-other",
      walletAddress: "0xother",
    };
    const client = makeMockClient([COMPLETE_ROW, otherWalletRow]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.totalCount).toBe(1);
    expect(result.stakes[0].id).toBe("obs-1");
  });

  it("normalizes walletAddress to lowercase", async () => {
    const client = makeMockClient([COMPLETE_ROW]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xWALLET" },
      client as never,
    );

    // Normalized before query — mock filters on lowercase "0xwallet"
    expect(result.walletAddress).toBe("0xwallet");
    expect(result.totalCount).toBe(1);
  });

  it("list isComplete is false when any row is incomplete", async () => {
    const client = makeMockClient([COMPLETE_ROW, INCOMPLETE_ROW]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.totalCount).toBe(2);
    expect(result.isComplete).toBe(false);
  });

  it("list isComplete is true when all rows are complete", async () => {
    const secondComplete: PersistedEndedHexStakeObservation = {
      ...COMPLETE_ROW,
      id: "obs-3",
      stakeId: "111111",
      endBlockNumber: 23000000n,
    };
    const client = makeMockClient([COMPLETE_ROW, secondComplete]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.isComplete).toBe(true);
  });

  it("aggregates individual stake warnings into list warnings", async () => {
    const client = makeMockClient([COMPLETE_ROW, INCOMPLETE_ROW]);
    const result: EndedHexStakeListDto = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });

  it("returns stakes ordered by endBlockNumber ascending", async () => {
    const row2: PersistedEndedHexStakeObservation = {
      ...COMPLETE_ROW,
      id: "obs-b",
      stakeId: "2",
      endBlockNumber: 22000000n,
    };
    const row1: PersistedEndedHexStakeObservation = {
      ...COMPLETE_ROW,
      id: "obs-a",
      stakeId: "1",
      endBlockNumber: 19000000n,
    };
    const row3: PersistedEndedHexStakeObservation = {
      ...COMPLETE_ROW,
      id: "obs-c",
      stakeId: "3",
      endBlockNumber: 25000000n,
    };

    const client = makeMockClient([row2, row1, row3]);
    const result = await readEndedHexStakes(
      { chainId: 369, walletAddress: "0xwallet" },
      client as never,
    );

    expect(result.stakes.map((s) => s.stakeId)).toEqual(["1", "2", "3"]);
    expect(result.stakes[0].endBlockNumber).toBe("19000000");
    expect(result.stakes[2].endBlockNumber).toBe("25000000");
  });
});
