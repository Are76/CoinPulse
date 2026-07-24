// HexMining Phase 5 — ended stake observation store contract tests
//
// Verifies the write and read contracts for RawEndedHexStakeObservation:
//
//   1. persistEndedHexStakeObservation creates a new row on first write.
//   2. persistEndedHexStakeObservation is idempotent: a second write with the
//      same canonical identity (chainId, walletAddress, stakeId) returns
//      created: false and does not write a second row.
//   3. A different discoveryMethod for the same canonical stake does NOT
//      produce a second row (D-033: discoveryMethod is evidence, not identity).
//   4. walletAddress is normalized to lowercase before write and read.
//   5. Nullable fields (lockedDay, stakeShares, stakeIndex, etc.) are stored
//      as-is — the store never coerces null to zero or a default value.
//   6. readEndedHexStakeObservations returns rows ordered by endBlockNumber asc.
//   7. buildEndedStakeDedupeKey produces a deterministic colon-delimited
//      canonical-identity string.
//   8. End-evidence conflict (differing endBlockNumber or endTxHash) for the
//      same canonical identity returns a typed conflict outcome, never creates
//      a second row, and never overwrites the persisted canonical evidence.
//   9. Prisma P2002 race path is reconciled by re-reading and applying the
//      same identity/evidence rules.
//
// No live database, no RPC, no network. Pure in-memory mock.

import { describe, expect, it } from "vitest";

