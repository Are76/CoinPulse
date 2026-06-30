// HexMining Phase 5 — ended stake discovery service tests
//
// Verifies the behaviour of discoverEndedHexStakes:
//
//   1. Reads only END actions, ignoring START actions.
//   2. Skips records that have no stakeId and records the warning.
//   3. Cross-references matching startStake record to fill principalHex,
//      stakedDays, stakeIndex, startTxHash, and startBlockNumber.
//   4. Falls back to endStake record fields when no startStake is found.
//   5. Always sets lockedDay=null, stakeShares=null, isComplete=false,
//      and includes the lockedDay warning regardless of whether a startStake
//      was found.
//   6. Counts persisted vs. skipped (already-existing rows) correctly.
//   7. discoveryMethod is always "raw_stake_action".
//
// No live database, no RPC, no network. Pure in-memory mock.

import { describe, expect, it, vi } from "vitest";

import { discoverEndedHexStakes } from "@/services/hexmining/ended-stake-discovery";
import type { PersistEndedHexStakeObservationInput } from "@/services/hexmining/ended-stake-observation-store";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

// A minimal RawStakeAction record shape returned by readWalletRawStakeActions.
type MockAction = {
  chainId: number;
  protocolSlug: string;
  actionKind: "START" | "END";
  txHash: string;
  blockNumber: bigint;
  blockHash: string;
  actionIndex: number;
  contractAddress: string;
  initiatorAddress: string;
  stakeId: bigint | null;
  stakeIndex: number | null;
  stakedDays: number | null;
  tokenAddress: string;
  assetIdSnapshot: string;
  decimalsSnapshot: number;
  principalLockedRaw: string | null;
  totalReturnedRaw: string | null;
  principalReturnedRaw: string | null;
  yieldRaw: string | null;
  penaltyRaw: string | null;
  feeAssetIdSnapshot: string;
  feeDecimalsSnapshot: number;
  feeAmountRaw: string;
};

function makeAction(overrides: Partial<MockAction> = {}): MockAction {
  return {
    chainId: 369,
    protocolSlug: "hex",
    actionKind: "END",
    txHash: "0xendtx",
    blockNumber: 21000000n,
    blockHash: "0xblockhash",
    actionIndex: 0,
    contractAddress: "0xhex",
    initiatorAddress: "0xwallet",
    stakeId: 942663n,
    stakeIndex: 0,
    stakedDays: 5555,
    tokenAddress: "0xhextoken",
    assetIdSnapshot: "chain:369:erc20:0xhextoken",
    decimalsSnapshot: 8,
    principalLockedRaw: "1000000000000000",
    totalReturnedRaw: null,
    principalReturnedRaw: null,
    yieldRaw: "20589444841",
    penaltyRaw: null,
    feeAssetIdSnapshot: "chain:369:native:0x",
    feeDecimalsSnapshot: 18,
    feeAmountRaw: "0",
    ...overrides,
  };
}

function makeRawClient(actions: MockAction[], startByStakeId: Map<bigint, MockAction | null> = new Map()) {
  return {
    rawStakeAction: {
      async findMany(_args: unknown) {
        return actions.map((a) => ({ ...a }));
      },
      async findFirst(args: { where: { stakeId: bigint; actionKind: string } }) {
        const id = args.where.stakeId;
        if (startByStakeId.has(id)) return startByStakeId.get(id) ?? null;
        return null;
      },
    },
  };
}

