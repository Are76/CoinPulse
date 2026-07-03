// HexMining Phase 6 — HSI stake observation store hardened identity tests
//
// Verifies the write and read contracts for RawHsiStakeObservation after
// identity hardening (PR #313). Changes from Phase 6 Slice 1:
//
//   - hsiTokenId is now a decimal string (uint256-safe, not BIGINT)
//   - hsiAddress is normalized to lowercase and included in the dedupe tuple
//   - Dedupe tuple: chainId, walletAddress, hsiAddress, hsiTokenId, observedAtBlock
//   - upsert with P2002 catch replaces findFirst + create (race-safe)
//   - validateHsiTokenId rejects invalid token ID strings
//
// Contract tests:
//   1.  persistHsiStakeObservation creates a new row and returns created: true.
//   2.  Second write with the same full dedupe tuple returns created: false.
//   3.  Different observedAtBlock → new row.
//   4.  Different hsiTokenId → new row.
//   5.  walletAddress normalized to lowercase before write and dedup check.
//   6.  hsiAddress normalized to lowercase before write and dedup check.
//   7.  Same token ID on a different hsiAddress → new row (different contract).
//   8.  Nullable fields stored without coercion.
//   9.  readHsiStakeObservations returns rows ordered by observedAtBlock asc,
//       hsiTokenId asc as tie-breaker.
//  10.  readHsiStakeObservations scopes results to chainId and walletAddress.
//  11.  All fields map correctly to PersistedHsiStakeObservation.
//  12.  readHsiStakeObservations normalizes walletAddress on read query.
//  13.  hsiTokenId accepts very large uint256-sized decimal strings.
//  14.  validateHsiTokenId rejects negative, fractional, scientific-notation,
//       empty, and non-numeric strings.
//  15.  "0" is a valid hsiTokenId.
//  16.  Simulated P2002 race: concurrent writer conflict returns created: false.
//  17.  buildHsiObservationDedupeKey produces the expected colon-delimited string.
//  18.  buildHsiObservationDedupeKey normalizes walletAddress and hsiAddress.
//  19.  Different hsiAddress values produce different dedup keys.
//
// No live database, no RPC, no network. Pure in-memory mock.

import { describe, expect, it } from "vitest";

import {
  buildHsiObservationDedupeKey,
  persistHsiStakeObservation,
  readHsiStakeObservations,
  validateHsiTokenId,
  type PersistHsiStakeObservationInput,
  type PersistedHsiStakeObservation,
} from "@/services/hexmining/hsi-observation-store";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

type StoredRow = {
  id: string;
  chainId: number;
  walletAddress: string;
  hsiTokenId: string;
  hsiAddress: string;
  stakeId: string | null;
  stakeIndex: number | null;
  stakedDays: number | null;
  lockedDay: number | null;
  stakeShares: string | null;
  principalHex: string | null;
  observedAtBlock: bigint;
  observedAt: Date;
  isComplete: boolean;
  warnings: string[];
  createdAt: Date;
};

let idCounter = 0;