import {
  buildEndedStakeDedupeKey,
  enrichEndedHexStakeObservation,
  persistEndedHexStakeObservation,
  readEndedHexStakeObservations,
  type EnrichEndedHexStakeObservationInput,
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
  evidenceRecoveryMethod: string | null;
  evidenceRecoveryBlockNumber: bigint | null;
  evidenceRecoverySourceContract: string | null;
  evidenceRecoverySourceFunction: string | null;
  evidenceRecoveryReturnedStakeId: string | null;
  evidenceRecoveredAt: Date | null;
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
        };
        select: {
          id: true;
          isComplete: true;
          endBlockNumber: true;
          endTxHash: true;
        };
      }) {
        const match = rows.find(
          (r) =>
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress &&
            r.stakeId === args.where.stakeId,
        );
        return match
          ? {
              id: match.id,
              isComplete: match.isComplete,
              endBlockNumber: match.endBlockNumber,
              endTxHash: match.endTxHash,
            }
          : null;
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
      async create(args: {
        data: Omit<
          StoredRow,
          | "id"
          | "createdAt"
          | "evidenceRecoveryMethod"
          | "evidenceRecoveryBlockNumber"
          | "evidenceRecoverySourceContract"
          | "evidenceRecoverySourceFunction"
          | "evidenceRecoveryReturnedStakeId"
          | "evidenceRecoveredAt"
        >;
      }) {
        const row: StoredRow = {
          id: `mock-id-${++idCounter}`,
          createdAt: new Date("2026-06-29T00:00:00Z"),
          evidenceRecoveryMethod: null,
          evidenceRecoveryBlockNumber: null,
          evidenceRecoverySourceContract: null,
          evidenceRecoverySourceFunction: null,
          evidenceRecoveryReturnedStakeId: null,
          evidenceRecoveredAt: null,
          ...args.data,
        };
        rows.push(row);
        return { id: row.id };
      },
      async updateMany(args: {
        where: {
          id: string;
          isComplete: false;
          chainId: number;
          walletAddress: string;
          stakeId: string;
          endBlockNumber: bigint;
          warnings: { equals: string[] };
        };
        data: {
          lockedDay: number;
          stakeShares: string;
          isComplete: true;
          warnings: string[];
          evidenceRecoveryMethod: string;
          evidenceRecoveryBlockNumber: bigint;
          evidenceRecoverySourceContract: string;
          evidenceRecoverySourceFunction: string;
          evidenceRecoveryReturnedStakeId: string;
          evidenceRecoveredAt: Date;
        };
      }) {
        const arraysEqual = (a: string[], b: string[]) =>
          a.length === b.length && a.every((v, i) => v === b[i]);
        const matched = rows.filter(
          (r) =>
            r.id === args.where.id &&
            r.isComplete === false &&
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress &&
            r.stakeId === args.where.stakeId &&
            r.endBlockNumber === args.where.endBlockNumber &&
            arraysEqual(r.warnings, args.where.warnings.equals),
        );
        for (const row of matched) {
          row.lockedDay = args.data.lockedDay;
          row.stakeShares = args.data.stakeShares;
          row.isComplete = args.data.isComplete;
          row.warnings = args.data.warnings;
          row.evidenceRecoveryMethod = args.data.evidenceRecoveryMethod;
          row.evidenceRecoveryBlockNumber = args.data.evidenceRecoveryBlockNumber;
          row.evidenceRecoverySourceContract = args.data.evidenceRecoverySourceContract;
          row.evidenceRecoverySourceFunction = args.data.evidenceRecoverySourceFunction;
          row.evidenceRecoveryReturnedStakeId = args.data.evidenceRecoveryReturnedStakeId;
          row.evidenceRecoveredAt = args.data.evidenceRecoveredAt;
        }
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
          warnings: row.warnings,
        };
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
    expect(result.conflict).toBe(false);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("is idempotent: second write with same canonical identity returns created: false", async () => {
    const db = makeMockDb();
    const first = await persistEndedHexStakeObservation(BASE_INPUT, db);
    const second = await persistEndedHexStakeObservation(BASE_INPUT, db);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.conflict).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("does NOT write a second row when only discoveryMethod differs (D-033: evidence, not identity)", async () => {
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
    expect(second.created).toBe(false);
    expect(second.conflict).toBe(false);
    // Same canonical row — identity-only dedupe.
    expect(second.id).toBe(first.id);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    // Exactly one row survives — no discovery-method duplicate.
    expect(rows.filter((r) => r.stakeId === BASE_INPUT.stakeId)).toHaveLength(1);
    // The persisted discoveryMethod is the FIRST evidence recorded and is not
    // silently rewritten by the second observation.
    expect(rows[0].discoveryMethod).toBe("raw_stake_action");
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
    expect(result.conflict).toBe(false);
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
    expect(first.conflict).toBe(false);
    expect(first.updated).toBe(false);

    const complete: PersistEndedHexStakeObservationInput = {
      ...INCOMPLETE_INPUT,
      lockedDay: 2310,
      stakeShares: "1414291579679",
      isComplete: true,
      warnings: [],
    };
    const second = await persistEndedHexStakeObservation(complete, db);

    // Same canonical identity: not created, but reconciled in place.
    expect(second.created).toBe(false);
    expect(second.conflict).toBe(false);
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
    expect(third.conflict).toBe(false);
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
    expect(second.conflict).toBe(false);
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
    expect(upgraded.conflict).toBe(false);
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

  // ── Canonical-identity end-evidence conflict (D-033) ─────────────────────

  it("returns conflict (no create, no overwrite) when endBlockNumber disagrees", async () => {
    const db = makeMockDb();

    const first = await persistEndedHexStakeObservation(BASE_INPUT, db);
    expect(first.created).toBe(true);

    const second = await persistEndedHexStakeObservation(
      { ...BASE_INPUT, endBlockNumber: 22000000n },
      db,
    );

    expect(second.conflict).toBe(true);
    expect(second.created).toBe(false);
    expect(second.updated).toBe(false);
    if (second.conflict) {
      expect(second.conflictReason).toMatch(/endBlockNumber/);
      expect(second.conflictReason).toContain("21000000");
      expect(second.conflictReason).toContain("22000000");
    }

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    // Still exactly one canonical row with the ORIGINAL evidence.
    expect(rows).toHaveLength(1);
    expect(rows[0].endBlockNumber).toBe(21000000n);
    expect(rows[0].endTxHash).toBe("0xabc123");
  });

  it("returns conflict (no create, no overwrite) when endTxHash disagrees", async () => {
    const db = makeMockDb();

    const first = await persistEndedHexStakeObservation(BASE_INPUT, db);
    expect(first.created).toBe(true);

    const second = await persistEndedHexStakeObservation(
      { ...BASE_INPUT, endTxHash: "0xdifferent" },
      db,
    );

    expect(second.conflict).toBe(true);
    expect(second.created).toBe(false);
    expect(second.updated).toBe(false);
    if (second.conflict) {
      expect(second.conflictReason).toMatch(/endTxHash/);
      expect(second.conflictReason).toContain("0xabc123");
      expect(second.conflictReason).toContain("0xdifferent");
    }

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].endTxHash).toBe("0xabc123");
  });

  it("does not conflict when endTxHash differs only in letter casing", async () => {
    const db = makeMockDb();

    await persistEndedHexStakeObservation({ ...BASE_INPUT, endTxHash: "0xABCDEF" }, db);
    const second = await persistEndedHexStakeObservation(
      { ...BASE_INPUT, endTxHash: "0xabcdef" },
      db,
    );

    // Casing-only difference is not a real conflict; treated as the same
    // evidence.
    expect(second.conflict).toBe(false);
    expect(second.created).toBe(false);
  });

  // ── Prisma P2002 race path ────────────────────────────────────────────────

  it("reconciles a Prisma P2002 race by re-reading and matching evidence (idempotent success)", async () => {
    const { Prisma } = await import("@prisma/client");
    let findFirstCalls = 0;
    let createCalls = 0;

    const client = {
      rawEndedHexStakeObservation: {
        // First findFirst returns null (no row yet), second (after race) returns
        // the row inserted by the "other writer".
        async findFirst() {
          findFirstCalls += 1;
          if (findFirstCalls === 1) return null;
          return {
            id: "raced-row-id",
            isComplete: false,
            endBlockNumber: BASE_INPUT.endBlockNumber,
            endTxHash: BASE_INPUT.endTxHash,
          };
        },
        async create() {
          createCalls += 1;
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed",
            { code: "P2002", clientVersion: "test", meta: { target: ["chainId", "walletAddress", "stakeId"] } },
          );
        },
        async update(args: { where: { id: string }; data: { isComplete: boolean } }) {
          return { id: args.where.id };
        },
      },
    };

    const result = await persistEndedHexStakeObservation(
      BASE_INPUT,
      client as unknown as Parameters<typeof persistEndedHexStakeObservation>[1],
    );

    // Same evidence → race resolved as a plain existing-row outcome.
    expect(result.conflict).toBe(false);
    expect(result.created).toBe(false);
    // The incoming is complete and the raced row was incomplete → upgraded.
    expect(result.updated).toBe(true);
    expect(result.id).toBe("raced-row-id");
    expect(createCalls).toBe(1);
    expect(findFirstCalls).toBe(2);
  });

  it("reconciles a Prisma P2002 race as a CONFLICT when raced row has different endBlockNumber", async () => {
    const { Prisma } = await import("@prisma/client");
    let findFirstCalls = 0;

    const client = {
      rawEndedHexStakeObservation: {
        async findFirst() {
          findFirstCalls += 1;
          if (findFirstCalls === 1) return null;
          return {
            id: "raced-row-id",
            isComplete: true,
            endBlockNumber: 99999999n,
            endTxHash: "0xotherwriter",
          };
        },
        async create() {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed",
            { code: "P2002", clientVersion: "test", meta: { target: ["chainId", "walletAddress", "stakeId"] } },
          );
        },
        async update() {
          throw new Error("update must not be called during conflict path");
        },
      },
    };

    const result = await persistEndedHexStakeObservation(
      BASE_INPUT,
      client as unknown as Parameters<typeof persistEndedHexStakeObservation>[1],
    );

    expect(result.conflict).toBe(true);
    expect(result.created).toBe(false);
    if (result.conflict) {
      expect(result.conflictReason).toMatch(/endBlockNumber/);
    }
    expect(findFirstCalls).toBe(2);
  });

  it("does not swallow non-P2002 Prisma errors from create", async () => {
    const { Prisma } = await import("@prisma/client");

    const client = {
      rawEndedHexStakeObservation: {
        async findFirst() {
          return null;
        },
        async create() {
          throw new Prisma.PrismaClientKnownRequestError(
            "Connection lost",
            { code: "P1017", clientVersion: "test" },
          );
        },
      },
    };

    await expect(
      persistEndedHexStakeObservation(
        BASE_INPUT,
        client as unknown as Parameters<typeof persistEndedHexStakeObservation>[1],
      ),
    ).rejects.toMatchObject({ code: "P1017" });
  });

  it("does not swallow generic (non-Prisma) errors from create", async () => {
    const client = {
      rawEndedHexStakeObservation: {
        async findFirst() {
          return null;
        },
        async create() {
          throw new Error("network exploded");
        },
      },
    };

    await expect(
      persistEndedHexStakeObservation(
        BASE_INPUT,
        client as unknown as Parameters<typeof persistEndedHexStakeObservation>[1],
      ),
    ).rejects.toThrow("network exploded");
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

describe("buildEndedStakeDedupeKey (canonical identity)", () => {
  it("produces a deterministic colon-delimited canonical-identity string", () => {
    const key = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xabcdef",
      stakeId: "942663",
    });
    expect(key).toBe("369:0xabcdef:942663");
  });

  it("normalizes walletAddress to lowercase in the key", () => {
    const key = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xAbCdEf",
      stakeId: "1",
    });
    expect(key).toBe("369:0xabcdef:1");
  });

  it("produces the SAME key for the same canonical stake regardless of discovery method or block", () => {
    // D-033: discoveryMethod, endBlockNumber, and endTxHash are evidence, not
    // identity. The canonical dedupe key must not include them, or a second
    // observation from a different source would appear to be a distinct stake.
    const key = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xabc",
      stakeId: "1",
    });
    expect(key).toBe("369:0xabc:1");
  });

  it("produces different keys for different chainIds (same stakeId, same wallet)", () => {
    const key1 = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xabc",
      stakeId: "1",
    });
    const key2 = buildEndedStakeDedupeKey({
      chainId: 1,
      walletAddress: "0xabc",
      stakeId: "1",
    });
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different wallets (same chainId, same stakeId)", () => {
    const key1 = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xaaa",
      stakeId: "1",
    });
    const key2 = buildEndedStakeDedupeKey({
      chainId: 369,
      walletAddress: "0xbbb",
      stakeId: "1",
    });
    expect(key1).not.toBe(key2);
  });
});