function makeObservationClient() {
  const store = new Map<string, { id: string }>();

  const persistMock = vi.fn(async (input: PersistEndedHexStakeObservationInput) => {
    const key = `${input.chainId}:${input.walletAddress.toLowerCase()}:${input.stakeId}:${input.endBlockNumber}:${input.discoveryMethod}`;
    if (store.has(key)) {
      return { id: store.get(key)!.id, created: false };
    }
    const id = `obs-${store.size + 1}`;
    store.set(key, { id });
    return { id, created: true };
  });

  const client = {
    rawEndedHexStakeObservation: {
      findFirst: vi.fn(async (_args: unknown) => null),
      create: vi.fn(async (args: { data: { id?: string } }) => ({ id: args.data.id ?? "obs-1" })),
      findMany: vi.fn(async (_args: unknown) => []),
    },
    _persistMock: persistMock,
  };

  // The observation client just needs the Prisma shape; we override with a
  // higher-level spy by wrapping persistEndedHexStakeObservation in tests.
  return { client, persistMock, store };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const BASE_ARGS = {
  chainId: 369,
  walletAddress: "0xwallet",
  fromBlock: 1n,
  toBlock: 99999999n,
};

describe("discoverEndedHexStakes", () => {
  it("returns zero discovered when no END actions exist", async () => {
    const startAction = makeAction({ actionKind: "START" });
    const rawClient = makeRawClient([startAction]);
    const { client: obsClient } = makeObservationClient();

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(result.discovered).toBe(0);
    expect(result.persisted).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("skips END actions with no stakeId and records a warning", async () => {
    const action = makeAction({ stakeId: null });
    const rawClient = makeRawClient([action]);
    const { client: obsClient } = makeObservationClient();

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(result.discovered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/hexmining-ended-stake-stakeid-unknown/);
  });

  it("persists an observation with correct fields from endStake record", async () => {
    const action = makeAction();
    const rawClient = makeRawClient([action], new Map([[942663n, null]]));

    const captured: PersistEndedHexStakeObservationInput[] = [];
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          captured.push(args.data);
          return { id: "obs-1" };
        },
        findMany: async () => [],
      },
    };

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(result.discovered).toBe(1);
    expect(result.persisted).toBe(1);
    expect(captured).toHaveLength(1);

    const obs = captured[0];
    expect(obs.chainId).toBe(369);
    expect(obs.stakeId).toBe("942663");
    expect(obs.endTxHash).toBe("0xendtx");
    expect(obs.endBlockNumber).toBe(21000000n);
    expect(obs.discoveryMethod).toBe("raw_stake_action");
    expect(obs.lockedDay).toBeNull();
    expect(obs.stakeShares).toBeNull();
    expect(obs.isComplete).toBe(false);
    expect(obs.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
    expect(obs.yieldHex).toBe("20589444841");
    expect(obs.penaltyHex).toBeNull();
  });

  it("uses startStake record to fill stakedDays, principalHex, startTxHash, startBlockNumber", async () => {
    const endAction = makeAction({
      stakeId: 100n,
      stakedDays: null,
      principalLockedRaw: null,
      txHash: "0xendtx",
      blockNumber: 22000000n,
    });
    const startAction = makeAction({
      actionKind: "START",
      stakeId: 100n,
      txHash: "0xstarttx",
      blockNumber: 18000000n,
      stakedDays: 3650,
      principalLockedRaw: "5000000000000",
      yieldRaw: null,
    });

    const rawClient = makeRawClient([endAction], new Map([[100n, startAction]]));

    const captured: PersistEndedHexStakeObservationInput[] = [];
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          captured.push(args.data);
          return { id: "obs-1" };
        },
        findMany: async () => [],
      },
    };

    await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    const obs = captured[0];
    expect(obs.stakedDays).toBe(3650);
    expect(obs.principalHex).toBe("5000000000000");
    expect(obs.startTxHash).toBe("0xstarttx");
    expect(obs.startBlockNumber).toBe(18000000n);
  });

  it("leaves startTxHash and startBlockNumber null when no startStake found", async () => {
    const action = makeAction();
    const rawClient = makeRawClient([action], new Map([[942663n, null]]));

    const captured: PersistEndedHexStakeObservationInput[] = [];
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          captured.push(args.data);
          return { id: "obs-1" };
        },
        findMany: async () => [],
      },
    };

    await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    const obs = captured[0];
    expect(obs.startTxHash).toBeNull();
    expect(obs.startBlockNumber).toBeNull();
  });

  it("counts already-existing rows as skipped, not persisted", async () => {
    const action = makeAction();
    const rawClient = makeRawClient([action], new Map([[942663n, null]]));

    let callCount = 0;
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => {
          callCount++;
          // Return an existing row to trigger idempotency path
          return callCount > 0 ? { id: "existing-obs" } : null;
        },
        create: vi.fn(async () => ({ id: "should-not-be-called" })),
        findMany: async () => [],
      },
    };

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(result.discovered).toBe(1);
    expect(result.persisted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("handles multiple END actions in a single pass", async () => {
    const actions = [
      makeAction({ stakeId: 1n, txHash: "0xtx1", blockNumber: 19000000n }),
      makeAction({ stakeId: 2n, txHash: "0xtx2", blockNumber: 20000000n }),
      makeAction({ stakeId: 3n, txHash: "0xtx3", blockNumber: 21000000n }),
    ];
    const rawClient = makeRawClient(actions, new Map([
      [1n, null],
      [2n, null],
      [3n, null],
    ]));

    const created: string[] = [];
    let idSeq = 0;
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          const id = `obs-${++idSeq}`;
          created.push(args.data.stakeId as string);
          return { id };
        },
        findMany: async () => [],
      },
    };

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(result.discovered).toBe(3);
    expect(result.persisted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(created).toEqual(["1", "2", "3"]);
  });

  it("excludes non-hex protocol END actions", async () => {
    const hexAction = makeAction({ stakeId: 1n, protocolSlug: "hex" });
    const otherAction = makeAction({ stakeId: 2n, protocolSlug: "other_stake_protocol" });
    const rawClient = makeRawClient([hexAction, otherAction], new Map([[1n, null], [2n, null]]));

    const created: string[] = [];
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          created.push(args.data.stakeId as string);
          return { id: "obs-1" };
        },
        findMany: async () => [],
      },
    };

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(result.discovered).toBe(1);
    expect(created).toEqual(["1"]);
  });

  it("surfaces lockedDay warnings in the result warnings array", async () => {
    const action = makeAction({ stakeId: 42n });
    const rawClient = makeRawClient([action], new Map([[42n, null]]));

    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async () => ({ id: "obs-1" }),
        findMany: async () => [],
      },
    };

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(result.warnings.some((w) => w.includes("hexmining-ended-stake-lockedday-unknown"))).toBe(true);
  });

  it("always sets lockedDay and stakeShares to null", async () => {
    const action = makeAction();
    const rawClient = makeRawClient([action], new Map([[942663n, makeAction({ actionKind: "START" })]]));

    const captured: PersistEndedHexStakeObservationInput[] = [];
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          captured.push(args.data);
          return { id: "obs-1" };
        },
        findMany: async () => [],
      },
    };

    await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(captured[0].lockedDay).toBeNull();
    expect(captured[0].stakeShares).toBeNull();
  });
});
