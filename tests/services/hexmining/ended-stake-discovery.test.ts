// HexMining Phase 5 — ended stake discovery service tests
//
// Verifies the behaviour of discoverEndedHexStakes:
//
//   1. Reads only END actions, ignoring START actions.
//   2. Skips records that have no stakeId and records the warning.
//   3. Cross-references matching startStake record to fill principalHex,
//      stakedDays, stakeIndex, startTxHash, and startBlockNumber.
//   4. Falls back to endStake record fields when no startStake is found.
//   5. Consumes persisted START-time lockedDay/stakeShares: marks the
//      observation complete (no incomplete-evidence warning) only when both
//      are present; otherwise preserves nulls and the incomplete warning.
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
  lockedDay: number | null;
  stakeShares: string | null;
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
    // START-time evidence defaults to null; complete-evidence tests override
    // these on the START snapshot. END records never carry them.
    lockedDay: null,
    stakeShares: null,
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
          return { id: `obs-${captured.length}` };
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
          return { id: `obs-${captured.length}` };
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
          return { id: `obs-${captured.length}` };
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
          // Return an existing row (with matching end evidence) to trigger the
          // canonical-identity idempotency path.
          return callCount > 0
            ? {
                id: "existing-obs",
                isComplete: false,
                endBlockNumber: action.blockNumber,
                endTxHash: action.txHash,
              }
            : null;
        },
        create: vi.fn(async () => ({ id: "should-not-be-called" })),
        update: async (args: { where: { id: string } }) => ({ id: args.where.id }),
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
    expect(result.conflicts).toBe(0);
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

  // ── Start-evidence consumption (PR: complete-ended-stake-observations) ──────

  // Captures the observation persisted for a single END action, given a START
  // snapshot that carries the supplied evidence fields.
  async function captureWithStart(startOverrides: Partial<MockAction> | null) {
    const action = makeAction({ stakeId: 555n });
    const start =
      startOverrides == null
        ? null
        : makeAction({ actionKind: "START", stakeId: 555n, ...startOverrides });
    const rawClient = makeRawClient([action], new Map([[555n, start]]));

    const captured: PersistEndedHexStakeObservationInput[] = [];
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () => null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          captured.push(args.data);
          return { id: `obs-${captured.length}` };
        },
        findMany: async () => [],
      },
    };

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    return { obs: captured[0], result };
  }

  it("A. completes the observation when both lockedDay and stakeShares are present", async () => {
    const { obs, result } = await captureWithStart({
      lockedDay: 1234,
      stakeShares: "123456789012345678901",
    });

    expect(obs.lockedDay).toBe(1234);
    expect(obs.stakeShares).toBe("123456789012345678901");
    expect(obs.isComplete).toBe(true);
    expect(obs.warnings).not.toContain("hexmining-ended-stake-lockedday-unknown");
    expect(obs.warnings).toEqual([]);
    // The result-level warnings array must not carry the incomplete warning.
    expect(
      result.warnings.some((w) => w.includes("hexmining-ended-stake-lockedday-unknown")),
    ).toBe(false);
  });

  it("B. stays incomplete when lockedDay is missing, preserving the present stakeShares", async () => {
    const { obs, result } = await captureWithStart({
      lockedDay: null,
      stakeShares: "987654321",
    });

    expect(obs.lockedDay).toBeNull();
    expect(obs.stakeShares).toBe("987654321"); // preserved, not zeroed
    expect(obs.isComplete).toBe(false);
    expect(obs.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
    expect(
      result.warnings.some((w) => w.includes("hexmining-ended-stake-lockedday-unknown")),
    ).toBe(true);
  });

  it("C. stays incomplete when stakeShares is missing, preserving the present lockedDay", async () => {
    const { obs } = await captureWithStart({
      lockedDay: 4200,
      stakeShares: null,
    });

    expect(obs.lockedDay).toBe(4200); // preserved, not zeroed
    expect(obs.stakeShares).toBeNull();
    expect(obs.isComplete).toBe(false);
    expect(obs.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });

  it("D. stays incomplete with both null when the START snapshot carries neither field", async () => {
    const { obs } = await captureWithStart({ lockedDay: null, stakeShares: null });

    expect(obs.lockedDay).toBeNull();
    expect(obs.stakeShares).toBeNull();
    expect(obs.isComplete).toBe(false);
    expect(obs.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });

  it("D2. stays incomplete when no START snapshot exists at all", async () => {
    const { obs } = await captureWithStart(null);

    expect(obs.lockedDay).toBeNull();
    expect(obs.stakeShares).toBeNull();
    expect(obs.isComplete).toBe(false);
    expect(obs.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });

  it("E. preserves a large uint72 stakeShares as an exact decimal string with no exponent", async () => {
    // uint72 max = 2^72 - 1 = 4722366482869645213695 (22 digits, >= 1e21).
    const uint72Max = "4722366482869645213695";
    const { obs } = await captureWithStart({ lockedDay: 55, stakeShares: uint72Max });

    expect(obs.stakeShares).toBe(uint72Max);
    expect(obs.stakeShares).not.toMatch(/[eE]/); // no exponential notation
    expect(obs.stakeShares).toMatch(/^\d+$/); // canonical digit-only string
    // Round-tripping through BigInt (never Number) must be lossless.
    expect(BigInt(obs.stakeShares as string).toString()).toBe(uint72Max);
    expect(obs.isComplete).toBe(true);
  });

  it("F. is idempotent for complete evidence and preserves provenance/accounting fields", async () => {
    const action = makeAction({ stakeId: 777n, blockNumber: 23000000n, txHash: "0xend777" });
    const start = makeAction({
      actionKind: "START",
      stakeId: 777n,
      txHash: "0xstart777",
      blockNumber: 19000000n,
      stakedDays: 3650,
      principalLockedRaw: "5000000000000",
      lockedDay: 100,
      stakeShares: "1000000000000000000000",
    });
    const rawClient = makeRawClient([action], new Map([[777n, start]]));

    const captured: PersistEndedHexStakeObservationInput[] = [];
    let existing = false;
    const obsClient = {
      rawEndedHexStakeObservation: {
        findFirst: async () =>
          existing
            ? {
                id: "existing-obs",
                isComplete: true,
                endBlockNumber: action.blockNumber,
                endTxHash: action.txHash,
              }
            : null,
        create: async (args: { data: PersistEndedHexStakeObservationInput & { id?: string } }) => {
          captured.push(args.data);
          existing = true;
          return { id: "obs-1" };
        },
        update: async (args: { where: { id: string } }) => ({ id: args.where.id }),
        findMany: async () => [],
      },
    };

    const first = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });
    const second = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: obsClient as never,
    });

    expect(first.persisted).toBe(1);
    expect(second.persisted).toBe(0);
    expect(second.skipped).toBe(1);
    // Only one create call — no duplicate row.
    expect(captured).toHaveLength(1);

    const obs = captured[0];
    expect(obs.discoveryMethod).toBe("raw_stake_action");
    expect(obs.startTxHash).toBe("0xstart777");
    expect(obs.startBlockNumber).toBe(19000000n);
    expect(obs.endTxHash).toBe("0xend777");
    expect(obs.endBlockNumber).toBe(23000000n);
    expect(obs.stakedDays).toBe(3650);
    expect(obs.principalHex).toBe("5000000000000");
    expect(obs.lockedDay).toBe(100);
    expect(obs.stakeShares).toBe("1000000000000000000000");
    expect(obs.isComplete).toBe(true);
    expect(obs.observedAt).toBeInstanceOf(Date);
  });

  // ── Stale-row reconciliation invariant (PR #335 P2) ─────────────────────────
  //
  // A stateful store that mirrors the real dedupe + upgrade semantics, so we can
  // assert that the canonical persisted row and the returned warnings agree.

  type StoreRow = {
    id: string;
    chainId: number;
    walletAddress: string;
    stakeId: string;
    endBlockNumber: bigint;
    endTxHash: string;
    discoveryMethod: string;
    lockedDay: number | null;
    stakeShares: string | null;
    isComplete: boolean;
    warnings: string[];
  };

  function makeStatefulStore(initial: StoreRow[] = []) {
    const rows: StoreRow[] = [...initial];
    let seq = 0;
    const client = {
      rawEndedHexStakeObservation: {
        async findFirst(args: {
          where: {
            chainId: number;
            walletAddress: string;
            stakeId: string;
          };
        }) {
          const m = rows.find(
            (r) =>
              r.chainId === args.where.chainId &&
              r.walletAddress === args.where.walletAddress &&
              r.stakeId === args.where.stakeId,
          );
          return m
            ? {
                id: m.id,
                isComplete: m.isComplete,
                endBlockNumber: m.endBlockNumber,
                endTxHash: m.endTxHash,
              }
            : null;
        },
        async update(args: {
          where: { id: string };
          data: { lockedDay: number | null; stakeShares: string | null; isComplete: boolean; warnings: string[] };
        }) {
          const r = rows.find((row) => row.id === args.where.id)!;
          r.lockedDay = args.data.lockedDay;
          r.stakeShares = args.data.stakeShares;
          r.isComplete = args.data.isComplete;
          r.warnings = args.data.warnings;
          return { id: r.id };
        },
        async create(args: { data: Omit<StoreRow, "id"> }) {
          const r: StoreRow = { id: `row-${++seq}`, ...args.data };
          rows.push(r);
          return { id: r.id };
        },
      },
    };
    return { client, rows };
  }

  it("upgrades a pre-existing incomplete row to complete and reports no incomplete warning", async () => {
    const seeded: StoreRow = {
      id: "legacy-1",
      chainId: 369,
      walletAddress: "0xwallet",
      stakeId: "900",
      endBlockNumber: 21000000n,
      // Must match the endAction's txHash below so canonical-identity
      // reconciliation treats them as the same end evidence.
      endTxHash: "0xendtx",
      discoveryMethod: "raw_stake_action",
      lockedDay: null,
      stakeShares: null,
      isComplete: false,
      warnings: ["hexmining-ended-stake-lockedday-unknown"],
    };
    const { client, rows } = makeStatefulStore([seeded]);

    const endAction = makeAction({ stakeId: 900n, blockNumber: 21000000n });
    const start = makeAction({
      actionKind: "START",
      stakeId: 900n,
      lockedDay: 2310,
      stakeShares: "1414291579679",
    });
    const rawClient = makeRawClient([endAction], new Map([[900n, start]]));

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: client as never,
    });

    // Operator result: the upgrade counts as persisted, and NO incomplete
    // warning is surfaced for this stake.
    expect(result.persisted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(
      result.warnings.some((w) => w.includes("hexmining-ended-stake-lockedday-unknown")),
    ).toBe(false);

    // Canonical row and the returned warnings agree: the row is now complete.
    const row = rows.find((r) => r.stakeId === "900")!;
    expect(row.id).toBe("legacy-1"); // same row, dedupe identity unchanged
    expect(row.isComplete).toBe(true);
    expect(row.lockedDay).toBe(2310);
    expect(row.stakeShares).toBe("1414291579679");
    expect(row.warnings).toEqual([]);
  });

  it("keeps emitting the incomplete warning when the canonical row stays incomplete", async () => {
    const seeded: StoreRow = {
      id: "legacy-2",
      chainId: 369,
      walletAddress: "0xwallet",
      stakeId: "901",
      endBlockNumber: 21000000n,
      endTxHash: "0xendtx",
      discoveryMethod: "raw_stake_action",
      lockedDay: null,
      stakeShares: null,
      isComplete: false,
      warnings: ["hexmining-ended-stake-lockedday-unknown"],
    };
    const { client, rows } = makeStatefulStore([seeded]);

    // START evidence still missing (no snapshot) → observation stays incomplete.
    const endAction = makeAction({ stakeId: 901n, blockNumber: 21000000n });
    const rawClient = makeRawClient([endAction], new Map([[901n, null]]));

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: client as never,
    });

    // Canonical row remains incomplete, and the warning is still surfaced.
    expect(result.skipped).toBe(1);
    expect(result.persisted).toBe(0);
    expect(
      result.warnings.some((w) => w.includes("hexmining-ended-stake-lockedday-unknown")),
    ).toBe(true);

    const row = rows.find((r) => r.stakeId === "901")!;
    expect(row.isComplete).toBe(false);
    expect(row.lockedDay).toBeNull();
    expect(row.stakeShares).toBeNull();
  });

  it("upgrade is idempotent: a second run after completion is a no-op skip", async () => {
    const { client, rows } = makeStatefulStore();

    const endAction = makeAction({ stakeId: 902n, blockNumber: 21000000n });
    const start = makeAction({
      actionKind: "START",
      stakeId: 902n,
      lockedDay: 40,
      stakeShares: "4722366482869645213695", // uint72 max
    });
    const rawClient = makeRawClient([endAction], new Map([[902n, start]]));

    const first = await discoverEndedHexStakes(BASE_ARGS, { rawClient, observationClient: client as never });
    const second = await discoverEndedHexStakes(BASE_ARGS, { rawClient, observationClient: client as never });

    expect(first.persisted).toBe(1); // created complete
    expect(first.conflicts).toBe(0);
    expect(second.persisted).toBe(0);
    expect(second.skipped).toBe(1); // already complete → untouched
    expect(second.conflicts).toBe(0);
    expect(rows).toHaveLength(1); // no duplicate row

    const row = rows.find((r) => r.stakeId === "902")!;
    expect(row.isComplete).toBe(true);
    expect(row.stakeShares).toBe("4722366482869645213695"); // exact, no exponent
    expect(row.stakeShares).toMatch(/^\d+$/);
  });

  // ── Canonical-identity conflict discovery accounting (D-033) ────────────────
  //
  // When the persisted canonical row for (chainId, walletAddress, stakeId)
  // disagrees with the incoming END event's evidence (endBlockNumber and/or
  // endTxHash), the persistence layer must not create a second row and must
  // not overwrite the canonical evidence. Discovery must count these as
  // `conflicts` (not persisted, not idempotent skips) and surface an
  // end-evidence-conflict warning so the operator can act on the disagreement.

  it("counts a conflicting endBlockNumber as a conflict, not persisted or skipped", async () => {
    const seeded: StoreRow = {
      id: "legacy-conflict-blk",
      chainId: 369,
      walletAddress: "0xwallet",
      stakeId: "5000",
      endBlockNumber: 21000000n,
      endTxHash: "0xoriginal",
      discoveryMethod: "raw_stake_action",
      lockedDay: 100,
      stakeShares: "1",
      isComplete: true,
      warnings: [],
    };
    const { client, rows } = makeStatefulStore([seeded]);

    // Incoming END event for the same canonical identity but a different
    // endBlockNumber — the disagreement must be surfaced as a conflict.
    const endAction = makeAction({
      stakeId: 5000n,
      blockNumber: 22000000n,
      txHash: "0xoriginal",
    });
    const rawClient = makeRawClient([endAction], new Map([[5000n, null]]));

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: client as never,
    });

    expect(result.discovered).toBe(1);
    expect(result.persisted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.conflicts).toBe(1);
    const conflictWarning = result.warnings.find((w) =>
      w.startsWith("hexmining-ended-stake-end-evidence-conflict:stake=5000"),
    );
    expect(conflictWarning).toBeDefined();
    expect(conflictWarning).toContain("endBlockNumber");
    // Regression guard: the warning-code prefix must appear exactly once.
    expect(conflictWarning!.match(/hexmining-ended-stake-end-evidence-conflict/g)).toHaveLength(1);

    // Canonical row is unchanged — no second row, no overwrite.
    const row = rows.find((r) => r.stakeId === "5000")!;
    expect(rows).toHaveLength(1);
    expect(row.endBlockNumber).toBe(21000000n);
    expect(row.endTxHash).toBe("0xoriginal");
  });

  it("counts a conflicting endTxHash as a conflict, not persisted or skipped", async () => {
    const seeded: StoreRow = {
      id: "legacy-conflict-tx",
      chainId: 369,
      walletAddress: "0xwallet",
      stakeId: "5001",
      endBlockNumber: 21000000n,
      endTxHash: "0xoriginal",
      discoveryMethod: "raw_stake_action",
      lockedDay: 100,
      stakeShares: "1",
      isComplete: true,
      warnings: [],
    };
    const { client, rows } = makeStatefulStore([seeded]);

    const endAction = makeAction({
      stakeId: 5001n,
      blockNumber: 21000000n,
      txHash: "0xdifferent",
    });
    const rawClient = makeRawClient([endAction], new Map([[5001n, null]]));

    const result = await discoverEndedHexStakes(BASE_ARGS, {
      rawClient,
      observationClient: client as never,
    });

    expect(result.conflicts).toBe(1);
    expect(result.persisted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(
      result.warnings.some((w) => w.includes("endTxHash") && w.includes("stake=5001")),
    ).toBe(true);

    const row = rows.find((r) => r.stakeId === "5001")!;
    expect(rows).toHaveLength(1);
    expect(row.endTxHash).toBe("0xoriginal");
  });
});
