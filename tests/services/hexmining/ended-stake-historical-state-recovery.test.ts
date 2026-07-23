// HexMining ended-stake historical-state recovery — service contract tests
//
// Covers the RPC-facing orchestration layer: pinned historical reads
// (endBlockNumber - 1), exact single-stakeId matching, fail-closed handling of
// no-match/multiple-match/RPC-failure/malformed-evidence, dry-run vs execute
// semantics, and that a complete row is skipped before any RPC call is made.
//
// The persistence side (atomic conditional update, identity binding,
// concurrent-completion classification) is unit tested directly in
// ended-stake-observation-store.test.ts; here it is exercised only through the
// full recoverEndedHexStakeHistoricalState orchestration to prove correct
// aggregation/reporting.
//
// No live database, no live RPC, no network. Pure in-memory mocks.

import { describe, expect, it, vi } from "vitest";

import {
  recoverEndedHexStakeHistoricalState,
  type HistoricalStateReadClient,
  type RecoverEndedHexStakeHistoricalStateDeps,
} from "@/services/hexmining/ended-stake-historical-state-recovery";

const PHEX_ADDRESS = "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39";
const WALLET = "0x75f808367720951e789d47e9e9db51148d9aa765";

type StoredRow = {
  id: string;
  chainId: number;
  walletAddress: string;
  stakeId: string;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  yieldHex: string | null;
  penaltyHex: string | null;
  endTxHash: string;
  endBlockNumber: bigint;
  startTxHash: string | null;
  startBlockNumber: bigint | null;
  discoveryMethod: string;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
  createdAt: Date;
  evidenceRecoveryMethod: string | null;
  evidenceRecoveryBlockNumber: bigint | null;
  evidenceRecoverySourceContract: string | null;
  evidenceRecoverySourceFunction: string | null;
  evidenceRecoveryReturnedStakeId: string | null;
  evidenceRecoveredAt: Date | null;
};

let idCounter = 0;

function makeRow(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    id: `mock-id-${++idCounter}`,
    chainId: 369,
    walletAddress: WALLET,
    stakeId: "507128",
    stakeIndex: 0,
    stakedDays: null,
    lockedDay: null,
    stakeShares: null,
    principalHex: null,
    yieldHex: null,
    penaltyHex: null,
    endTxHash: "0xbfb33e49d93a16ca2c8e297867011d7eccbcbc1b859aaee49ea3a0451da8490",
    endBlockNumber: 15767882n,
    startTxHash: null,
    startBlockNumber: null,
    discoveryMethod: "raw_stake_action",
    observedAt: new Date("2026-07-04T00:00:00Z"),
    isComplete: false,
    warnings: ["hexmining-ended-stake-lockedday-unknown"],
    createdAt: new Date("2026-07-04T00:00:00Z"),
    evidenceRecoveryMethod: null,
    evidenceRecoveryBlockNumber: null,
    evidenceRecoverySourceContract: null,
    evidenceRecoverySourceFunction: null,
    evidenceRecoveryReturnedStakeId: null,
    evidenceRecoveredAt: null,
    ...overrides,
  };
}

// updateMany/findUnique/findMany are the only operations the recovery path is
// allowed to use — no `create` is implemented at all, so any accidental
// create-path call throws immediately instead of silently succeeding.
function makeMockPersistenceClient(rows: StoredRow[]) {
  return {
    rawEndedHexStakeObservation: {
      async findMany(args: { where: { chainId: number; walletAddress: string } }) {
        return rows
          .filter(
            (r) =>
              r.chainId === args.where.chainId && r.walletAddress === args.where.walletAddress,
          )
          .sort((a, b) => (a.endBlockNumber < b.endBlockNumber ? -1 : 1));
      },
      async updateMany(args: {
        where: {
          id: string;
          isComplete: false;
          chainId: number;
          walletAddress: string;
          stakeId: string;
          endBlockNumber: bigint;
        };
        data: Record<string, unknown>;
      }) {
        const matched = rows.filter(
          (r) =>
            r.id === args.where.id &&
            r.isComplete === false &&
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress &&
            r.stakeId === args.where.stakeId &&
            r.endBlockNumber === args.where.endBlockNumber,
        );
        for (const row of matched) Object.assign(row, args.data);
        return { count: matched.length };
      },
      async findUnique(args: { where: { id: string } }) {
        const row = rows.find((r) => r.id === args.where.id);
        if (!row) return null;
        return {
          chainId: row.chainId,
          walletAddress: row.walletAddress,
          stakeId: row.stakeId,
          endBlockNumber: row.endBlockNumber,
          isComplete: row.isComplete,
          lockedDay: row.lockedDay,
          stakeShares: row.stakeShares,
        };
      },
    },
  };
}

