// HexMining Phase 6 Slice 1 — HSI stake observation store contract tests
//
// Verifies the write and read contracts for RawHsiStakeObservation:
//
//   1. persistHsiStakeObservation creates a new row on first write.
//   2. persistHsiStakeObservation is idempotent: a second write with the same
//      dedup key (chainId, walletAddress, hsiTokenId, observedAtBlock) returns
//      created: false and does not write a second row.
//   3. A different observedAtBlock for the same HSI token produces a new row.
//   4. walletAddress is normalized to lowercase before write and read.
//   5. Nullable fields (stakeId, stakeIndex, lockedDay, etc.) are stored as-is
//      — the store never coerces null to zero or a default value.
//   6. readHsiStakeObservations returns rows ordered by observedAtBlock asc.
//   7. buildHsiObservationDedupeKey produces a deterministic colon-delimited
//      string.
//   8. readHsiStakeObservations scopes results to chainId and walletAddress.
//   9. All fields map correctly from persisted row to PersistedHsiStakeObservation.
//
// No live database, no RPC, no network. Pure in-memory mock.

import { describe, expect, it } from "vitest";

import {
  buildHsiObservationDedupeKey,
  persistHsiStakeObservation,
  readHsiStakeObservations,
  type PersistHsiStakeObservationInput,
  type PersistedHsiStakeObservation,
} from "@/services/hexmining/hsi-observation-store";

// ─── Mock DB factory ──────────────────────────────────────────────────────────

type StoredRow = {
  id: string;
  chainId: number;
  walletAddress: string;
  hsiTokenId: bigint;
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

  return {
    rawHsiStakeObservation: {
      async findFirst(args: {
        where: {
          chainId: number;
          walletAddress: string;
          hsiTokenId: bigint;
          observedAtBlock: bigint;
        };
        select: { id: true };
      }) {
        const match = rows.find(
          (r) =>
            r.chainId === args.where.chainId &&
            r.walletAddress === args.where.walletAddress &&
            r.hsiTokenId === args.where.hsiTokenId &&
            r.observedAtBlock === args.where.observedAtBlock,
        );
        return match ? { id: match.id } : null;
      },
      async create(args: { data: Omit<StoredRow, "id" | "createdAt"> }) {
        const row: StoredRow = {
          id: `mock-id-${++idCounter}`,
          createdAt: new Date("2026-07-03T00:00:00Z"),
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

// ─── Test fixtures ────────────────────────────────────────────────────────────

const HEDRON_ADDRESS = "0x8bd3d1472a656e312e94fb1bbdd599b8c51d18e3";
const OBSERVED_AT = new Date("2026-07-03T12:00:00Z");

const BASE_INPUT: PersistHsiStakeObservationInput = {
  chainId: 369,
  walletAddress: "0xAbCdEf0000000000000000000000000000000001",
  hsiTokenId: 42n,
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("persistHsiStakeObservation", () => {
  it("creates a new row and returns created: true on first write", async () => {
    const db = makeMockDb();
    const result = await persistHsiStakeObservation(BASE_INPUT, db);
    expect(result.created).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("is idempotent: second write with same dedup key returns created: false", async () => {
    const db = makeMockDb();
    const first = await persistHsiStakeObservation(BASE_INPUT, db);
    const second = await persistHsiStakeObservation(BASE_INPUT, db);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("writes a second row when observedAtBlock differs", async () => {
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

  it("writes a second row when hsiTokenId differs", async () => {
    const db = makeMockDb();
    const first = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 1n },
      db,
    );
    const second = await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 2n },
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
    // Second write with same address in lowercase should dedup
    const result = await persistHsiStakeObservation(
      { ...input, walletAddress: input.walletAddress.toLowerCase() },
      db,
    );
    expect(result.created).toBe(false);
  });

  it("stores null nullable fields without coercing them", async () => {
    const db = makeMockDb();
    const input: PersistHsiStakeObservationInput = {
      ...BASE_INPUT,
      hsiTokenId: 99n,
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
    const row = rows.find((r) => r.hsiTokenId === 99n);
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
});

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
      { ...BASE_INPUT, hsiTokenId: 2n, observedAtBlock: 22000000n },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 1n, observedAtBlock: 19000000n },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 3n, observedAtBlock: 25000000n },
      db,
    );

    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows.map((r) => r.hsiTokenId)).toEqual([1n, 2n, 3n]);
    expect(rows[0].observedAtBlock).toBe(19000000n);
    expect(rows[2].observedAtBlock).toBe(25000000n);
  });

  it("uses hsiTokenId as secondary sort key when observedAtBlock ties", async () => {
    const db = makeMockDb();
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 300n, observedAtBlock: 20000000n },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 100n, observedAtBlock: 20000000n },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 200n, observedAtBlock: 20000000n },
      db,
    );

    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows.map((r) => r.hsiTokenId)).toEqual([100n, 200n, 300n]);
  });

  it("scopes results to chainId and walletAddress", async () => {
    const db = makeMockDb();
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 1n, chainId: 369 },
      db,
    );
    await persistHsiStakeObservation(
      { ...BASE_INPUT, hsiTokenId: 2n, chainId: 1 },
      db,
    );
    await persistHsiStakeObservation(
      {
        ...BASE_INPUT,
        hsiTokenId: 3n,
        walletAddress: "0x0000000000000000000000000000000000000002",
      },
      db,
    );

    const rows = await readHsiStakeObservations(
      { chainId: 369, walletAddress: BASE_INPUT.walletAddress },
      db,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hsiTokenId).toBe(1n);
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
    expect(row.hsiTokenId).toBe(42n);
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

    // Query with mixed-case address should still find the row
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

describe("buildHsiObservationDedupeKey", () => {
  it("produces a deterministic colon-delimited string", () => {
    const key = buildHsiObservationDedupeKey({
      chainId: 369,
      walletAddress: "0xabcdef",
      hsiTokenId: 42n,
      observedAtBlock: 21000000n,
    });
    expect(key).toBe("369:0xabcdef:42:21000000");
  });

  it("normalizes walletAddress to lowercase in the key", () => {
    const key = buildHsiObservationDedupeKey({
      chainId: 369,
      walletAddress: "0xAbCdEf",
      hsiTokenId: 1n,
      observedAtBlock: 1n,
    });
    expect(key).toBe("369:0xabcdef:1:1");
  });

  it("produces different keys for different hsiTokenIds", () => {
    const base = {
      chainId: 369,
      walletAddress: "0xabc",
      observedAtBlock: 100n,
    };
    const key1 = buildHsiObservationDedupeKey({ ...base, hsiTokenId: 1n });
    const key2 = buildHsiObservationDedupeKey({ ...base, hsiTokenId: 2n });
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different observedAtBlocks", () => {
    const base = {
      chainId: 369,
      walletAddress: "0xabc",
      hsiTokenId: 42n,
    };
    const key1 = buildHsiObservationDedupeKey({
      ...base,
      observedAtBlock: 21000000n,
    });
    const key2 = buildHsiObservationDedupeKey({
      ...base,
      observedAtBlock: 22000000n,
    });
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different chainIds", () => {
    const base = {
      walletAddress: "0xabc",
      hsiTokenId: 42n,
      observedAtBlock: 100n,
    };
    const key1 = buildHsiObservationDedupeKey({ ...base, chainId: 369 });
    const key2 = buildHsiObservationDedupeKey({ ...base, chainId: 1 });
    expect(key1).not.toBe(key2);
  });
});