function makeMockDb(initial: StoredRow[] = []) {
  const rows: StoredRow[] = [...initial];

  // Simulate the unique constraint on (chainId, walletAddress, hsiAddress, hsiTokenId, observedAtBlock).
  function findByDedup(
    chainId: number,
    walletAddress: string,
    hsiAddress: string,
    hsiTokenId: string,
    observedAtBlock: bigint,
  ): StoredRow | undefined {
    return rows.find(
      (r) =>
        r.chainId === chainId &&
        r.walletAddress === walletAddress &&
        r.hsiAddress === hsiAddress &&
        r.hsiTokenId === hsiTokenId &&
        r.observedAtBlock === observedAtBlock,
    );
  }

  return {
    rawHsiStakeObservation: {
      async create(args: {
        data: Omit<StoredRow, "id" | "createdAt">;
        select: { id: true };
      }) {
        const d = args.data;
        if (findByDedup(d.chainId, d.walletAddress, d.hsiAddress, d.hsiTokenId, d.observedAtBlock)) {
          const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          Object.setPrototypeOf(
            err,
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require("@prisma/client").Prisma.PrismaClientKnownRequestError.prototype,
          );
          throw err;
        }
        const row: StoredRow = {
          id: `mock-id-${++idCounter}`,
          createdAt: new Date("2026-07-03T00:00:00Z"),
          ...d,
        };
        rows.push(row);
        return { id: row.id };
      },

      async findFirst(args: {
        where: {
          chainId: number;
          walletAddress: string;
          hsiAddress: string;
          hsiTokenId: string;
          observedAtBlock: bigint;
        };
        select: { id: true };
      }) {
        const w = args.where;
        const match = findByDedup(w.chainId, w.walletAddress, w.hsiAddress, w.hsiTokenId, w.observedAtBlock);
        return match ? { id: match.id } : null;
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

        const fieldOf = (
          r: StoredRow,
          field: string,
        ): string | bigint | number => {
          if (field === "observedAtBlock") return r.observedAtBlock;
          if (field === "hsiTokenId") return r.hsiTokenId;
          if (field === "id") return r.id;
          return "";
        };

        return filtered.sort((a, b) => {
          for (const entry of args.orderBy) {
            const [field, dir] = Object.entries(entry)[0] as [
              string,
              "asc" | "desc",
            ];
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

// Mock DB that throws a P2002 on create (simulating concurrent writer race),
// then returns the pre-existing row on findFirst.
function makeRaceConflictDb(existingRow: StoredRow) {
  return {
    rawHsiStakeObservation: {
      async create() {
        const err = Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          name: "PrismaClientKnownRequestError",
        });
        Object.setPrototypeOf(
          err,
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("@prisma/client").Prisma.PrismaClientKnownRequestError
            .prototype,
        );
        throw err;
      },
      async findFirst() {
        return { id: existingRow.id };
      },
      async findMany() {
        return [existingRow];
      },
    },
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const HEDRON_ADDRESS = "0x8bd3d1472a656e312e94fb1bbdd599b8c51d18e3";
const HEDRON_ADDRESS_2 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OBSERVED_AT = new Date("2026-07-03T12:00:00Z");

const BASE_INPUT: PersistHsiStakeObservationInput = {
  chainId: 369,
  walletAddress: "0xAbCdEf0000000000000000000000000000000001",
  hsiTokenId: "42",
  hsiAddress: HEDRON_ADDRESS,
  stakeId: "942663",
  stakeIndex: 0,
  stakedDays: 5555,
  lockedDay: 2310,
  stakeShares: "1414291579679",
  principalHex: "1000000000000000",
  observedAtBlock: 21000000n,
  observedAt: OBSERVED_AT,
  isComplete: true,
  warnings: [],
};

// ─── persistHsiStakeObservation ───────────────────────────────────────────────

describe("persistHsiStakeObservation", () => {
  it("creates a new row and returns created: true on first write", async () => {
    const db = makeMockDb();
    const result = await persistHsiStakeObservation(BASE_INPUT, db);
    expect(result.created).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("is idempotent: second write with same full dedupe tuple returns created: false", async () => {
    const db = makeMockDb();
    const first = await persistHsiStakeObservation(BASE_INPUT, db);
    const second = await persistHsiStakeObservation(BASE_INPUT, db);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("writes a new row when observedAtBlock differs", async () => {
    const db = makeMockDb();
    const first = await persistHsiStakeObservation(
      { ...BASE_INPUT, observedAtBlock: 21000000n },
      db,
    );
    const second = await persistHsiStakeObservation(
      { ...BASE_INPUT, observedAtBlock: 22000000n },
      db,
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  it("writes a new row when hsiTokenId differs", async () => {
    const db = makeMockDb();
    const first = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: "1" },
      db,
    );
    const second = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: "2" },
      db,
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  it("normalizes walletAddress to lowercase before write and dedup check", async () => {
    const db = makeMockDb();
    const input: PersistHsiStakeObservationInput = {
      ...BASE_INPUT,
      walletAddress: "0xAbCdEf0000000000000000000000000000000002",
    };
    await persistHsiStakeObservation(input, db);
    const result = await persistHsiStakeObservation(
      { ...input, walletAddress: input.walletAddress.toLowerCase() },
      db,
    );
    expect(result.created).toBe(false);
  });

  it("normalizes hsiAddress to lowercase before write and dedup check", async () => {
    const db = makeMockDb();
    const upper = HEDRON_ADDRESS.toUpperCase();
    await persistHsiStakeObservation({ ...BASE_INPUT, hsiAddress: upper }, db);
    const result = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiAddress: HEDRON_ADDRESS },
      db,
    );
    expect(result.created).toBe(false);
  });

  it("same token ID at same block on a different hsiAddress creates a separate row", async () => {
    const db = makeMockDb();
    const first = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiAddress: HEDRON_ADDRESS },
      db,
    );
    const second = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiAddress: HEDRON_ADDRESS_2 },
      db,
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
  });

  it("stores null nullable fields without coercing them", async () => {
    const db = makeMockDb();
    const input: PersistHsiStakeObservationInput = {
      ...BASE_INPUT,
      hsiTokenId: "99",
      stakeId: null,
      stakeIndex: null,
      stakedDays: null,
      lockedDay: null,
      stakeShares: null,
      principalHex: null,
      isComplete: false,
      warnings: ["hexmining-hsi-stake-fields-unknown"],
    };
    const result = await persistHsiStakeObservation(input, db);
    expect(result.created).toBe(true);

    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: input.walletAddress },
      db,
    );
    const row = rows.find((r) => r.hsiTokenId === "99");
    expect(row).toBeDefined();
    expect(row!.stakeId).toBeNull();
    expect(row!.stakeIndex).toBeNull();
    expect(row!.stakedDays).toBeNull();
    expect(row!.lockedDay).toBeNull();
    expect(row!.stakeShares).toBeNull();
    expect(row!.principalHex).toBeNull();
    expect(row!.isComplete).toBe(false);
    expect(row!.warnings).toContain("hexmining-hsi-stake-fields-unknown");
  });

  it("accepts a very large uint256-sized decimal token ID", async () => {
    const db = makeMockDb();
    const largeId =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const result = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: largeId },
      db,
    );
    expect(result.created).toBe(true);
    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    const row = rows.find((r) => r.hsiTokenId === largeId);
    expect(row).toBeDefined();
    expect(row!.hsiTokenId).toBe(largeId);
  });

  it("simulated P2002 race returns created: false with the pre-existing id", async () => {
    const existingRow: StoredRow = {
      id: "existing-id-race",
      chainId: BASE_INPUT.chainId,
      walletAddress: BASE_INPUT.walletAddress.toLowerCase(),
      hsiTokenId: BASE_INPUT.hsiTokenId,
      hsiAddress: HEDRON_ADDRESS,
      stakeId: null,
      stakeIndex: null,
      stakedDays: null,
      lockedDay: null,
      stakeShares: null,
      principalHex: null,
      observedAtBlock: BASE_INPUT.observedAtBlock,
      observedAt: OBSERVED_AT,
      isComplete: false,
      warnings: [],
      createdAt: new Date("2026-07-03T00:00:00Z"),
    };
    const db = makeRaceConflictDb(existingRow);
    const result = await persistHsiStakeObservation(
      BASE_INPUT,
      db as unknown as Parameters<typeof persistHsiStakeObservation>[1],
    );
    expect(result.created).toBe(false);
    expect(result.id).toBe("existing-id-race");
  });
});

// ─── readHsiStakeObservations ─────────────────────────────────────────────────

describe("readHsiStakeObservations", () => {
  it("returns empty array when no rows exist", async () => {
    const db = makeMockDb();
    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: "0xnobody" },
      db,
    );
    expect(rows).toEqual([]);
  });

  it("returns rows ordered by observedAtBlock ascending", async () => {
    const db = makeMockDb();
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: "2", observedAtBlock: 22000000n },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: "1", observedAtBlock: 19000000n },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: "3", observedAtBlock: 25000000n },
      db,
    );

    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows.map((r) => r.hsiTokenId)).toEqual(["1", "2", "3"]);
    expect(rows[0].observedAtBlock).toBe(19000000n);
    expect(rows[2].observedAtBlock).toBe(25000000n);
  });

  it("scopes results to chainId and walletAddress", async () => {
    const db = makeMockDb();
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: "1", chainId: 369 },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: "2", chainId: 1 },
      db,
    );
    await persistHsiStakeObservation(
      {
        ...BASE_INPUT,
        hsiTokenId: "3",
        walletAddress: "0x0000000000000000000000000000000000000002",
      },
      db,
    );

    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hsiTokenId).toBe("1");
  });

  it("maps all fields correctly from stored row", async () => {
    const db = makeMockDb();
    await persistHsiStakeObservation(BASE_INPUT, db);

    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    const row: PersistedHsiStakeObservation = rows[0];

    expect(row.chainId).toBe(369);
    expect(row.walletAddress).toBe(BASE_INPUT.walletAddress.toLowerCase());
    expect(row.hsiTokenId).toBe("42");
    expect(row.hsiAddress).toBe(HEDRON_ADDRESS);
    expect(row.stakeId).toBe("942663");
    expect(row.stakeIndex).toBe(0);
    expect(row.stakedDays).toBe(5555);
    expect(row.lockedDay).toBe(2310);
    expect(row.stakeShares).toBe("1414291579679");
    expect(row.principalHex).toBe("1000000000000000");
    expect(row.observedAtBlock).toBe(21000000n);
    expect(row.observedAt).toEqual(OBSERVED_AT);
    expect(row.isComplete).toBe(true);
    expect(row.warnings).toEqual([]);
    expect(typeof row.id).toBe("string");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("normalizes walletAddress to lowercase on read query", async () => {
    const db = makeMockDb();
    await persistHsiStakeObservation(BASE_INPUT, db);

    const rows = await readHsiStakeObservations(
      {
        chainId: 369,
        walletAddress: BASE_INPUT.walletAddress.toUpperCase(),
      },
      db,
    );
    expect(rows).toHaveLength(1);
  });
});