type StakeListsEntry = {
  stakeId: number;
  stakedHearts: bigint;
  stakeShares: bigint;
  lockedDay: number;
  stakedDays: number;
  unlockedDay: number;
  isAutoStake: boolean;
};

// Builds a HistoricalStateReadClient whose stakeLists response depends only on
// the pinned blockNumber passed to it, so tests can assert every read is
// pinned to endBlockNumber-1.
function makeMockPublicClient(
  byBlock: Map<bigint, StakeListsEntry[]>,
): { client: HistoricalStateReadClient; readContract: ReturnType<typeof vi.fn> } {
  const readContract = vi.fn(
    async (args: {
      functionName: string;
      args: readonly unknown[];
      blockNumber: bigint;
    }) => {
      const entries = byBlock.get(args.blockNumber) ?? [];
      if (args.functionName === "stakeCount") {
        return BigInt(entries.length);
      }
      if (args.functionName === "stakeLists") {
        const index = Number(args.args[1] as bigint);
        const e = entries[index];
        if (!e) throw new Error(`no stakeLists entry at index ${index}`);
        return [
          e.stakeId,
          e.stakedHearts,
          e.stakeShares,
          e.lockedDay,
          e.stakedDays,
          e.unlockedDay,
          e.isAutoStake,
        ] as const;
      }
      throw new Error(`unexpected functionName ${args.functionName}`);
    },
  );
  return { client: { readContract: readContract as unknown as HistoricalStateReadClient["readContract"] }, readContract };
}

function baseDeps(
  rows: StoredRow[],
  byBlock: Map<bigint, StakeListsEntry[]>,
): { deps: RecoverEndedHexStakeHistoricalStateDeps; readContract: ReturnType<typeof vi.fn>; rows: StoredRow[] } {
  const persistenceClient = makeMockPersistenceClient(rows);
  const { client, readContract } = makeMockPublicClient(byBlock);
  return {
    deps: {
      publicClient: client,
      persistenceClient: persistenceClient as unknown as RecoverEndedHexStakeHistoricalStateDeps["persistenceClient"],
      now: () => new Date("2026-07-23T12:00:00Z"),
    },
    readContract,
    rows,
  };
}