// ─── enrichEndedHexStakeObservation ────────────────────────────────────────────
//
// Historical-state evidence-recovery enrichment: an UPDATE-only, create-free
// path that upgrades an existing incomplete row in place, bound to its full
// canonical identity (id + chainId + walletAddress + stakeId + endBlockNumber)
// via a single atomic conditional updateMany. Verifies:
//
//   1. Happy path: incomplete row is upgraded in place.
//   2. Atomic update requires isComplete: false (a complete row is never hit).
//   3. Wrong id cannot mutate any row.
//   4. Right id + wrong stakeId cannot mutate that row.
//   5. Right id + wrong endBlockNumber cannot mutate that row.
//   6. Row became complete with matching values before the write →
//      concurrent_matching_completion, no mutation.
//   7. Row became complete with conflicting values before the write →
//      concurrent_conflict, no mutation.
//   8. Row vanished before the write → observation_missing.
//   9. Row's identity changed (still incomplete) before the write →
//      state_changed, no mutation.
//  10. discoveryMethod, observedAt, endTxHash, and all untouched fields are
//      byte-for-byte preserved.
//  11. No create/insert path exists on this function at all.

function makeIncompleteRow(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    id: `mock-id-${++idCounter}`,
    chainId: 369,
    walletAddress: "0x75f808367720951e789d47e9e9db51148d9aa765",
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

function makeEnrichInput(
  row: StoredRow,
  overrides: Partial<EnrichEndedHexStakeObservationInput> = {},
): EnrichEndedHexStakeObservationInput {
  return {
    id: row.id,
    chainId: row.chainId,
    walletAddress: row.walletAddress,
    stakeId: row.stakeId,
    endBlockNumber: row.endBlockNumber,
    lockedDay: 683,
    stakeShares: "442200077208",
    evidenceRecoveryMethod: "historical_contract_state",
    evidenceRecoveryBlockNumber: row.endBlockNumber - 1n,
    evidenceRecoverySourceContract: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
    evidenceRecoverySourceFunction: "stakeLists",
    evidenceRecoveryReturnedStakeId: row.stakeId,
    evidenceRecoveredAt: new Date("2026-07-23T00:00:00Z"),
    ...overrides,
  };
}

describe("enrichEndedHexStakeObservation", () => {
  it("upgrades an incomplete row in place and returns outcome: updated", async () => {
    const row = makeIncompleteRow();
    const db = makeMockDb([row]);

    const result = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(result.outcome).toBe("updated");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    const updated = rows.find((r) => r.id === row.id)!;
    expect(updated.isComplete).toBe(true);
    expect(updated.lockedDay).toBe(683);
    expect(updated.stakeShares).toBe("442200077208");
    expect(updated.warnings).toEqual([]);
    expect(updated.evidenceRecoveryMethod).toBe("historical_contract_state");
    expect(updated.evidenceRecoveryBlockNumber).toBe(row.endBlockNumber - 1n);
    expect(updated.evidenceRecoverySourceContract).toBe(
      "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
    );
    expect(updated.evidenceRecoverySourceFunction).toBe("stakeLists");
    expect(updated.evidenceRecoveryReturnedStakeId).toBe(row.stakeId);
    expect(updated.evidenceRecoveredAt).toEqual(new Date("2026-07-23T00:00:00Z"));
  });

  it("preserves discoveryMethod, observedAt, endTxHash, and all untouched fields byte-for-byte", async () => {
    const row = makeIncompleteRow({
      startTxHash: null,
      startBlockNumber: null,
      principalHex: "700000000000",
    });
    const db = makeMockDb([row]);

    await enrichEndedHexStakeObservation(makeEnrichInput(row), db);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    const updated = rows.find((r) => r.id === row.id)!;
    expect(updated.discoveryMethod).toBe("raw_stake_action");
    expect(updated.observedAt).toEqual(row.observedAt);
    expect(updated.endTxHash).toBe(row.endTxHash);
    expect(updated.endBlockNumber).toBe(row.endBlockNumber);
    expect(updated.startTxHash).toBeNull();
    expect(updated.startBlockNumber).toBeNull();
    expect(updated.principalHex).toBe("700000000000");
    expect(updated.chainId).toBe(row.chainId);
    expect(updated.walletAddress).toBe(row.walletAddress);
    expect(updated.stakeId).toBe(row.stakeId);
  });

  it("never mutates an already-complete row (atomic update requires isComplete: false)", async () => {
    const row = makeIncompleteRow({
      isComplete: true,
      lockedDay: 683,
      stakeShares: "442200077208",
      warnings: [],
    });
    const db = makeMockDb([row]);

    const result = await enrichEndedHexStakeObservation(
      makeEnrichInput(row, { lockedDay: 999, stakeShares: "1" }),
      db,
    );

    // Values match exactly what's already stored → concurrent_matching_completion
    // is NOT the classification here because the input itself intentionally
    // supplies different (999/"1") values to prove the row is never touched;
    // re-read must show conflicting values against a complete row.
    expect(result.outcome).toBe("concurrent_conflict");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    const unchanged = rows.find((r) => r.id === row.id)!;
    expect(unchanged.lockedDay).toBe(683);
    expect(unchanged.stakeShares).toBe("442200077208");
  });

  it("returns concurrent_matching_completion when the row is already complete with identical evidence", async () => {
    const row = makeIncompleteRow({
      isComplete: true,
      lockedDay: 683,
      stakeShares: "442200077208",
      warnings: [],
    });
    const db = makeMockDb([row]);

    const result = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(result.outcome).toBe("concurrent_matching_completion");
  });

  it("wrong id cannot mutate any row", async () => {
    const row = makeIncompleteRow();
    const db = makeMockDb([row]);

    const result = await enrichEndedHexStakeObservation(
      makeEnrichInput(row, { id: "does-not-exist" }),
      db,
    );
    expect(result.outcome).toBe("observation_missing");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.isComplete).toBe(false);
  });

  it("right id with wrong stakeId cannot mutate that row (fails closed, no cross-stake write)", async () => {
    const target = makeIncompleteRow({ stakeId: "507128" });
    const other = makeIncompleteRow({ stakeId: "655741" });
    const db = makeMockDb([target, other]);

    // Caller bug: id points at `target`, but the evidence payload claims a
    // different stakeId — must never silently write target's row with
    // mismatched-stake evidence.
    const result = await enrichEndedHexStakeObservation(
      makeEnrichInput(target, { stakeId: "655741" }),
      db,
    );
    expect(result.outcome).toBe("state_changed");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: target.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === target.id)!.isComplete).toBe(false);
    expect(rows.find((r) => r.id === other.id)!.isComplete).toBe(false);
  });

  it("right id with wrong endBlockNumber cannot mutate that row", async () => {
    const row = makeIncompleteRow({ endBlockNumber: 15767882n });
    const db = makeMockDb([row]);

    const result = await enrichEndedHexStakeObservation(
      makeEnrichInput(row, { endBlockNumber: 99999999n }),
      db,
    );
    expect(result.outcome).toBe("state_changed");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.isComplete).toBe(false);
  });

  it("unrelated observation for a different wallet is never touched", async () => {
    const target = makeIncompleteRow();
    const unrelated = makeIncompleteRow({
      walletAddress: "0x0000000000000000000000000000000000dead",
      stakeId: "1",
    });
    const db = makeMockDb([target, unrelated]);

    await enrichEndedHexStakeObservation(makeEnrichInput(target), db);

    const unrelatedRows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: unrelated.walletAddress },
      db,
    );
    expect(unrelatedRows[0]!.isComplete).toBe(false);
    expect(unrelatedRows[0]!.evidenceRecoveryMethod).toBeNull();
  });

  it("rerun after a successful update is idempotent (no duplicate row, no re-write)", async () => {
    const row = makeIncompleteRow();
    const db = makeMockDb([row]);

    const first = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(first.outcome).toBe("updated");

    const second = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(second.outcome).toBe("concurrent_matching_completion");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.filter((r) => r.stakeId === row.stakeId)).toHaveLength(1);
  });

  it("has no create/insert path — enrichment can only ever update an existing row", () => {
    // Structural proof: enrichEndedHexStakeObservation's exported type never
    // accepts data sufficient to create a row (no endTxHash/discoveryMethod/
    // observedAt in its input), and its client contract type only exposes
    // updateMany + findUnique, never create. This test documents that contract;
    // a TypeScript compile failure here would indicate the create-free
    // guarantee was broken.
    const input: EnrichEndedHexStakeObservationInput = makeEnrichInput(makeIncompleteRow());
    expect("endTxHash" in input).toBe(false);
    expect("discoveryMethod" in input).toBe(false);
    expect("observedAt" in input).toBe(false);
    expect("warnings" in input).toBe(false);
  });
});

