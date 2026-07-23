// HexMining Phase 5 — ended stake observation store contract tests
//
// Verifies the write and read contracts for RawEndedHexStakeObservation:
//
//   1. persistEndedHexStakeObservation creates a new row on first write.
//   2. persistEndedHexStakeObservation is idempotent: a second write with the
//      same dedup key (chainId, walletAddress, stakeId, endBlockNumber,
//      discoveryMethod) returns created: false and does not write a second row.
//   3. A different discoveryMethod for the same stake produces a new row.
//   4. walletAddress is normalized to lowercase before write and read.
//   5. Nullable fields (lockedDay, stakeShares, stakeIndex, etc.) are stored
//      as-is — the store never coerces null to zero or a default value.
//   6. readEndedHexStakeObservations returns rows ordered by endBlockNumber asc.
//   7. buildEndedStakeDedupeKey produces a deterministic colon-delimited string.
//
// No live database, no RPC, no network. Pure in-memory mock.

import { describe, expect, it } from "vitest";

import {
  buildEndedStakeDedupeKey,
  persistEndedHexStakeObservation,
  readEndedHexStakeObservations,
  type PersistEndedHexStakeObservationInput,
  type PersistedEndedHexStakeObservation,
} from "@/services/hexmining/ended-stake-observation-store";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

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
};

let idCounter = 0;