describe("recoverEndedHexStakeHistoricalState", () => {
  it("rejects an unsupported chain before any RPC call", async () => {
    const rows = [makeRow()];
    const { deps, readContract } = baseDeps(rows, new Map());

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 1, walletAddress: WALLET, dryRun: true },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("pins both stakeCount and stakeLists reads to endBlockNumber - 1", async () => {
    const row = makeRow({ endBlockNumber: 15767882n, stakeId: "507128" });
    const historicalBlock = 15767881n;
    const byBlock = new Map([
      [
        historicalBlock,
        [
          {
            stakeId: 507128,
            stakedHearts: 700000000000n,
            stakeShares: 442200077208n,
            lockedDay: 683,
            stakedDays: 365,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, readContract } = baseDeps([row], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: true },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recovered).toBe(1);

    for (const call of readContract.mock.calls) {
      expect(call[0].blockNumber).toBe(historicalBlock);
    }
  });

  it("recovers lockedDay/stakeShares via exact stakeId match and upgrades the row on execute", async () => {
    const row = makeRow({ endBlockNumber: 15767882n, stakeId: "507128" });
    const historicalBlock = 15767881n;
    const byBlock = new Map([
      [
        historicalBlock,
        [
          {
            stakeId: 507128,
            stakedHearts: 700000000000n,
            stakeShares: 442200077208n,
            lockedDay: 683,
            stakedDays: 365,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, rows } = baseDeps([row], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated).toBe(1);
    expect(result.totalFailures).toBe(0);

    const updated = rows.find((r) => r.id === row.id)!;
    expect(updated.isComplete).toBe(true);
    expect(updated.lockedDay).toBe(683);
    expect(updated.stakeShares).toBe("442200077208");
    expect(updated.discoveryMethod).toBe("raw_stake_action");
    expect(updated.evidenceRecoveryMethod).toBe("historical_contract_state");
    expect(updated.evidenceRecoverySourceContract).toBe(PHEX_ADDRESS);
    expect(updated.evidenceRecoverySourceFunction).toBe("stakeLists");
    expect(updated.evidenceRecoveryReturnedStakeId).toBe("507128");
    expect(updated.evidenceRecoveryBlockNumber).toBe(historicalBlock);
  });

  it("preserves stakeShares exact precision at the uint72 maximum, never through Number()", async () => {
    const uint72Max = (1n << 72n) - 1n; // 4722366482869645213695
    const row = makeRow({ endBlockNumber: 100n, stakeId: "1" });
    const byBlock = new Map([
      [
        99n,
        [
          {
            stakeId: 1,
            stakedHearts: uint72Max,
            stakeShares: uint72Max,
            lockedDay: 1,
            stakedDays: 1,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, rows } = baseDeps([row], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );

    expect(result.ok).toBe(true);
    const updated = rows.find((r) => r.id === row.id)!;
    expect(updated.stakeShares).toBe("4722366482869645213695");
  });

  it("fails closed with no_match when the target stakeId is not found at the historical block", async () => {
    const row = makeRow({ endBlockNumber: 100n, stakeId: "999" });
    const byBlock = new Map([
      [
        99n,
        [
          {
            stakeId: 1,
            stakedHearts: 1n,
            stakeShares: 1n,
            lockedDay: 1,
            stakedDays: 1,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, rows } = baseDeps([row], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.noMatch).toBe(1);
    expect(result.updated).toBe(0);
    expect(rows.find((r) => r.id === row.id)!.isComplete).toBe(false);
  });

  it("fails closed with multiple_match when more than one entry returns the target stakeId", async () => {
    const row = makeRow({ endBlockNumber: 100n, stakeId: "1" });
    const byBlock = new Map([
      [
        99n,
        [
          {
            stakeId: 1,
            stakedHearts: 1n,
            stakeShares: 1n,
            lockedDay: 1,
            stakedDays: 1,
            unlockedDay: 0,
            isAutoStake: false,
          },
          {
            stakeId: 1,
            stakedHearts: 2n,
            stakeShares: 2n,
            lockedDay: 2,
            stakedDays: 2,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, rows } = baseDeps([row], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.multipleMatch).toBe(1);
    expect(rows.find((r) => r.id === row.id)!.isComplete).toBe(false);
  });

  it("fails closed with rpc_failed when the pinned RPC read throws, and never writes", async () => {
    const row = makeRow({ endBlockNumber: 100n, stakeId: "1" });
    const { deps, rows } = baseDeps([row], new Map()); // empty map → stakeCount() throws "no entry" via undefined handling

    // Force a genuine RPC-style throw instead of the default empty-map path.
    const throwingClient: HistoricalStateReadClient = {
      readContract: vi.fn(async () => {
        throw new Error("timeout");
      }) as unknown as HistoricalStateReadClient["readContract"],
    };

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      { ...deps, publicClient: throwingClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rpcFailures).toBe(1);
    expect(rows.find((r) => r.id === row.id)!.isComplete).toBe(false);
  });

  it("rejects a negative/non-digit stakeShares decode as a validation failure, never persisting it", async () => {
    const row = makeRow({ endBlockNumber: 100n, stakeId: "1" });
    const byBlock = new Map([
      [
        99n,
        [
          {
            stakeId: 1,
            stakedHearts: 1n,
            stakeShares: -5n, // malformed decode; a real uint72 can never be negative
            lockedDay: 1,
            stakedDays: 1,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, rows } = baseDeps([row], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validationFailures).toBe(1);
    expect(rows.find((r) => r.id === row.id)!.isComplete).toBe(false);
  });

  it("dry-run performs the RPC evidence check but writes nothing", async () => {
    const row = makeRow({ endBlockNumber: 15767882n, stakeId: "507128" });
    const byBlock = new Map([
      [
        15767881n,
        [
          {
            stakeId: 507128,
            stakedHearts: 700000000000n,
            stakeShares: 442200077208n,
            lockedDay: 683,
            stakedDays: 365,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, rows } = baseDeps([row], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: true },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    expect(result.recovered).toBe(1);
    expect(result.updated).toBe(0);

    const untouched = rows.find((r) => r.id === row.id)!;
    expect(untouched.isComplete).toBe(false);
    expect(untouched.lockedDay).toBeNull();
    expect(untouched.evidenceRecoveryMethod).toBeNull();
  });

  it("skips an already-complete row before issuing any RPC read for it", async () => {
    const completeRow = makeRow({
      stakeId: "1",
      endBlockNumber: 100n,
      isComplete: true,
      lockedDay: 1,
      stakeShares: "1",
      warnings: [],
    });
    const incompleteRow = makeRow({
      stakeId: "2",
      endBlockNumber: 200n,
      isComplete: false,
    });
    const byBlock = new Map([
      [
        199n,
        [
          {
            stakeId: 2,
            stakedHearts: 1n,
            stakeShares: 1n,
            lockedDay: 1,
            stakedDays: 1,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, readContract, rows } = baseDeps([completeRow, incompleteRow], byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyComplete).toBe(1);
    expect(result.updated).toBe(1);

    // Every RPC call must have been pinned to block 199 (incompleteRow's
    // endBlockNumber-1) — none at all for the already-complete row's block 99.
    for (const call of readContract.mock.calls) {
      expect(call[0].blockNumber).toBe(199n);
    }
    expect(rows.find((r) => r.id === completeRow.id)!.lockedDay).toBe(1);
  });

  it("rerun after a successful execute is idempotent: no duplicate row, no re-write, no RPC call", async () => {
    const row = makeRow({ endBlockNumber: 100n, stakeId: "1" });
    const byBlock = new Map([
      [
        99n,
        [
          {
            stakeId: 1,
            stakedHearts: 1n,
            stakeShares: 1n,
            lockedDay: 1,
            stakedDays: 1,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);
    const { deps, rows } = baseDeps([row], byBlock);

    const first = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );
    expect(first.ok && first.updated).toBe(1);

    const second = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      deps,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyComplete).toBe(1);
    expect(second.updated).toBe(0);
    expect(rows.filter((r) => r.stakeId === "1")).toHaveLength(1);
  });

  it("aggregates a concurrent_matching_completion outcome from the store without writing", async () => {
    const row = makeRow({
      endBlockNumber: 100n,
      stakeId: "1",
    });
    const byBlock = new Map([
      [
        99n,
        [
          {
            stakeId: 1,
            stakedHearts: 1n,
            stakeShares: 1n,
            lockedDay: 1,
            stakedDays: 1,
            unlockedDay: 0,
            isAutoStake: false,
          },
        ],
      ],
    ]);

    // Custom persistence client: updateMany always reports zero rows matched
    // (as if the row completed concurrently), and findUnique reports the row
    // is now complete with values identical to what recovery would have
    // written — proving the service correctly classifies and reports this
    // without mutating anything.
    const persistenceClient = {
      rawEndedHexStakeObservation: {
        findMany: async () => [row],
        updateMany: async () => ({ count: 0 }),
        findUnique: async () => ({
          chainId: row.chainId,
          walletAddress: row.walletAddress,
          stakeId: row.stakeId,
          endBlockNumber: row.endBlockNumber,
          isComplete: true,
          lockedDay: 1,
          stakeShares: "1",
        }),
      },
    };

    const { client } = makeMockPublicClient(byBlock);

    const result = await recoverEndedHexStakeHistoricalState(
      { chainId: 369, walletAddress: WALLET, dryRun: false },
      {
        publicClient: client,
        persistenceClient: persistenceClient as unknown as RecoverEndedHexStakeHistoricalStateDeps["persistenceClient"],
        now: () => new Date("2026-07-23T12:00:00Z"),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.concurrentMatchingCompletion).toBe(1);
    expect(result.updated).toBe(0);
  });
});