// ─── validateHsiTokenId ───────────────────────────────────────────────────────

describe("validateHsiTokenId", () => {
  it("accepts valid decimal integer strings", () => {
    expect(() => validateHsiTokenId("0")).not.toThrow();
    expect(() => validateHsiTokenId("1")).not.toThrow();
    expect(() => validateHsiTokenId("42")).not.toThrow();
    expect(() =>
      validateHsiTokenId(
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      )
    ).not.toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => validateHsiTokenId("")).toThrow();
  });

  it("rejects negative values", () => {
    expect(() => validateHsiTokenId("-1")).toThrow();
    expect(() => validateHsiTokenId("-42")).toThrow();
  });

  it("rejects decimal fractions", () => {
    expect(() => validateHsiTokenId("1.5")).toThrow();
    expect(() => validateHsiTokenId("0.0")).toThrow();
  });

  it("rejects scientific notation", () => {
    expect(() => validateHsiTokenId("1e10")).toThrow();
    expect(() => validateHsiTokenId("1E10")).toThrow();
  });

  it("rejects leading zeros (except bare zero)", () => {
    expect(() => validateHsiTokenId("01")).toThrow();
    expect(() => validateHsiTokenId("007")).toThrow();
  });

  it("rejects non-numeric strings", () => {
    expect(() => validateHsiTokenId("abc")).toThrow();
    expect(() => validateHsiTokenId("0x2a")).toThrow();
  });
});