// ─── enrichEndedHexStakeObservation — warning preservation ────────────────────
//
// enrichEndedHexStakeObservation no longer accepts a caller-supplied warnings
// array. It reads the row's *current* persisted warnings itself, removes only
// the obsolete "hexmining-ended-stake-lockedday-unknown" code, and preserves
// every other warning verbatim and in order. The write is additionally bound
// (via the where clause) to warnings staying exactly what was just read, so a
// concurrent warning change fails the conditional update closed instead of
// being silently overwritten.

const OBSOLETE_WARNING = "hexmining-ended-stake-lockedday-unknown";

describe("enrichEndedHexStakeObservation: warning preservation", () => {
  it("removes the sole lockedday-unknown warning, leaving []", async () => {
    const row = makeIncompleteRow({ warnings: [OBSOLETE_WARNING] });
    const db = makeMockDb([row]);

    const result = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(result.outcome).toBe("updated");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.warnings).toEqual([]);
  });

  it("preserves unrelated warnings alongside the obsolete one", async () => {
    const row = makeIncompleteRow({
      warnings: ["hexmining-some-other-diagnostic", OBSOLETE_WARNING, "hexmining-another-note"],
    });
    const db = makeMockDb([row]);

    await enrichEndedHexStakeObservation(makeEnrichInput(row), db);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.warnings).toEqual([
      "hexmining-some-other-diagnostic",
      "hexmining-another-note",
    ]);
  });

  it("preserves a row that only has unrelated warnings (no obsolete code present)", async () => {
    const row = makeIncompleteRow({ warnings: ["hexmining-some-other-diagnostic"] });
    const db = makeMockDb([row]);

    await enrichEndedHexStakeObservation(makeEnrichInput(row), db);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.warnings).toEqual(["hexmining-some-other-diagnostic"]);
  });

  it("removes every duplicate occurrence of the obsolete warning", async () => {
    const row = makeIncompleteRow({
      warnings: [OBSOLETE_WARNING, "hexmining-some-other-diagnostic", OBSOLETE_WARNING, OBSOLETE_WARNING],
    });
    const db = makeMockDb([row]);

    await enrichEndedHexStakeObservation(makeEnrichInput(row), db);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.warnings).toEqual(["hexmining-some-other-diagnostic"]);
  });

  it("preserves the relative order of the remaining warnings", async () => {
    const row = makeIncompleteRow({
      warnings: ["hexmining-a", OBSOLETE_WARNING, "hexmining-b", "hexmining-c"],
    });
    const db = makeMockDb([row]);

    await enrichEndedHexStakeObservation(makeEnrichInput(row), db);

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.warnings).toEqual([
      "hexmining-a",
      "hexmining-b",
      "hexmining-c",
    ]);
  });

  it("does not erase warnings when the row concurrently completed before the write", async () => {
    // The row completed (with matching evidence) between the pre-read and the
    // conditional update — simulated here by making it already complete with
    // matching values and the unrelated warning still attached. No write may
    // occur, so the unrelated warning must remain exactly as persisted.
    const row = makeIncompleteRow({
      isComplete: true,
      lockedDay: 683,
      stakeShares: "442200077208",
      warnings: ["hexmining-some-other-diagnostic"],
    });
    const db = makeMockDb([row]);

    const result = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(result.outcome).toBe("concurrent_matching_completion");

    const rows = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(rows.find((r) => r.id === row.id)!.warnings).toEqual([
      "hexmining-some-other-diagnostic",
    ]);
  });

  it("fails closed instead of overwriting when warnings change concurrently between read and write", async () => {
    // Custom persistence client (not the shared array-backed mock) that
    // simulates a genuine race: the pre-read (findUnique call #1) returns the
    // warnings as they existed at read time, but a concurrent process appends
    // a new diagnostic before the conditional write lands, so updateMany's
    // where-clause (bound to the pre-read warnings) never matches — the DB
    // itself is the source of truth for whether the compare-and-swap
    // succeeds, not anything this function assumes. On the re-read
    // (findUnique call #2) the row is still incomplete with the new warning
    // now present, so the outcome is state_changed and nothing is ever
    // overwritten.
    const row = makeIncompleteRow({ warnings: ["hexmining-a"] });
    const trueWarningsAfterRace = ["hexmining-a", "hexmining-concurrently-appended"];
    let findUniqueCalls = 0;

    const client = {
      rawEndedHexStakeObservation: {
        findUnique: async () => {
          findUniqueCalls += 1;
          return {
            chainId: row.chainId,
            walletAddress: row.walletAddress,
            stakeId: row.stakeId,
            endBlockNumber: row.endBlockNumber,
            isComplete: false,
            lockedDay: null,
            stakeShares: null,
            warnings: findUniqueCalls === 1 ? row.warnings : trueWarningsAfterRace,
          };
        },
        updateMany: async (args: { where: { warnings: { equals: string[] } } }) => {
          const eq =
            args.where.warnings.equals.length === trueWarningsAfterRace.length &&
            args.where.warnings.equals.every((w, i) => w === trueWarningsAfterRace[i]);
          return { count: eq ? 1 : 0 };
        },
      },
      // No `create` — proves this path never even attempts to construct one.
    };

    const result = await enrichEndedHexStakeObservation(
      makeEnrichInput(row),
      client as unknown as Parameters<typeof enrichEndedHexStakeObservation>[1],
    );

    expect(result.outcome).toBe("state_changed");
    expect(findUniqueCalls).toBe(2);
  });

  it("idempotent rerun after a successful update preserves the remaining warnings (no re-add, no loss)", async () => {
    const row = makeIncompleteRow({
      warnings: [OBSOLETE_WARNING, "hexmining-some-other-diagnostic"],
    });
    const db = makeMockDb([row]);

    const first = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(first.outcome).toBe("updated");

    const afterFirst = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(afterFirst.find((r) => r.id === row.id)!.warnings).toEqual([
      "hexmining-some-other-diagnostic",
    ]);

    const second = await enrichEndedHexStakeObservation(makeEnrichInput(row), db);
    expect(second.outcome).toBe("concurrent_matching_completion");

    const afterSecond = await readEndedHexStakeObservations(
      { chainId: 369, walletAddress: row.walletAddress },
      db,
    );
    expect(afterSecond.find((r) => r.id === row.id)!.warnings).toEqual([
      "hexmining-some-other-diagnostic",
    ]);
  });
});