function makeMockDb(initial: StoredRow[] = []) {
  const rows: StoredRow[] = [...initial];

  return {
    rawEndedHexStakeObservation: {
      async findFirst(args: {
        where: {
          chainId: number;
          walletAddress: string;
          stakeId: string;
          endBlockNumber: bigint;
          discoveryMethod: string;
        };
        select: { id: true; isComplete: true };
      }) {
        const match = rows.find(
          (r) =>
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress &&
            r.stakeId === args.where.stakeId &&
            r.endBlockNumber === args.where.endBlockNumber &&
            r.discoveryMethod === args.where.discoveryMethod,
        );
        return match ? { id: match.id, isComplete: match.isComplete } : null;
      },
      async update(args: {
        where: { id: string };
        data: {
          lockedDay: number | null;
          stakeShares: string | null;
          isComplete: boolean;
          warnings: string[];
        };
      }) {
        const row = rows.find((r) => r.id === args.where.id);
        if (!row) throw new Error(`no row ${args.where.id}`);
        row.lockedDay = args.data.lockedDay;
        row.stakeShares = args.data.stakeShares;
        row.isComplete = args.data.isComplete;
        row.warnings = args.data.warnings;
        return { id: row.id };
      },
      async create(args: { data: Omit<StoredRow, "id" | "createdAt"> }) {
        const row: StoredRow = {
          id: `mock-id-${++idCounter}`,
          createdAt: new Date("2026-06-29T00:00:00Z"),
          ...args.data,
        };
        rows.push(row);
        return { id: row.id };
      },
      async findMany(args: {
        where: { chainId: number; walletAddress: string };
        orderBy: Record<string, "asc" | "desc">[];
      }) {
        const filtered = rows.filter(
          (r) =>
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress,
        );

        // Apply each orderBy entry in sequence (full multi-key sort).
        const fieldOf = (r: StoredRow, field: string): string | bigint | number => {
          if (field === "endBlockNumber") return r.endBlockNumber;
          if (field === "endTxHash") return r.endTxHash;
          if (field === "stakeId") return r.stakeId;
          if (field === "id") return r.id;
          return "";
        };

        return filtered.sort((a, b) => {
          for (const entry of args.orderBy) {
            const [field, dir] = Object.entries(entry)[0] as [string, "asc" | "desc"];
            const av = fieldOf(a, field);
            const bv = fieldOf(b, field);
            let cmp: number;
            if (typeof av === "bigint" && typeof bv === "bigint") {
              cmp = av < bv ? -1 : av > bv ? 1 : 0;
            } else {
              cmp = String(av).localeCompare(String(bv));
            }
            if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
          }
          return 0;
        });
      },
    },
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const BASE_INPUT: PersistEndedHexStakeObservationInput = {
  chainId: 369,
  walletAddress: "0xAbCdEf0000000000000000000000000000000001",
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
  observedAt: new Date("2026-06-14T12:00:00Z"),
  isComplete: true,
  warnings: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("persistEndedHexStakeObservation", () => {
  it("creates a new row and returns created: true on first write", async () => {
    const db = makeMockDb();
    const result = await persistEndedHexStakeObservation(BASE_INPUT, db);
    expect(result.created).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("is idempotent: second write with same dedup key returns created: false", async () => {
    const db = makeMockDb();
    const first = await persistEndedHexStakeObservation(BASE_INPUT, db);
    const second = await persistEndedHexStakeObservation(BASE_INPUT, db);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("writes a second row when discoveryMethod differs", async () => {
    const db = makeMockDb();
    const first = await persistEndedHexStakeObservation(
      { ...BASE_INPUT, discoveryMethod: "raw_stake_action" },
      db,
    );
    const second = await persistEndedHexStakeObservation(
      { ...BASE_INPUT, discoveryMethod: "rpc_history" },
      db,
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  it("normalizes walletAddress to lowercase", async () => {
    const db = makeMockDb();
    const input: PersistEndedHexStakeObservationInput = {
      ...BASE_INPUT,
      walletAddress: "0xAbCdEf0000000000000000000000000000000002",
    };
    await persistEndedHexStakeObservation(input, db);
    // Second write with same address but different case should dedup
    const result = await persistEndedHexStakeObservation(
      { ...input, walletAddress: input.walletAddress.toLowerCase() },
      db,
    );
    expect(result.created).toBe(false);
  });

  it("stores null nullable fields without coercing them", async () => {
    const db = makeMockDb();
    const input: PersistEndedHexStakeObservationInput = {
      ...BASE_INPUT,
      stakeId: "999999",
      lockedDay: null,
      stakeShares: null,
      stakeIndex: null,
      principalHex: null,
      yieldHex: null,
      penaltyHex: null,
      startTxHash: null,
      startBlockNumber: null,
      isComplete: false,
      warnings: ["hexmining-ended-stake-lockedday-unknown"],
    };
    const result = await persistEndedHexStakeObservation(input, db);
    expect(result.created).toBe(true);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: input.walletAddress },
      db,
    );
    const row = rows.find((r) => r.stakeId === "999999");
    expect(row).toBeDefined();
    expect(row!.lockedDay).toBeNull();
    expect(row!.stakeShares).toBeNull();
    expect(row!.stakeIndex).toBeNull();
    expect(row!.principalHex).toBeNull();
    expect(row!.yieldHex).toBeNull();
    expect(row!.penaltyHex).toBeNull();
    expect(row!.startTxHash).toBeNull();
    expect(row!.startBlockNumber).toBeNull();
    expect(row!.isComplete).toBe(false);
    expect(row!.warnings).toContain("hexmining-ended-stake-lockedday-unknown");
  });

  // ── Stale-row reconciliation (PR #335 P2) ──────────────────────────────────

  const INCOMPLETE_INPUT: PersistEndedHexStakeObservationInput = {
    ...BASE_INPUT,
    stakeId: "555111",
    lockedDay: null,
    stakeShares: null,
    isComplete: false,
    warnings: ["hexmining-ended-stake-lockedday-unknown"],
  };

  it("upgrades a previously incomplete row in place when complete evidence arrives", async () => {
    const db = makeMockDb();

    const first = await persistEndedHexStakeObservation(INCOMPLETE_INPUT, db);
    expect(first.created).toBe(true);
    expect(first.updated).toBe(false);

    const complete: PersistEndedHexStakeObservationInput = {
      ...INCOMPLETE_INPUT,
      lockedDay: 2310,
      stakeShares: "1414291579679",
      isComplete: true,
      warnings: [],
    };
    const second = await persistEndedHexStakeObservation(complete, db);

    // Same dedupe key: not created, but reconciled in place.
    expect(second.created).toBe(false);
    expect(second.updated).toBe(true);
    expect(second.id).toBe(first.id);

    // Canonical row now reflects the complete evidence.
    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: INCOMPLETE_INPUT.walletAddress },
      db,
    );
    const row = rows.find((r) => r.stakeId === "555111")!;
    expect(row.isComplete).toBe(true);
    expect(row.lockedDay).toBe(2310);
    expect(row.stakeShares).toBe("1414291579679");
    expect(row.warnings).toEqual([]);

    // A third identical complete write is a no-op (idempotent, no re-upgrade).
    const third = await persistEndedHexStakeObservation(complete, db);
    expect(third.created).toBe(false);
    expect(third.updated).toBe(false);
    expect(third.id).toBe(first.id);
  });

  it("never downgrades or rewrites a row that is already complete", async () => {
    const db = makeMockDb();

    const complete: PersistEndedHexStakeObservationInput = {
      ...INCOMPLETE_INPUT,
      lockedDay: 4200,
      stakeShares: "987654321",
      isComplete: true,
      warnings: [],
    };
    const first = await persistEndedHexStakeObservation(complete, db);
    expect(first.created).toBe(true);

    // A later incomplete observation for the same key must not clobber the row.
    const second = await persistEndedHexStakeObservation(
      { ...complete, lockedDay: null, stakeShares: null, isComplete: false, warnings: ["x"] },
      db,
    );
    expect(second.created).toBe(false);
    expect(second.updated).toBe(false);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: complete.walletAddress },
      db,
    );
    const row = rows.find((r) => r.stakeId === "555111")!;
    expect(row.isComplete).toBe(true);
    expect(row.lockedDay).toBe(4200);
    expect(row.stakeShares).toBe("987654321");
    expect(row.warnings).toEqual([]);
  });

  it("preserves a large uint72 stakeShares exactly through an in-place upgrade", async () => {
    const db = makeMockDb();
    const uint72Max = "4722366482869645213695"; // 2^72 - 1, >= 1e21

    await persistEndedHexStakeObservation(INCOMPLETE_INPUT, db);
    const upgraded = await persistEndedHexStakeObservation(
      { ...INCOMPLETE_INPUT, lockedDay: 55, stakeShares: uint72Max, isComplete: true, warnings: [] },
      db,
    );
    expect(upgraded.updated).toBe(true);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: INCOMPLETE_INPUT.walletAddress },
      db,
    );
    const row = rows.find((r) => r.stakeId === "555111")!;
    expect(row.stakeShares).toBe(uint72Max);
    expect(row.stakeShares).not.toMatch(/[eE]/);
    expect(row.stakeShares).toMatch(/^\d+$/);
    expect(BigInt(row.stakeShares as string).toString()).toBe(uint72Max);
  });
});

describe("readEndedHexStakeObservations", () => {
  it("returns empty array when no rows exist", async () => {
    const db = makeMockDb();
    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: "0xnobody" },
      db,
    );
    expect(rows).toEqual([]);
  });

  it("returns rows ordered by endBlockNumber ascending", async () => {
    const db = makeMockDb();
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "2", endBlockNumber: 22000000n },
      db,
    );
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "1", endBlockNumber: 19000000n },
      db,
    );
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "3", endBlockNumber: 25000000n },
      db,
    );

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows.map((r) => r.stakeId)).toEqual(["1", "2", "3"]);
    expect(rows[0].endBlockNumber).toBe(19000000n);
    expect(rows[2].endBlockNumber).toBe(25000000n);
  });

  it("uses secondary sort keys deterministically when endBlockNumber ties", async () => {
    const db = makeMockDb();
    // Three stakes all ending in the same block — stakeId is the tie-breaker
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "300", endBlockNumber: 20000000n, endTxHash: "0xaaa" },
      db,
    );
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "100", endBlockNumber: 20000000n, endTxHash: "0xaaa" },
      db,
    );
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "200", endBlockNumber: 20000000n, endTxHash: "0xaaa" },
      db,
    );

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    // endBlockNumber ties broken by endTxHash (same), then stakeId ascending
    expect(rows.map((r) => r.stakeId)).toEqual(["100", "200", "300"]);
  });

  it("scopes results to chainId and walletAddress", async () => {
    const db = makeMockDb();
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "A", chainId: 369 },
      db,
    );
    await persistEndedHexStakeObservation(
      { ...BASE_INPUT, stakeId: "B", chainId: 1 },
      db,
    );
    await persistEndedHexStakeObservation(
      {
        ...BASE_INPUT,
        stakeId: "C",
        walletAddress: "0x0000000000000000000000000000000000000002",
      },
      db,
    );

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].stakeId).toBe("A");
  });

  it("maps all fields correctly from stored row", async () => {
    const db = makeMockDb();
    await persistEndedHexStakeObservation(BASE_INPUT, db);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    const row: PersistedEndedHexStakeObservation = rows[0];

    expect(row.chainId).toBe(369);
    expect(row.stakeId).toBe("942663");
    expect(row.stakeIndex).toBe(0);
    expect(row.stakedDays).toBe(5555);
    expect(row.lockedDay).toBe(2310);
    expect(row.stakeShares).toBe("1414291579679");
    expect(row.principalHex).toBe("1000000000000000");
    expect(row.yieldHex).toBe("20589444841");
    expect(row.penaltyHex).toBeNull();
    expect(row.endTxHash).toBe("0xabc123");
    expect(row.endBlockNumber).toBe(21000000n);
    expect(row.startTxHash).toBe("0xdef456");
    expect(row.startBlockNumber).toBe(18000000n);
    expect(row.discoveryMethod).toBe("raw_stake_action");
    expect(row.isComplete).toBe(true);
    expect(row.warnings).toEqual([]);
  });
});

describe("buildEndedStakeDedupeKey", () => {
  it("produces a deterministic colon-delimited string", () => {
    const key = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xabcdef",
      stakeId: "942663",
      endBlockNumber: 21000000n,
      discoveryMethod: "raw_stake_action",
    });
    expect(key).toBe("369:0xabcdef:942663:21000000:raw_stake_action");
  });

  it("normalizes walletAddress to lowercase in the key", () => {
    const key = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xAbCdEf",
      stakeId: "1",
      endBlockNumber: 1n,
      discoveryMethod: "raw_stake_action",
    });
    expect(key).toBe("369:0xabcdef:1:1:raw_stake_action");
  });

  it("produces different keys for different discovery methods", () => {
    const base = {
      chainId: 369,
      walletAddress: "0xabc",
      stakeId: "1",
      endBlockNumber: 100n,
    };
    const key1 = buildEndedStakeDedupeKey({
      ...base,
      discoveryMethod: "raw_stake_action",
    });
    const key2 = buildEndedStakeDedupeKey({
      ...base,
      discoveryMethod: "rpc_history",
    });
    expect(key1).not.toBe(key2);
  });
});