// ─── buildHsiObservationDedupeKey ────────────────────────────────────────────

describe("buildHsiObservationDedupeKey", () => {
  it("produces a deterministic colon-delimited string including hsiAddress", () => {
    const key = buildHsiObservationDedupeKey({
      chainId: 369,
      walletAddress: "0xabcdef",
      hsiAddress: HEDRON_ADDRESS,
      hsiTokenId: "42",
      observedAtBlock: 21000000n,
    });
    expect(key).toBe(`369:0xabcdef:${HEDRON_ADDRESS}:42:21000000`);
  });

  it("normalizes walletAddress and hsiAddress to lowercase", () => {
    const key = buildHsiObservationDedupeKey({
      chainId: 369,
      walletAddress: "0xAbCdEf",
      hsiAddress: HEDRON_ADDRESS.toUpperCase(),
      hsiTokenId: "1",
      observedAtBlock: 1n,
    });
    expect(key).toBe(`369:0xabcdef:${HEDRON_ADDRESS}:1:1`);
  });

  it("produces different keys for different hsiAddresses with the same token ID", () => {
    const base = {
      chainId: 369,
      walletAddress: "0xabc",
      hsiTokenId: "42",
      observedAtBlock: 100n,
    };
    const key1 = buildHsiObservationDedupeKey({
      ...base,
      hsiAddress: HEDRON_ADDRESS,
    });
    const key2 = buildHsiObservationDedupeKey({
      ...base,
      hsiAddress: HEDRON_ADDRESS_2,
    });
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different hsiTokenIds", () => {
    const base = {
      chainId: 369,
      walletAddress: "0xabc",
      hsiAddress: HEDRON_ADDRESS,
      observedAtBlock: 100n,
    };
    expect(
      buildHsiObservationDedupeKey({ ...base, hsiTokenId: "1" }),
    ).not.toBe(buildHsiObservationDedupeKey({ ...base, hsiTokenId: "2" }));
  });

  it("produces different keys for different observedAtBlocks", () => {
    const base = {
      chainId: 369,
      walletAddress: "0xabc",
      hsiAddress: HEDRON_ADDRESS,
      hsiTokenId: "42",
    };
    expect(
      buildHsiObservationDedupeKey({ ...base, observedAtBlock: 21000000n }),
    ).not.toBe(
      buildHsiObservationDedupeKey({ ...base, observedAtBlock: 22000000n }),
    );
  });

  it("produces different keys for different chainIds", () => {
    const base = {
      walletAddress: "0xabc",
      hsiAddress: HEDRON_ADDRESS,
      hsiTokenId: "42",
      observedAtBlock: 100n,
    };
    expect(buildHsiObservationDedupeKey({ ...base, chainId: 369 })).not.toBe(
      buildHsiObservationDedupeKey({ ...base, chainId: 1 }),
    );
  });
});
